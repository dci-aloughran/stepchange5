import { describe, expect, it } from "vitest";
import type { PlanRoom } from "../rooms";
import type { JourneyApi } from "./api";
import { planCollection, roomsToReview } from "./diff";
import { reviewedRoomMap } from "./mapping";
import {
  claimForUser,
  type JourneyStore,
  restoreFromServer,
  syncJourney,
} from "./sync";
import type { JourneyData } from "./types";

// ---------------------------------------------------------------------------
// Pure collection planning
// ---------------------------------------------------------------------------

describe("planCollection", () => {
  const changed = (s: { v: number }, p: number) => s.v !== p;
  const toPayload = (l: { id: string; v: number }) => (l.v < 0 ? null : l.v);

  it("creates unmapped items, updates changed ones, deletes orphans", () => {
    const plan = planCollection(
      [
        { id: "a", v: 1 },
        { id: "b", v: 5 },
        { id: "c", v: 3 },
      ],
      { a: "S1", b: "S2" },
      [
        { id: "S1", v: 1 },
        { id: "S2", v: 2 },
        { id: "S9", v: 9 },
      ],
      toPayload,
      changed,
    );
    expect(plan.creates).toEqual([{ localId: "c", payload: 3 }]);
    expect(
      plan.updates.map((u) => [u.localId, u.server.id, u.payload]),
    ).toEqual([["b", "S2", 5]]);
    expect(plan.deletes).toEqual(["S9"]);
    expect(plan.kept).toEqual({ a: "S1", b: "S2" });
  });

  it("recreates items whose server record has gone", () => {
    const plan = planCollection(
      [{ id: "a", v: 1 }],
      { a: "gone" },
      [],
      toPayload,
      changed,
    );
    expect(plan.creates).toEqual([{ localId: "a", payload: 1 }]);
  });

  it("leaves incomplete items alone without deleting their server copy", () => {
    const plan = planCollection(
      [
        { id: "a", v: -1 },
        { id: "b", v: -1 },
      ],
      { a: "S1" },
      [{ id: "S1", v: 1 }],
      toPayload,
      changed,
    );
    expect(plan.creates).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.skipped).toEqual(["a", "b"]);
  });

  it("never maps two local items onto one server record", () => {
    const plan = planCollection(
      [
        { id: "a", v: 1 },
        { id: "b", v: 1 },
      ],
      { a: "S1", b: "S1" },
      [{ id: "S1", v: 1 }],
      toPayload,
      changed,
    );
    expect(plan.kept).toEqual({ a: "S1" });
    expect(plan.creates).toEqual([{ localId: "b", payload: 1 }]);
  });
});

describe("roomsToReview", () => {
  it("returns confirmed rooms the server hasn't reviewed", () => {
    expect(
      roomsToReview(
        [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
        { a: "S1", b: "S2", c: "S3" },
        { S1: true, S2: false, S3: false },
        (id) => id !== "c",
      ),
    ).toEqual(["S2"]);
  });
});

// ---------------------------------------------------------------------------
// Sync against an in-memory server
// ---------------------------------------------------------------------------

let seq = 0;
const uuid = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
};

type Row = Record<string, unknown> & { id: string };

