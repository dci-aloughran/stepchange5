import type { PlanRoom } from "../rooms";
import type { JourneyApi } from "./api";
import { type CollectionPlan, planCollection, roomsToReview } from "./diff";
import {
  buildDraft,
  hasAnswers,
  homeChanged,
  homePayload,
  householdChanged,
  householdPayload,
  isRoomConfirmed,
  journeyTypeOf,
  needChanged,
  needPayload,
  personChanged,
  personPayload,
  possessionChanged,
  possessionPayload,
  readDraft,
  roomPatch,
  roomPayload,
} from "./mapping";
import * as deviceStore from "./store";
import type { JourneyData, ServerIds } from "./types";

// Syncs the local journey to the server idempotently (MB-005): one home per
// user, and exactly one server record per local person, need, possession
// and room. Safe to run repeatedly; a repeat run with no changes only reads.

export type JourneyStore = {
  read(): JourneyData;
  patch(
    p: Partial<JourneyData> | ((cur: JourneyData) => Partial<JourneyData>),
  ): JourneyData;
  readRooms(): PlanRoom[] | null;
  writeRooms(rooms: PlanRoom[] | null): void;
  write(data: JourneyData): void;
};

export const localStore: JourneyStore = {
  read: deviceStore.readJourney,
  patch: deviceStore.patchJourney,
  readRooms: deviceStore.readRooms,
  writeRooms: deviceStore.writeRooms,
  write: deviceStore.writeJourney,
};

export type SyncStage =
  | "home"
  | "rooms"
  | "household"
  | "access"
  | "furniture"
  | "progress";

export const STAGE_LABELS: Record<SyncStage, string> = {
  home: "Saving your home",
  rooms: "Saving your rooms",
  household: "Saving your household",
  access: "Saving accessibility needs",
  furniture: "Saving furniture you're keeping",
  progress: "Saving your progress",
};

export type SyncResult = {
  homeId: string;
  skippedNeeds: number;
  reviewedRooms: number;
};

function isNotFound(e: unknown) {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { status?: unknown }).status === 404
  );
}

// If someone else signs in on this device, forget the previous account's
// server ids (the answers themselves stay on the device).
export function claimForUser(store: JourneyStore, userId: string) {
  const data = store.read();
  if (data.ownerUserId === userId) return;
  if (data.ownerUserId && data.ownerUserId !== userId) {
    store.patch({ ownerUserId: userId, homeId: undefined, serverIds: {} });
  } else {
    store.patch({ ownerUserId: userId });
  }
}

function setIds(
  store: JourneyStore,
  key: keyof ServerIds,
  ids: Record<string, string>,
) {
  store.patch((cur) => ({
    serverIds: { ...cur.serverIds, [key]: ids },
  }));
}

function addId(
  store: JourneyStore,
  key: keyof ServerIds,
  localId: string,
  serverId: string,
) {
  store.patch((cur) => ({
    serverIds: {
      ...cur.serverIds,
      [key]: { ...cur.serverIds?.[key], [localId]: serverId },
    },
  }));
}

// ---------------------------------------------------------------------------
// Home: exactly one per user
// ---------------------------------------------------------------------------

let homeInFlight: Promise<string> | null = null;

export function ensureHome(api: JourneyApi, store: JourneyStore = localStore) {
  homeInFlight ??= findOrCreateHome(api, store).finally(() => {
    homeInFlight = null;
  });
  return homeInFlight;
}

async function findOrCreateHome(
  api: JourneyApi,
  store: JourneyStore,
): Promise<string> {
  const data = store.read();
  if (data.homeId && (await api.getHome(data.homeId))) return data.homeId;

  const remember = (id: string) => {
    store.patch((cur) =>
      cur.homeId === id
        ? {}
        : // A different home: room ids from the old one no longer apply.
          { homeId: id, serverIds: { ...cur.serverIds, rooms: {} } },
    );
    return id;
  };

  const profile = await api.getProfile();
  const saved = profile.journeyState?.homeId;
  if (typeof saved === "string" && (await api.getHome(saved))) {
    return remember(saved);
  }
  const homes = await api.listHomes();
  const existing = homes[0];
  if (existing) {
    await api.patchProfile({ journeyState: { homeId: existing.id } });
    return remember(existing.id);
  }
  const desired = homePayload(data);
  const home = await api.createHome({
    ...desired,
    journeyType: journeyTypeOf(data),
  });
  remember(home.id);
  await api.patchProfile({
    journeyType: journeyTypeOf(data),
    journeyState: { homeId: home.id },
  });
  return home.id;
}

