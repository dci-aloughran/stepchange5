"use client";

import { SignInButton } from "@clerk/nextjs";
import type { ListingExtractResponse } from "@stepchange/shared";
import { UPLOAD_MAX_BYTES } from "@stepchange/shared";
import { useEffect, useRef, useState } from "react";
import { factRows, isListingFile } from "@/lib/listing/format";
import { ApiError, readJson, SERVER_URL, useServer } from "@/lib/server";

const MAX_FILES = 8;
const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; done: number; total: number }
  | { kind: "reading" }
  | { kind: "preview"; result: ListingExtractResponse }
  | { kind: "applied"; result: ListingExtractResponse }
  | { kind: "error"; message: string };

// Phone screenshots can exceed the 4 MB limit; shrink images before upload.
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= UPLOAD_MAX_BYTES * 0.9) {
    return file;
  }
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, 2800 / Math.max(bitmap.width, bitmap.height));
  for (let attempt = 0; attempt < 5; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.88),
    );
    if (blob && blob.size <= UPLOAD_MAX_BYTES * 0.9) {
      const name = file.name.replace(/\.[^.]+$/, "") || "listing";
      return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
    }
    scale *= 0.75;
  }
  throw new Error(`${file.name} is too large. Try a smaller screenshot.`);
}

async function uploadListingFile(
  file: File,
  token: string,
  signal: AbortSignal,
): Promise<string> {
  const form = new FormData();
  form.set("file", file);
  form.set("purpose", "listing");
  const res = await fetch(`${SERVER_URL}/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal,
  });
  const body = await readJson<{ upload: { id: string } }>(res);
  return body.upload.id;
}

function Thumb({ uploadId }: { uploadId: string }) {
  const { client } = useServer();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    client.uploads[":id"].url
      .$get({ param: { id: uploadId } })
      .then((r) => readJson<{ url: string }>(r))
      .then((b) => alive && setUrl(b.url))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [client, uploadId]);
  if (!url) return <div className="aspect-[4/3] rounded-2xl bg-inset" />;
  return (
    // biome-ignore lint/performance/noImgElement: short-lived presigned private URL
    <img
      src={url}
      alt="From your listing"
      className="aspect-[4/3] w-full rounded-2xl object-cover"
    />
  );
}

export function ListingPreview({
  onApply,
}: {
  onApply: (result: ListingExtractResponse) => void;
}) {
  const { client, getToken, isLoaded, isSignedIn } = useServer();
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const busy = phase.kind === "uploading" || phase.kind === "reading";

  async function read() {
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const token = await getToken();
      if (!token) throw new Error("Please sign in again.");
      const uploadIds: string[] = [];
      setPhase({ kind: "uploading", done: 0, total: files.length });
      for (const original of files) {
        const file = await shrinkImage(original);
        if (file.size > UPLOAD_MAX_BYTES) {
          throw new Error(`${original.name} is over 4 MB.`);
        }
        uploadIds.push(await uploadListingFile(file, token, controller.signal));
        setPhase({
          kind: "uploading",
          done: uploadIds.length,
          total: files.length,
        });
      }
      setPhase({ kind: "reading" });
      const result = await readJson<ListingExtractResponse>(
        await client.listing.extract.$post(
          {
            json: {
              uploadIds,
              ...(text.trim() ? { text: text.trim() } : {}),
            },
          },
          { init: { signal: controller.signal } },
        ),
      );
      setPhase({ kind: "preview", result });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setPhase({ kind: "idle" });
        return;
      }
      setPhase({
        kind: "error",
        message:
          e instanceof ApiError || e instanceof Error
            ? e.message
            : "Something went wrong. Please try again.",
      });
    } finally {
      abortRef.current = null;
    }
  }

  const canRead = (files.length > 0 || text.trim().length > 0) && !busy;

  return (
    <section
      aria-labelledby="listing-preview-heading"
      className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-card p-5"
    >
      <p className="text-xs tracking-[0.2em] text-muted uppercase">
        Listing preview
      </p>
      <h2 id="listing-preview-heading" className="font-serif text-2xl">
        Bring in the listing
      </h2>
      <p className="text-sm text-muted">
        Add screenshots of the listing (from the Rightmove or Zoopla app or
        website) and/or paste its description. We read only what you share — we
        don't visit the listing page — and anything we can't see stays blank for
        you to fill in.
      </p>

      {!isLoaded ? (
        <p className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-muted">
          Checking sign-in…
        </p>
      ) : !isSignedIn ? (
        <SignInButton mode="modal">
          <button
            type="button"
            className="min-h-12 rounded-2xl bg-cream font-semibold text-ink"
          >
            Sign in to add a listing
          </button>
        </SignInButton>
      ) : phase.kind === "preview" || phase.kind === "applied" ? (
        <Preview
          result={phase.result}
          applied={phase.kind === "applied"}
          onApply={() => {
            onApply(phase.result);
            setPhase({ kind: "applied", result: phase.result });
          }}
          onRestart={() => {
            setFiles([]);
            setText("");
            setPhase({ kind: "idle" });
          }}
        />
      ) : (
        <>
          <label
            className={`flex min-h-12 cursor-pointer items-center justify-center rounded-2xl border border-white/15 font-semibold ${busy ? "pointer-events-none opacity-50" : ""}`}
          >
            Add screenshots
            <input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,application/pdf"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []).filter(
                  isListingFile,
                );
                setFiles((cur) => {
                  const seen = new Set(cur.map(fileKey));
                  const fresh = picked.filter((f) => !seen.has(fileKey(f)));
                  return [...cur, ...fresh].slice(0, MAX_FILES);
                });
                e.target.value = "";
              }}
            />
          </label>
          {files.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="Screenshots added">
              {files.map((f) => (
                <li
                  key={fileKey(f)}
                  className="flex items-center justify-between gap-2 rounded-2xl bg-inset px-4 py-2 text-sm"
                >
                  <span className="truncate">{f.name}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setFiles((cur) =>
                        cur.filter((x) => fileKey(x) !== fileKey(f)),
                      )
                    }
                    className="min-h-11 shrink-0 px-2 text-muted"
                    aria-label={`Remove ${f.name}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="flex flex-col gap-1 rounded-2xl bg-inset p-4">
            <span className="text-xs tracking-[0.15em] text-muted uppercase">
              Or paste the listing text
            </span>
            <textarea
              rows={4}
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
              placeholder="Price, key features, description, room sizes…"
              className="resize-y bg-transparent outline-none placeholder:text-white/35"
            />
          </label>
          <button
            type="button"
            onClick={() => void read()}
            disabled={!canRead}
            className="min-h-12 rounded-2xl bg-cream font-semibold text-ink disabled:opacity-40"
          >
            Read listing
          </button>
          <div aria-live="polite" className="text-sm">
            {phase.kind === "uploading" && (
              <p>
                Uploading {phase.done} of {phase.total}…
              </p>
            )}
            {phase.kind === "reading" && (
              <p>Reading your listing. This can take up to a minute…</p>
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

function Preview({
  result,
  applied,
  onApply,
  onRestart,
}: {
  result: ListingExtractResponse;
  applied: boolean;
  onApply: () => void;
  onRestart: () => void;
}) {
  const { details } = result;
  const rows = factRows(details);
  const found = rows.some((r) => r.value != null) || result.rooms.length > 0;

  return (
    <div className="flex flex-col gap-4" data-testid="listing-preview-card">
      {result.photoUploadIds.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {result.photoUploadIds.slice(0, 4).map((id) => (
            <Thumb key={id} uploadId={id} />
          ))}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-2">
        {rows.map((r) => (
          <div key={r.label} className="rounded-2xl bg-inset p-3">
            <dt className="text-xs tracking-[0.15em] text-muted uppercase">
              {r.label}
            </dt>
            <dd className={r.value ? "mt-1" : "mt-1 text-muted italic"}>
              {r.value ?? "Not shown"}
            </dd>
          </div>
        ))}
      </dl>
      {details.keyFeatures.length > 0 && (
        <div>
          <p className="text-xs tracking-[0.15em] text-muted uppercase">
            Key features
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {details.keyFeatures.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      {result.rooms.length > 0 && (
        <div>
          <p className="text-xs tracking-[0.15em] text-muted uppercase">
            Rooms listed
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {result.rooms.map((r) => (
              <li key={`${r.name}-${r.widthCm}-${r.lengthCm}`}>
                {r.name}
                {r.widthCm != null && r.lengthCm != null
                  ? ` · ${(r.widthCm / 100).toFixed(1)} × ${(r.lengthCm / 100).toFixed(1)} m (agent's figures)`
                  : " · size not given"}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.floorPlanUploadId && (
        <p className="rounded-2xl bg-inset px-4 py-3 text-sm text-muted">
          One of your screenshots looks like a floor plan. Add it on the rooms
          step to read the room sizes from it.
        </p>
      )}
      {(result.missing.length > 0 || result.notes.length > 0) && (
        <div className="rounded-2xl bg-amber-900/40 px-4 py-3 text-sm text-amber-100">
          {result.missing.length > 0 && (
            <p>Not found in what you shared: {result.missing.join(", ")}.</p>
          )}
          {result.notes.map((n) => (
            <p key={n} className="mt-1">
              {n}
            </p>
          ))}
        </div>
      )}
      <p className="text-xs text-muted">
        Read by AI from what you shared — please check every detail.
      </p>
      {applied ? (
        <p role="status" className="rounded-2xl bg-inset px-4 py-3 text-sm">
          Details added to your home. You can still change them below.
        </p>
      ) : (
        <button
          type="button"
          onClick={onApply}
          disabled={!found}
          className="min-h-12 rounded-2xl bg-cream font-semibold text-ink disabled:opacity-40"
        >
          Use these details
        </button>
      )}
      <button
        type="button"
        onClick={onRestart}
        className="text-left text-sm text-muted underline underline-offset-4"
      >
        Start again with different screenshots
      </button>
    </div>
  );
}