function fakeServer() {
  const db = {
    homes: [] as Row[],
    rooms: [] as Row[],
    persons: [] as Row[],
    needs: [] as Row[],
    possessions: [] as Row[],
    household: {
      lifestyle: {},
      practicalNeeds: {},
      budgetTotalPence: null as number | null,
    },
    profile: { journeyState: {} as Record<string, unknown> },
  };
  const writes: string[] = [];
  const now = () => new Date().toISOString();
  const crud = (name: "persons" | "needs" | "possessions") => ({
    list: async () => db[name].map((r) => ({ ...r })),
    create: async (body: object) => {
      writes.push(`create ${name}`);
      const row = { id: uuid(), createdAt: now(), ...body } as Row;
      db[name].push(row);
      return row;
    },
    update: async (id: string, body: object) => {
      writes.push(`update ${name}`);
      const row = db[name].find((r) => r.id === id);
      if (!row) throw Object.assign(new Error("Not found"), { status: 404 });
      Object.assign(row, body);
      return row;
    },
    remove: async (id: string) => {
      writes.push(`delete ${name}`);
      db[name] = db[name].filter((r) => r.id !== id);
    },
  });
  const persons = crud("persons");
  const needs = crud("needs");
  const possessions = crud("possessions");
  const roomRow = (r: Row) => ({ ...r }) as never;
  const api: JourneyApi = {
    listHomes: async () => db.homes as never,
    getHome: async (id) => (db.homes.find((h) => h.id === id) as never) ?? null,
    createHome: async (body) => {
      writes.push("create home");
      const home = { id: uuid(), ...body } as Row;
      db.homes.push(home);
      return home as never;
    },
    updateHome: async (id, body) => {
      writes.push("update home");
      const home = db.homes.find((h) => h.id === id) as Row;
      Object.assign(home, body);
      return home as never;
    },
    getProfile: async () => db.profile as never,
    patchProfile: async (body) => {
      Object.assign(db.profile.journeyState, body.journeyState ?? {});
      return db.profile as never;
    },
    getHousehold: async () => ({ ...db.household }) as never,
    putHousehold: async (body) => {
      writes.push("update household");
      Object.assign(db.household, body);
      return db.household as never;
    },
    listPersons: persons.list as never,
    createPerson: persons.create as never,
    updatePerson: persons.update as never,
    deletePerson: persons.remove,
    listNeeds: needs.list as never,
    createNeed: async (body) => {
      // Mirror server validation: room / person must exist.
      if (body.roomId && !db.rooms.some((r) => r.id === body.roomId)) {
        throw Object.assign(new Error("Not found"), { status: 404 });
      }
      return needs.create(body) as never;
    },
    updateNeed: needs.update as never,
    deleteNeed: needs.remove,
    listPossessions: possessions.list as never,
    createPossession: possessions.create as never,
    updatePossession: possessions.update as never,
    deletePossession: possessions.remove,
    listRooms: async (homeId) =>
      db.rooms.filter((r) => r.homeId === homeId).map(roomRow),
    createRoom: async (homeId, body) => {
      writes.push("create room");
      const row = { id: uuid(), homeId, reviewedAt: null, ...body } as Row;
      db.rooms.push(row);
      return roomRow(row);
    },
    updateRoom: async (_homeId, id, body) => {
      writes.push("update room");
      const row = db.rooms.find((r) => r.id === id) as Row;
      Object.assign(row, body);
      if ("widthCm" in body || "lengthCm" in body || "dimensionStatus" in body)
        row.reviewedAt = null;
      return roomRow(row);
    },
    deleteRoom: async (_homeId, id) => {
      writes.push("delete room");
      db.rooms = db.rooms.filter((r) => r.id !== id);
      db.needs = db.needs.filter((n) => n.roomId !== id);
    },
    reviewRoom: async (_homeId, id) => {
      writes.push("review room");
      const row = db.rooms.find((r) => r.id === id) as Row;
      row.reviewedAt = now();
      return roomRow(row);
    },
    getTaste: async () => null,
  };
  return { api, db, writes };
}

function memoryStore(
  data: JourneyData,
  rooms: PlanRoom[] | null,
): JourneyStore & {
  state: { data: JourneyData; rooms: PlanRoom[] | null };
} {
  const state = { data: structuredClone(data), rooms: structuredClone(rooms) };
  return {
    state,
    read: () => structuredClone(state.data),
    write: (d) => {
      state.data = structuredClone(d);
    },
    patch: (p) => {
      const patch = typeof p === "function" ? p(state.data) : p;
      state.data = { ...state.data, ...patch };
      return state.data;
    },
    readRooms: () => structuredClone(state.rooms),
    writeRooms: (r) => {
      state.rooms = structuredClone(r);
    },
  };
}

const ROOMS: PlanRoom[] = [
  {
    id: "l1",
    name: "Living room",
    roomType: "living_room",
    widthCm: 460,
    lengthCm: 380,
    status: "user_confirmed",
    source: "manual",
    edited: true,
  },
  ...[1, 2, 3].map(
    (n): PlanRoom => ({
      id: `b${n}`,
      name: `Bedroom ${n}`,
      roomType: "bedroom",
      widthCm: null,
      lengthCm: null,
      status: "unknown",
      source: "template",
      edited: false,
    }),
  ),
];