// ---------------------------------------------------------------------------
// Full sync
// ---------------------------------------------------------------------------

async function runPlan<S extends { id: string }, P, R extends { id: string }>(
  plan: CollectionPlan<S, P>,
  ops: {
    create(p: P): Promise<R>;
    update(id: string, p: P, server: S): Promise<unknown>;
    onCreated(localId: string, serverId: string): void;
  },
): Promise<Record<string, string>> {
  const ids: Record<string, string> = { ...plan.kept };
  for (const u of plan.updates) {
    try {
      await ops.update(u.server.id, u.payload, u.server);
    } catch (e) {
      if (!isNotFound(e)) throw e;
      const created = await ops.create(u.payload);
      ids[u.localId] = created.id;
      ops.onCreated(u.localId, created.id);
    }
  }
  for (const c of plan.creates) {
    const created = await ops.create(c.payload);
    ids[c.localId] = created.id;
    // Saved straight away so a retry after a failure never duplicates it.
    ops.onCreated(c.localId, created.id);
  }
  return ids;
}

export async function syncJourney(
  api: JourneyApi,
  opts: {
    store?: JourneyStore;
    onStage?: (stage: SyncStage) => void;
  } = {},
): Promise<SyncResult> {
  const store = opts.store ?? localStore;
  const stage = (s: SyncStage) => opts.onStage?.(s);

  // Home + listing details.
  stage("home");
  const homeId = await ensureHome(api, store);
  let data = store.read();
  const home = await api.getHome(homeId);
  const desiredHome = homePayload(data);
  if (home && homeChanged(home, desiredHome)) {
    await api.updateHome(homeId, desiredHome);
  }

  // Rooms (created/updated now; removed ones deleted at the end).
  stage("rooms");
  let rooms = store.readRooms();
  let roomIds = data.serverIds?.rooms ?? {};
  let roomDeletes: string[] = [];
  let reviewedCount = 0;
  if (rooms) {
    const serverRooms = await api.listRooms(homeId);
    // Read the device's rooms after the server's, never before.
    rooms = store.readRooms() ?? rooms;
    roomIds = store.read().serverIds?.rooms ?? {};
    const localRooms = rooms;
    const reviewed: Record<string, boolean> = Object.fromEntries(
      serverRooms.map((r) => [r.id, r.reviewedAt != null]),
    );
    const plan = planCollection(
      localRooms,
      roomIds,
      serverRooms,
      roomPayload,
      (s, p) => roomPatch(s, p) !== null,
    );
    roomIds = await runPlan(plan, {
      create: async (p) => {
        const r = await api.createRoom(homeId, p);
        reviewed[r.id] = r.reviewedAt != null;
        return r;
      },
      update: async (id, p, s) => {
        const patch = roomPatch(s, p);
        if (!patch) return;
        const r = await api.updateRoom(homeId, id, patch);
        reviewed[r.id] = r.reviewedAt != null;
      },
      onCreated: (l, s) => addId(store, "rooms", l, s),
    });
    setIds(store, "rooms", roomIds);
    roomDeletes = plan.deletes;

    // FP-004: rooms the user confirmed with "Use these rooms".
    data = store.read();
    const toReview = roomsToReview(localRooms, roomIds, reviewed, (localId) => {
      const room = localRooms.find((r) => r.id === localId);
      return room ? isRoomConfirmed(room, data.reviewedRooms) : false;
    });
    for (const id of toReview) {
      await api.reviewRoom(homeId, id);
      reviewedCount++;
    }
  }

  // Household members.
  stage("household");
  data = store.read();
  const people = data.people ?? [];
  const personPlan = planCollection(
    people,
    data.serverIds?.persons,
    await api.listPersons(),
    (p) => personPayload(people, p),
    personChanged,
  );
  const personIds = await runPlan(personPlan, {
    create: (p) => api.createPerson(p),
    update: (id, p) => api.updatePerson(id, p),
    onCreated: (l, s) => addId(store, "persons", l, s),
  });
  setIds(store, "persons", personIds);

  // Accessibility needs (need room + person ids).
  stage("access");
  data = store.read();
  const needPlan = planCollection(
    data.needs ?? [],
    data.serverIds?.needs,
    await api.listNeeds(),
    (n) => {
      const r = needPayload(n, { rooms: roomIds, persons: personIds });
      return r.ok ? r.value : null;
    },
    needChanged,
  );
  for (const id of needPlan.deletes) await api.deleteNeed(id);
  const needIds = await runPlan(needPlan, {
    create: (p) => api.createNeed(p),
    update: (id, p) => api.updateNeed(id, p),
    onCreated: (l, s) => addId(store, "needs", l, s),
  });
  setIds(store, "needs", needIds);

  // Furniture to keep.
  stage("furniture");
  data = store.read();
  const possessionPlan = planCollection(
    data.possessions ?? [],
    data.serverIds?.possessions,
    await api.listPossessions(),
    (item) => possessionPayload(item, roomIds),
    possessionChanged,
  );
  for (const id of possessionPlan.deletes) await api.deletePossession(id);
  const possessionIds = await runPlan(possessionPlan, {
    create: (p) => api.createPossession(p),
    update: (id, p) => api.updatePossession(id, p),
    onCreated: (l, s) => addId(store, "possessions", l, s),
  });
  setIds(store, "possessions", possessionIds);

  // Now nothing points at removed people or rooms, delete them.
  for (const id of personPlan.deletes) await api.deletePerson(id);
  for (const id of roomDeletes) await api.deleteRoom(homeId, id);

  // Lifestyle, practical needs and budget.
  stage("household");
  data = store.read();
  const desiredHousehold = householdPayload(data);
  const household = await api.getHousehold();
  if (householdChanged(household, desiredHousehold)) {
    await api.putHousehold(desiredHousehold);
  }

  // Resume point for other devices.
  stage("progress");
  data = store.read();
  await api.patchProfile({
    journeyType: journeyTypeOf(data),
    journeyState: {
      homeId,
      lastConfirmedStep: data.lastStep ?? null,
      draft: buildDraft(data, store.readRooms()),
    },
  });

  return {
    homeId,
    skippedNeeds: needPlan.skipped.length,
    reviewedRooms: reviewedCount,
  };
}

