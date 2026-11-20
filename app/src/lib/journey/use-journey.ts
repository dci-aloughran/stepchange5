"use client";

import { useAuth } from "@clerk/nextjs";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { PlanRoom } from "../rooms";
import { useServer } from "../server";
import { type JourneyApi, journeyApi } from "./api";
import { contentKey, hasAnswers } from "./mapping";
import {
  onJourneyChange,
  patchJourney,
  readJourney,
  readRooms,
} from "./store";
import {
  claimForUser,
  localStore,
  requestSync,
  restoreFromServer,
  type SyncResult,
  type SyncStage,
} from "./sync";
import type { JourneyData, JourneyKey } from "./types";

// ---------------------------------------------------------------------------
// Local answers
// ---------------------------------------------------------------------------

export function useJourneyData() {
  const [data, setData] = useState<JourneyData>({});
  const [rooms, setRooms] = useState<PlanRoom[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setData(readJourney());
    setRooms(readRooms());
    setLoaded(true);
    return onJourneyChange((kind) => {
      if (kind === "answers") setData(readJourney());
      else setRooms(readRooms());
    });
  }, []);
  const update = useCallback(
    <K extends JourneyKey>(key: K, value: JourneyData[K]) => {
      patchJourney({ [key]: value } as Partial<JourneyData>);
    },
    [],
  );
  return { data, rooms, loaded, update };
}

export type UpdateJourney = ReturnType<typeof useJourneyData>["update"];

// ---------------------------------------------------------------------------
// Sync status (shared by every mounted component in the tab)
// ---------------------------------------------------------------------------

export type SyncStatus =
  | { state: "idle" }
  | { state: "saving"; stage?: SyncStage }
  | { state: "saved"; at: number }
  | { state: "error"; message: string };

let status: SyncStatus = { state: "idle" };
const listeners = new Set<() => void>();
function setStatus(next: SyncStatus) {
  status = next;
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => status,
  );
}

let lastKey: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
// Restore is checked once per signed-in user before any automatic save, so
// an empty device never overwrites progress saved from another one.
let restoreCheckedFor: string | null = null;
let restoreResult: { restored: boolean; lastStep: string | null } | null =
  null;

function friendly(e: unknown) {
  const msg = e instanceof Error ? e.message : "";
  if (/fetch|network/i.test(msg)) {
    return "We couldn't reach the server. Check your connection.";
  }
  return msg || "Something went wrong while saving.";
}

async function runSync(
  api: JourneyApi,
  onStage?: (s: SyncStage) => void,
): Promise<SyncResult> {
  if (timer) clearTimeout(timer);
  timer = null;
  const key = contentKey(readJourney(), readRooms());
  setStatus({ state: "saving" });
  try {
    const result = await requestSync(api, {
      onStage: (stage) => {
        setStatus({ state: "saving", stage });
        onStage?.(stage);
      },
    });
    lastKey = key;
    setStatus({ state: "saved", at: Date.now() });
    return result;
  } catch (e) {
    setStatus({ state: "error", message: friendly(e) });
    throw e;
  }
}

function schedule(api: JourneyApi, delay = 1200) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    runSync(api).catch(() => {});
  }, delay);
}

// ---------------------------------------------------------------------------
// Sign-in aware sync: restore on a new device, then save changes
// automatically (debounced) while signed in.
// ---------------------------------------------------------------------------

export function useJourneySync() {
  const { client, isLoaded, isSignedIn } = useServer();
  const { userId } = useAuth();
  const api = useMemo(() => journeyApi(client), [client]);
  const [ready, setReady] = useState(false);
  const [restored, setRestored] = useState<{
    restored: boolean;
    lastStep: string | null;
  } | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) {
      setReady(false);
      return;
    }
    let cancelled = false;
    (async () => {
      claimForUser(localStore, userId);
      if (restoreCheckedFor !== userId) {
        try {
          restoreResult = await restoreFromServer(api, userId);
          restoreCheckedFor = userId;
        } catch {
          // Offline or server error: try again on the next page load.
          restoreResult = null;
        }
      }
      if (cancelled) return;
      setRestored(restoreResult);
      setReady(restoreCheckedFor === userId);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, isLoaded, isSignedIn, userId]);

  useEffect(() => {
    if (!ready) return;
    const maybeSave = () => {
      const data = readJourney();
      if (!hasAnswers(data)) return;
      if (contentKey(data, readRooms()) === lastKey) return;
      schedule(api);
    };
    maybeSave();
    return onJourneyChange(maybeSave);
  }, [api, ready]);

  const syncNow = useCallback(
    (onStage?: (s: SyncStage) => void) => runSync(api, onStage),
    [api],
  );

  return {
    api,
    isLoaded,
    isSignedIn,
    ready,
    restored,
    syncNow,
  };
}