const ANSWERS: JourneyData = {
  journey: "Buying a home",
  propertyType: "House",
  address: "1 Test Street",
  beds: "3",
  baths: "1",
  people: [
    { id: "p1", role: "adult", ageYears: null },
    { id: "p2", role: "adult", ageYears: null },
    { id: "p3", role: "child", ageYears: 0, onTheWay: true },
    { id: "p4", role: "regular_visitor", ageYears: null, label: "Mum" },
  ],
  needs: [
    {
      id: "n1",
      needType: "turning_area",
      scope: "room",
      roomId: "l1",
      params: { diameterCm: "150" },
      confirmed: true,
    },
  ],
  possessions: [
    {
      id: "s1",
      name: "Sofa",
      category: "Sofa",
      widthCm: 210,
      depthCm: null,
      heightCm: null,
      roomId: "l1",
      keep: true,
    },
  ],
  budget: "6,000",
  reviewedRooms: reviewedRoomMap(ROOMS),
  lastStep: "review",
};

describe("syncJourney", () => {
  it("creates everything once, and a repeat sync writes nothing", async () => {
    const { api, db, writes } = fakeServer();
    const store = memoryStore(ANSWERS, ROOMS);
    const result = await syncJourney(api, { store });

    expect(db.homes).toHaveLength(1);
    expect(store.state.data.homeId).toBe(db.homes[0]?.id);
    expect(db.profile.journeyState.homeId).toBe(db.homes[0]?.id);
    expect(db.rooms).toHaveLength(4);
    expect(db.rooms.every((r) => r.reviewedAt)).toBe(true);
    expect(result.reviewedRooms).toBe(4);
    expect(db.persons).toHaveLength(4);
    expect(db.persons.find((p) => p.role === "child")).toMatchObject({
      ageYears: 0,
    });
    expect(db.needs).toHaveLength(1);
    expect(db.needs[0]).toMatchObject({
      confirmed: true,
      params: { diameterCm: 150 },
      roomId: store.state.data.serverIds?.rooms?.l1,
    });
    expect(db.possessions).toHaveLength(1);
    expect(db.possessions[0]?.roomId).toBe(
      store.state.data.serverIds?.rooms?.l1,
    );
    expect(db.household.budgetTotalPence).toBe(600_000);
    expect(db.profile.journeyState.lastConfirmedStep).toBe("review");

    writes.length = 0;
    await syncJourney(api, { store });
    expect(writes).toEqual([]);
  });

  it("applies edits and removals without duplicating", async () => {
    const { api, db } = fakeServer();
    const store = memoryStore(ANSWERS, ROOMS);
    await syncJourney(api, { store });

    store.patch((cur) => ({
      people: cur.people?.filter((p) => p.id !== "p4"),
      possessions: [],
      budget: "7,500",
    }));
    store.writeRooms(ROOMS.filter((r) => r.id !== "b3"));
    await syncJourney(api, { store });

    expect(db.homes).toHaveLength(1);
    expect(db.persons).toHaveLength(3);
    expect(db.possessions).toHaveLength(0);
    expect(db.rooms).toHaveLength(3);
    expect(db.needs).toHaveLength(1);
    expect(db.household.budgetTotalPence).toBe(750_000);
  });

  it("re-reviews only rooms the user confirmed again after an edit", async () => {
    const { api, db } = fakeServer();
    const store = memoryStore(ANSWERS, ROOMS);
    await syncJourney(api, { store });
    const edited = ROOMS.map((r) =>
      r.id === "b1"
        ? {
            ...r,
            widthCm: 300,
            lengthCm: 280,
            status: "user_confirmed" as const,
          }
        : r,
    );
    store.writeRooms(edited);
    await syncJourney(api, { store });
    const serverB1 = db.rooms.find(
      (r) => r.id === store.state.data.serverIds?.rooms?.b1,
    );
    expect(serverB1).toMatchObject({ widthCm: 300, reviewedAt: null });

    store.patch({ reviewedRooms: reviewedRoomMap(edited) });
    await syncJourney(api, { store });
    expect(db.rooms.every((r) => r.reviewedAt)).toBe(true);
  });

  it("reuses rooms the server created from a floor plan", async () => {
    const { api, db } = fakeServer();
    const store = memoryStore({ ...ANSWERS, needs: [], possessions: [] }, null);
    await syncJourney(api, { store });
    const homeId = store.state.data.homeId as string;
    // Floor-plan extraction created two rooms server-side.
    db.rooms.push(
      {
        id: uuid(),
        homeId,
        name: "Living room",
        roomType: "living_room",
        widthCm: 460,
        lengthCm: 380,
        dimensionStatus: "source_printed",
        reviewedAt: null,
      },
      {
        id: uuid(),
        homeId,
        name: "Bedroom 1",
        roomType: "bedroom",
        widthCm: null,
        lengthCm: null,
        dimensionStatus: "unknown",
        reviewedAt: null,
      },
    );
    const [living, bed] = db.rooms;
    const local: PlanRoom[] = [
      {
        id: "fp1",
        name: "Living room",
        roomType: "living_room",
        widthCm: 460,
        lengthCm: 380,
        status: "source_printed",
        source: "floor_plan",
        edited: false,
      },
      {
        id: "fp2",
        name: "Bedroom 1",
        roomType: "bedroom",
        widthCm: null,
        lengthCm: null,
        status: "unknown",
        source: "floor_plan",
        edited: false,
      },
      {
        id: "t3",
        name: "Bedroom 2",
        roomType: "bedroom",
        widthCm: null,
        lengthCm: null,
        status: "unknown",
        source: "template",
        edited: false,
      },
    ];
    store.writeRooms(local);
    store.patch({
      serverIds: {
        rooms: { fp1: living?.id as string, fp2: bed?.id as string },
      },
    });
    await syncJourney(api, { store });
    expect(db.rooms.map((r) => r.name)).toEqual([
      "Living room",
      "Bedroom 1",
      "Bedroom 2",
    ]);
    expect(db.rooms[0]?.id).toBe(living?.id);
  });

  it("finds the user's existing home instead of creating another", async () => {
    const { api, db } = fakeServer();
    db.homes.push({ id: "00000000-0000-4000-8000-0000000000ff", name: "Old" });
    const store = memoryStore({ budget: "1" }, null);
    await syncJourney(api, { store });
    expect(db.homes).toHaveLength(1);
    expect(store.state.data.homeId).toBe(
      "00000000-0000-4000-8000-0000000000ff",
    );
  });
});

