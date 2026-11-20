"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import {
  type FloorplanExtractResponse,
  UPLOAD_MAX_BYTES,
} from "@stepchange/shared";
import { useMemo, useRef, useState } from "react";
import { journeyApi } from "@/lib/journey/api";
import { ensureHome, withSyncPaused } from "@/lib/journey/sync";
import {
  type HomeBasics,
  type ReconcileResult,
  roomsFromFloorPlan,
} from "@/lib/rooms";
import { useServer } from "@/lib/server";

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8787";
const ACCEPT = "application/pdf,image/png,image/jpeg";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; pct: number }
  | { kind: "reading" }
  | { kind: "done"; roomCount: number }
  | { kind: "error"; message: string };

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Phone photos are often over the 4 MB limit; shrink images before upload.
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= UPLOAD_MAX_BYTES * 0.9) {
    return file;
  }
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, 3200 / Math.max(bitmap.width, bitmap.height));
  for (let attempt = 0; attempt < 5; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (blob && blob.size <= UPLOAD_MAX_BYTES * 0.9) {
      const name = file.name.replace(/\.[^.]+$/, "") || "floor-plan";
      return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
    }
    scale *= 0.75;
  }
  throw new Error("This image is too large. Try a smaller photo or a PDF.");
}

function uploadWithProgress(
  form: FormData,
  token: string,
  onProgress: (pct: number) => void,
  signal: AbortSignal,
): Promise<{ upload: { id: string } }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SERVER_URL}/uploads`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: { error?: string; upload?: { id: string } } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && body.upload) {
        resolve({ upload: body.upload });
      } else {
        reject(
          new ApiError(
            body.error ?? "We couldn't accept that file. Please try again.",
            xhr.status,
          ),
        );
      }
    };
    xhr.onerror = () =>
      reject(new ApiError("Upload failed. Check your connection.", 0));
    xhr.onabort = () => reject(new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}

async function api<T>(
  path: string,
  token: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.json !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      body.error ?? `Request failed (${res.status})`,
      res.status,
    );
  }
  return body as T;
}

// Rooms read from the plan already exist on the server; serverIds maps each
// new local room id to its server room so the journey sync updates them
// rather than creating duplicates.
export function FloorPlanUpload({
  basics,
  onRooms,
}: {
  basics: HomeBasics;
  onRooms: (
    result: ReconcileResult,
    notes: string[],
    serverIds: Record<string, string>,
  ) => void;
}) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { client } = useServer();
  const journey = useMemo(() => journeyApi(client), [client]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = phase.kind === "uploading" || phase.kind === "reading";

  // Automatic saves wait while the plan is read, so they never remove the
  // rooms the server is creating from it.
  function handleFile(original: File) {
    return withSyncPaused(() => readPlan(original));
  }

  async function readPlan(original: File) {
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const file = await shrinkImage(original);
      if (file.size > UPLOAD_MAX_BYTES) {
        throw new Error(
          "Files must be under 4 MB. Try a smaller PDF or a photo.",
        );
      }
      const token = await getToken();
      if (!token) throw new Error("Please sign in again.");

      // The user's one home (created from their answers if needed).
      const homeId = await ensureHome(journey);
      const form = new FormData();
      form.set("file", file);
      form.set("purpose", "floor_plan");
      form.set("homeId", homeId);
      setPhase({ kind: "uploading", pct: 0 });
      const uploaded = await uploadWithProgress(
        form,
        token,
        (pct) => setPhase({ kind: "uploading", pct }),
        controller.signal,
      );

      setPhase({ kind: "reading" });
      const extracted = await api<FloorplanExtractResponse>(
        `/uploads/${uploaded.upload.id}/extract-floorplan`,
        (await getToken()) ?? token,
        { method: "POST", json: {}, signal: controller.signal },
      );
      const result = roomsFromFloorPlan(extracted.rooms, basics);
      // roomsFromFloorPlan keeps the plan's rooms first, in order.
      const fromPlan = result.rooms.filter((r) => r.source === "floor_plan");
      const serverIds: Record<string, string> = {};
      extracted.rooms.forEach((room, i) => {
        const local = fromPlan[i];
        if (local) serverIds[local.id] = room.id;
      });
      onRooms(
        result,
        [...extracted.warnings, ...extracted.uncertaintyNotes],
        serverIds,
      );
      setPhase({ kind: "done", roomCount: extracted.rooms.length });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setPhase({ kind: "idle" });
        return;
      }
      const message =
        e instanceof ApiError && e.status === 422
          ? `${e.message} You can still edit the rooms below by hand.`
          : e instanceof Error
            ? e.message
            : "Something went wrong. Please try again.";
      setPhase({ kind: "error", message });
    } finally {
      abortRef.current = null;
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-card p-5">
      <p className="text-xs tracking-[0.2em] text-muted uppercase">
        Floor plan
      </p>
      <h2 className="font-serif text-2xl">Upload your floor plan</h2>
      <p className="text-sm text-muted">
        PDF, PNG or JPG up to 4 MB, including a photo of a printed plan. We read
        rooms and printed sizes; anything we can't read stays marked as unknown.
        Uploading a plan replaces the room list below.
      </p>

      {!isLoaded ? (
        <p className="min-h-12 rounded-2xl bg-white/5 px-4 py-3 text-sm text-muted">
          Checking sign-in…
        </p>
      ) : !isSignedIn ? (
        <SignInButton mode="modal">
          <button
            type="button"
            className="min-h-12 rounded-2xl bg-cream font-semibold text-ink"
          >
            Sign in to upload
          </button>
        </SignInButton>
      ) : (
        <>
          <label
            className={`flex min-h-12 cursor-pointer items-center justify-center rounded-2xl bg-cream font-semibold text-ink focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-cream ${busy ? "pointer-events-none opacity-50" : ""}`}
          >
            {phase.kind === "done"
              ? "Upload a different plan"
              : "Choose file or take photo"}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </label>
          <div aria-live="polite" className="text-sm">
            {phase.kind === "uploading" && (
              <div className="flex flex-col gap-2">
                <p>Uploading… {phase.pct}%</p>
                <progress
                  value={phase.pct}
                  max={100}
                  className="h-2 w-full overflow-hidden rounded-full"
                />
              </div>
            )}
            {phase.kind === "reading" && (
              <p>
                Checking the file and reading your rooms. This can take up to a
                minute…
              </p>
            )}
            {phase.kind === "done" && (
              <p className="text-muted">
                Found {phase.roomCount} room{phase.roomCount === 1 ? "" : "s"}.
                Review them below before planning.
              </p>
            )}
            {phase.kind === "error" && (
              <p role="alert" className="text-amber-200">
                {phase.message}
              </p>
            )}
          </div>
          {busy && (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="min-h-11 rounded-2xl bg-white/5 text-muted"
            >
              Cancel
            </button>
          )}
        </>
      )}
    </section>
  );
}
