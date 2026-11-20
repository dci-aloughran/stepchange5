import type { PlanRoom } from "../rooms";
import type { JourneyData } from "./types";

// Device storage for the journey. Every write re-reads the latest saved
// value and merges into it, so the UI and the background sync never
// overwrite each other's changes.

export const JOURNEY_KEY = "deloitful.journey";
export const ROOMS_KEY = "deloitful.rooms";
const EVENT = "deloitful:journey";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function emit(kind: "answers" | "rooms") {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: kind }));
  }
}

export function readJourney(): JourneyData {
  const v = readJson<unknown>(JOURNEY_KEY, {});
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as JourneyData)
    : {};
}

export function writeJourney(next: JourneyData) {
  storage()?.setItem(JOURNEY_KEY, JSON.stringify(next));
  emit("answers");
}

export function patchJourney(
  patch: Partial<JourneyData> | ((cur: JourneyData) => Partial<JourneyData>),
): JourneyData {
  const cur = readJourney();
  const next = {
    ...cur,
    ...(typeof patch === "function" ? patch(cur) : patch),
  };
  writeJourney(next);
  return next;
}

export function readRooms(): PlanRoom[] | null {
  const v = readJson<unknown>(ROOMS_KEY, null);
  return Array.isArray(v) ? (v as PlanRoom[]) : null;
}

export function writeRooms(rooms: PlanRoom[] | null) {
  const s = storage();
  if (rooms) s?.setItem(ROOMS_KEY, JSON.stringify(rooms));
  else s?.removeItem(ROOMS_KEY);
  emit("rooms");
}

export function onJourneyChange(
  fn: (kind: "answers" | "rooms") => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) =>
    fn(((e as CustomEvent).detail as "answers" | "rooms") ?? "answers");
  // Other tabs: keep in step with changes made there.
  const storageHandler = (e: StorageEvent) => {
    if (e.key === JOURNEY_KEY) fn("answers");
    if (e.key === ROOMS_KEY) fn("rooms");
  };
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", storageHandler);
  };
}