describe("restore + ownership", () => {
  it("restores answers on an empty device", async () => {
    const { api, db } = fakeServer();
    const first = memoryStore(ANSWERS, ROOMS);
    await syncJourney(api, { store: first });

    const fresh = memoryStore({ lastStep: "home" }, null);
    const r = await restoreFromServer(api, "user_1", fresh);
    expect(r).toEqual({ restored: true, lastStep: "review" });
    expect(fresh.state.data.budget).toBe("6,000");
    expect(fresh.state.data.homeId).toBe(db.homes[0]?.id);
    expect(fresh.state.data.serverIds?.rooms?.l1).toBeTruthy();
    expect(fresh.state.rooms).toHaveLength(4);

    // And syncing the restored device doesn't duplicate anything.
    await syncJourney(api, { store: fresh });
    expect(db.rooms).toHaveLength(4);
    expect(db.persons).toHaveLength(4);
  });

  it("never overwrites answers already on the device", async () => {
    const { api } = fakeServer();
    await syncJourney(api, { store: memoryStore(ANSWERS, ROOMS) });
    const busy = memoryStore({ budget: "100" }, null);
    expect((await restoreFromServer(api, "u", busy)).restored).toBe(false);
    expect(busy.state.data.budget).toBe("100");
  });

  it("forgets another account's server ids", () => {
    const store = memoryStore(
      {
        ownerUserId: "a",
        homeId: "h",
        serverIds: { rooms: { x: "y" } },
        budget: "1",
      },
      null,
    );
    claimForUser(store, "b");
    expect(store.state.data).toMatchObject({
      ownerUserId: "b",
      homeId: undefined,
      serverIds: {},
      budget: "1",
    });
  });
});