// ---------------------------------------------------------------------------
// Restore on a new device (MB-005)
// ---------------------------------------------------------------------------

export async function restoreFromServer(
  api: JourneyApi,
  userId: string,
  store: JourneyStore = localStore,
): Promise<{ restored: boolean; lastStep: string | null }> {
  if (hasAnswers(store.read())) return { restored: false, lastStep: null };
  const profile = await api.getProfile();
  const state = profile.journeyState ?? {};
  const draft = readDraft(state.draft);
  const lastStep =
    typeof state.lastConfirmedStep === "string"
      ? state.lastConfirmedStep
      : null;
  // Re-check: the user may have started typing while we were loading.
  if (!draft || hasAnswers(store.read())) {
    return { restored: false, lastStep: null };
  }
  store.write({
    ...draft.answers,
    homeId:
      typeof state.homeId === "string" ? state.homeId : draft.answers.homeId,
    ownerUserId: userId,
    lastStep: lastStep ?? draft.answers.lastStep,
  });
  if (draft.rooms) store.writeRooms(draft.rooms);
  return { restored: true, lastStep };
}

// ---------------------------------------------------------------------------
// One sync at a time per tab
// ---------------------------------------------------------------------------

let running: Promise<SyncResult> | null = null;
let queued: Promise<SyncResult> | null = null;
let pauses: Promise<unknown>[] = [];

// Runs fn with syncing held off (after any sync in progress finishes), e.g.
// while the server creates rooms from a floor plan the device doesn't know
// about yet.
export async function withSyncPaused<T>(fn: () => Promise<T>): Promise<T> {
  const p = (async () => {
    if (running) await running.catch(() => undefined);
    return fn();
  })();
  pauses.push(p);
  try {
    return await p;
  } finally {
    pauses = pauses.filter((x) => x !== p);
  }
}

async function afterPauses() {
  while (pauses.length) await Promise.allSettled(pauses);
}

// Runs a sync now, or straight after the one in progress (changes made
// during a sync are always picked up by a following run).
export function requestSync(
  api: JourneyApi,
  opts: Parameters<typeof syncJourney>[1] = {},
): Promise<SyncResult> {
  if (!running) {
    running = afterPauses()
      .then(() => syncJourney(api, opts))
      .finally(() => {
        running = null;
      });
    return running;
  }
  queued ??= running
    .catch(() => undefined)
    .then(() => {
      queued = null;
      return requestSync(api, opts);
    });
  return queued;
}
