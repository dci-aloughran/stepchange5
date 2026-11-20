import { describe, expect, it } from "vitest";
import type { FeatureRow, FloorRow, HomeRow, RoomRow } from "./dto.js";
import { areaSqm, buildHomeOverview, dimensionState } from "./overview.js";

const t = new Date("2026-11-20T12:00:00Z");

const home: HomeRow = {
  id: "10000000-0000-4000-8000-000000000000",
  userId: "user_1",
  householdId: null,
  name: "Flat",
  journeyType: "homeowner",
  source: "manual",
  address: "1 Secret Street",
  listing: {},
  retentionState: "active",
  retainUntil: null,
  createdAt: t,
  updatedAt: t,
};

const floor: FloorRow = {
  id: "20000000-0000-4000-8000-000000000000",
  homeId: home.id,
  name: "Ground",
  level: 0,
  createdAt: t,
};

let n = 0;
function room(over: Partial<RoomRow>): RoomRow {
  n++;
  return {
    id: `30000000-0000-4000-8000-00000000000${n}`,
    homeId: home.id,
    floorId: floor.id,
    name: `Room ${n}`,
    roomType: "other",
    selected: true,
    widthCm: 300,
    lengthCm: 400,
    heightCm: null,
    dimensionStatus: "user_confirmed",
    polygon: null,
    reviewedAt: t,
    createdAt: new Date(t.getTime() + n),
    updatedAt: t,
    ...over,
  };
}

function feature(roomId: string, over: Partial<FeatureRow>): FeatureRow {
  return {
    id: "40000000-0000-4000-8000-000000000000",
    roomId,
    type: "door",
    wall: "north",
    offsetCm: null,
    widthCm: null,
    heightCm: null,
    status: "unknown",
    notes: null,
    createdAt: t,
    ...over,
  };
}

describe("dimensionState", () => {
  it("classifies provenance", () => {
    const base = { widthCm: 1, lengthCm: 1 };
    expect(dimensionState({ ...base, dimensionStatus: "calculated" })).toBe(
      "known",
    );
    expect(dimensionState({ ...base, dimensionStatus: "estimated" })).toBe(
      "estimated",
    );
    expect(dimensionState({ ...base, dimensionStatus: "unknown" })).toBe(
      "unknown",
    );
    expect(
      dimensionState({
        widthCm: 1,
        lengthCm: null,
        dimensionStatus: "user_confirmed",
      }),
    ).toBe("unknown");
  });

  it("computes area in square metres to 1dp", () => {
    expect(areaSqm(345, 412)).toBe(14.2);
    expect(areaSqm(null, 412)).toBeNull();
  });
});

describe("buildHomeOverview", () => {
  it("asks for rooms when there are none", () => {
    const o = buildHomeOverview(home, [], [], []);
    expect(o.warnings.map((w) => w.code)).toEqual(["no_rooms"]);
    expect(o.summary.readyForLayouts).toBe(false);
    // The overview never includes the address.
    expect(JSON.stringify(o)).not.toContain("Secret");
  });

  it("flags unknown/estimated dims, unmeasured doors and unreviewed rooms", () => {
    const ready = room({ name: "Kitchen" });
    const unknown = room({
      name: "Lounge",
      widthCm: null,
      lengthCm: null,
      dimensionStatus: "unknown",
      reviewedAt: null,
    });
    const estimated = room({ name: "Bedroom", dimensionStatus: "estimated" });
    const ignored = room({ name: "Loft", selected: false, widthCm: null });
    const o = buildHomeOverview(
      home,
      [floor],
      [ready, unknown, estimated, ignored],
      [feature(ready.id, {}), feature(ready.id, { type: "radiator" })],
    );

    expect(o.warnings.map((w) => [w.code, w.roomId])).toEqual([
      ["feature_dimensions_unknown", ready.id],
      ["dimensions_unknown", unknown.id],
      ["room_not_reviewed", unknown.id],
      ["dimensions_estimated", estimated.id],
    ]);
    expect(o.warnings[1]?.message).toContain("Lounge");
    expect(o.warnings[1]?.action).toBe("measure_room");

    expect(
      o.rooms.map((r) => [r.name, r.dimensionState, r.readyForLayouts]),
    ).toEqual([
      ["Kitchen", "known", true],
      ["Lounge", "unknown", false],
      ["Bedroom", "estimated", false],
      ["Loft", "unknown", false],
    ]);
    expect(o.rooms[0]?.featureCount).toBe(2);
    expect(o.summary).toEqual({
      totalRooms: 4,
      selectedRooms: 3,
      reviewedRooms: 3,
      roomsNeedingMeasurement: 2,
      roomsReadyForLayouts: 1,
      readyForLayouts: false,
    });
  });

  it("is ready when every selected room is reviewed with known dims", () => {
    const o = buildHomeOverview(home, [floor], [room({}), room({})], []);
    expect(o.warnings).toEqual([]);
    expect(o.summary.readyForLayouts).toBe(true);
  });

  it("asks the user to select rooms when none are selected", () => {
    const o = buildHomeOverview(home, [floor], [room({ selected: false })], []);
    expect(o.warnings.map((w) => w.code)).toEqual(["no_rooms_selected"]);
  });

  it("orders rooms by floor level", () => {
    const upstairs: FloorRow = { ...floor, id: "upstairs", level: 1 };
    const a = room({ name: "Up", floorId: upstairs.id });
    const b = room({ name: "Down" });
    const o = buildHomeOverview(home, [upstairs, floor], [a, b], []);
    expect(o.rooms.map((r) => r.name)).toEqual(["Down", "Up"]);
    expect(o.floors.map((f) => f.level)).toEqual([0, 1]);
  });
});
