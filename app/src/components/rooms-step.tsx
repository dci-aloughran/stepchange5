"use client";

import type { MeasurementStatus, RoomType } from "@stepchange/shared";
import { useEffect, useState } from "react";
import { patchJourney, readRooms, writeRooms } from "@/lib/journey/store";
import type { JourneyData } from "@/lib/journey/types";
import type { UpdateJourney } from "@/lib/journey/use-journey";
import {
  clampCount,
  countOf,
  formatDims,
  formatMetres,
  type HomeBasics,
  type PlanRoom,
  type PropertyType,
  parseLength,
  ROOM_TYPE_LABELS,
  reconcileRooms,
  roomId,
  STATUS_LABELS,
  templateRooms,
} from "@/lib/rooms";
import { FloorPlanUpload } from "./floor-plan-upload";

export function basicsFrom(data: JourneyData): HomeBasics {
  const type = String(data.propertyType ?? "House").toLowerCase();
  const propertyType = (
    ["house", "flat", "bungalow", "maisonette"].includes(type) ? type : "house"
  ) as PropertyType;
  return {
    propertyType,
    bedrooms: clampCount(data.beds, 2),
    bathrooms: clampCount(data.baths, 1, 6),
  };
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function RoomsStep({
  data,
  loaded,
}: {
  data: JourneyData;
  update?: UpdateJourney;
  loaded: boolean;
}) {
  const basics = basicsFrom(data);
  const [rooms, setRooms] = useState<PlanRoom[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);

  // Load saved rooms once the journey answers are available, then make sure
  // the bedroom/bathroom counts still match what the user declared.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run when answers load or counts change
  useEffect(() => {
    if (!loaded) return;
    const saved = readRooms();
    const result = saved?.length
      ? reconcileRooms(saved, basics)
      : { rooms: templateRooms(basics), warnings: [] };
    save(result.rooms);
    setWarnings(result.warnings);
  }, [loaded, basics.bedrooms, basics.bathrooms, basics.propertyType]);

  function save(next: PlanRoom[]) {
    setRooms(next);
    writeRooms(next);
  }

  function change(id: string, patch: Partial<PlanRoom>) {
    if (!rooms) return;
    const next = rooms.map((r) =>
      r.id === id ? { ...r, ...patch, edited: true, note: undefined } : r,
    );
    save(next);
    setWarnings(reconcileRooms(next, basics).warnings);
  }

  function remove(id: string) {
    if (!rooms) return;
    const next = rooms.filter((r) => r.id !== id);
    save(next);
    setWarnings(reconcileRooms(next, basics).warnings);
  }

  function addRoom() {
    if (!rooms) return;
    save([
      ...rooms,
      {
        id: roomId(),
        name: "New room",
        roomType: "other",
        widthCm: null,
        lengthCm: null,
        status: "unknown",
        source: "manual",
        edited: true,
      },
    ]);
  }

  function resetFromDetails() {
    save(templateRooms(basics));
    setWarnings([]);
    setNotes([]);
  }

  if (!rooms) return null;

  const beds = countOf(rooms, "bedroom");
  const baths = countOf(rooms, "bathroom");
  const matches = beds === basics.bedrooms && baths === basics.bathrooms;

  return (
    <div className="flex flex-col gap-4">
      <FloorPlanUpload
        basics={basics}
        onRooms={(result, extraNotes, serverIds) => {
          save(result.rooms);
          // The plan's rooms replace the old list; the old server copies are
          // removed by the next sync.
          patchJourney((cur) => ({
            serverIds: { ...cur.serverIds, rooms: serverIds },
          }));
          setWarnings(result.warnings);
          setNotes(extraNotes);
        }}
      />

      <section className="rounded-3xl border border-white/10 bg-card p-5">
        <p className="text-xs tracking-[0.2em] text-muted uppercase">
          Planning aid, not a survey
        </p>
        <p className="mt-3 text-muted">
          Check dimensions and access on site before buying furniture. Estimated
          measurements are not evidence of wheelchair access.
        </p>
      </section>

      <p
        className={`rounded-2xl px-4 py-3 text-sm ${matches ? "bg-inset text-muted" : "bg-amber-900/40 text-amber-100"}`}
        role="status"
      >
        {plural(beds, "bedroom")} · {plural(baths, "bathroom")}
        {matches
          ? ` · matches your ${plural(basics.bedrooms, "bed")} ${basics.propertyType}`
          : ` · you said ${plural(basics.bedrooms, "bedroom")} and ${plural(basics.bathrooms, "bathroom")}`}
      </p>
      {warnings.map((w) => (
        <p
          key={w}
          className="rounded-2xl bg-amber-900/40 px-4 py-3 text-sm text-amber-100"
        >
          {w}
        </p>
      ))}
      {notes.length > 0 && (
        <details className="rounded-2xl bg-inset px-4 py-3 text-sm text-muted">
          <summary className="cursor-pointer">
            {notes.length} note{notes.length === 1 ? "" : "s"} from reading your
            plan
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}

      {rooms.map((room) => (
        <RoomCard
          key={room.id}
          room={room}
          onChange={(patch) => change(room.id, patch)}
          onRemove={() => remove(room.id)}
        />
      ))}

      <button
        type="button"
        onClick={addRoom}
        className="min-h-12 rounded-3xl border border-dashed border-white/25 text-muted"
      >
        + Add a room
      </button>
      <button
        type="button"
        onClick={resetFromDetails}
        className="text-left text-sm text-muted underline underline-offset-4"
      >
        Start again from my home details
      </button>
    </div>
  );
}

const chip = "min-h-11 rounded-2xl bg-white/5 px-4 text-muted";
const fieldBox = "flex flex-col gap-1 rounded-2xl bg-inset p-4";
const fieldLabel = "text-xs tracking-[0.15em] text-muted uppercase";

function RoomCard({
  room,
  onChange,
  onRemove,
}: {
  room: PlanRoom;
  onChange: (patch: Partial<PlanRoom>) => void;
  onRemove: () => void;
}) {
  const [mode, setMode] = useState<"view" | "rename" | "edit">("view");
  const [name, setName] = useState(room.name);
  const [width, setWidth] = useState(formatMetres(room.widthCm));
  const [length, setLength] = useState(formatMetres(room.lengthCm));
  const [type, setType] = useState<RoomType>(room.roomType);
  const [status, setStatus] = useState<MeasurementStatus>(room.status);

  function saveEdit() {
    const widthCm = parseLength(width);
    const lengthCm = parseLength(length);
    const known = widthCm != null && lengthCm != null;
    // Entering both sides yourself counts as confirmed unless you say otherwise.
    const nextStatus: MeasurementStatus = !known
      ? "unknown"
      : status === "unknown"
        ? "user_confirmed"
        : status;
    onChange({
      name: name.trim() || room.name,
      roomType: type,
      widthCm,
      lengthCm,
      status: nextStatus,
    });
    setMode("view");
  }

  return (
    <article className="rounded-3xl border border-white/10 bg-card p-5">
      {mode === "rename" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onChange({ name: name.trim() || room.name });
            setMode("view");
          }}
          className="flex gap-2"
        >
          <label className="sr-only" htmlFor={`name-${room.id}`}>
            Room name
          </label>
          <input
            id={`name-${room.id}`}
            className="min-h-11 flex-1 rounded-2xl bg-inset px-4 text-lg outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="rounded-2xl bg-cream px-4 text-ink">
            Save
          </button>
        </form>
      ) : (
        <h2 className="text-xl">{room.name}</h2>
      )}

      {mode === "edit" ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className={`${fieldBox} col-span-2`}>
            <span className={fieldLabel}>Room name</span>
            <input
              className="bg-transparent text-lg outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className={`${fieldBox} col-span-2`}>
            <span className={fieldLabel}>Room type</span>
            <select
              className="bg-transparent text-lg outline-none"
              value={type}
              onChange={(e) => setType(e.target.value as RoomType)}
            >
              {Object.entries(ROOM_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value} className="text-ink">
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldBox}>
            <span className={fieldLabel}>Width (m)</span>
            <input
              className="bg-transparent text-lg outline-none placeholder:text-white/35"
              inputMode="decimal"
              placeholder="e.g. 3.6"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
            />
          </label>
          <label className={fieldBox}>
            <span className={fieldLabel}>Length (m)</span>
            <input
              className="bg-transparent text-lg outline-none placeholder:text-white/35"
              inputMode="decimal"
              placeholder="e.g. 3.1"
              value={length}
              onChange={(e) => setLength(e.target.value)}
            />
          </label>
          <label className={`${fieldBox} col-span-2`}>
            <span className={fieldLabel}>Dimension confidence</span>
            <select
              className="bg-transparent text-lg outline-none"
              value={status}
              onChange={(e) => setStatus(e.target.value as MeasurementStatus)}
            >
              <option value="user_confirmed" className="text-ink">
                I measured it
              </option>
              <option value="source_printed" className="text-ink">
                From the floor plan
              </option>
              <option value="estimated" className="text-ink">
                Estimated · needs measurement
              </option>
              <option value="unknown" className="text-ink">
                Unknown
              </option>
            </select>
          </label>
          <div className="col-span-2 flex gap-2">
            <button
              type="button"
              onClick={saveEdit}
              className="min-h-11 flex-1 rounded-2xl bg-cream text-ink"
            >
              Save room
            </button>
            <button
              type="button"
              onClick={() => setMode("view")}
              className={chip}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-3 font-serif text-3xl">{formatDims(room)}</p>
          <p className="mt-2 text-sm text-muted">
            {ROOM_TYPE_LABELS[room.roomType]} · {STATUS_LABELS[room.status]}
            {room.source === "floor_plan" && !room.edited
              ? " · from your plan"
              : ""}
          </p>
          {room.note && (
            <p className="mt-2 text-sm text-amber-200">{room.note}</p>
          )}
          {mode === "view" && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className={chip}
                onClick={() => setMode("rename")}
              >
                Rename
              </button>
              <button
                type="button"
                className={chip}
                onClick={() => setMode("edit")}
              >
                Edit
              </button>
              <button
                type="button"
                className={chip}
                onClick={onRemove}
                aria-label={`Remove ${room.name}`}
              >
                Remove
              </button>
            </div>
          )}
        </>
      )}
    </article>
  );
}
