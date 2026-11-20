import { describe, expect, it } from "vitest";
import {
  countOf,
  type HomeBasics,
  type PlanRoom,
  parseLength,
  reconcileRooms,
  roomsFromFloorPlan,
  templateRooms,
} from "./rooms";

const house3: HomeBasics = { propertyType: "house", bedrooms: 3, bathrooms: 1 };

describe("templateRooms", () => {
  it("gives a 3 bed house exactly three bedrooms", () => {
    const rooms = templateRooms(house3);
    expect(countOf(rooms, "bedroom")).toBe(3);
    expect(countOf(rooms, "bathroom")).toBe(1);
    expect(rooms.map((r) => r.name)).toEqual([
      "Living room",
      "Kitchen / diner",
      "Hallway",
      "Landing",
      "Main bedroom",
      "Bedroom 2",
      "Bedroom 3",
      "Bathroom",
    ]);
  });

  it("has no landing for a flat and never invents sizes", () => {
    const rooms = templateRooms({
      propertyType: "flat",
      bedrooms: 1,
      bathrooms: 1,
    });
    expect(rooms.some((r) => r.roomType === "landing")).toBe(false);
    expect(
      rooms.every((r) => r.widthCm === null && r.status === "unknown"),
    ).toBe(true);
    expect(rooms.find((r) => r.roomType === "bedroom")?.name).toBe("Bedroom 1");
  });
});

describe("reconcileRooms", () => {
  it("adds bedrooms when the count goes up", () => {
    const { rooms } = reconcileRooms(templateRooms(house3), {
      ...house3,
      bedrooms: 4,
    });
    expect(countOf(rooms, "bedroom")).toBe(4);
    expect(rooms.some((r) => r.name === "Bedroom 4")).toBe(true);
  });

  it("removes untouched template bedrooms when the count goes down", () => {
    const { rooms, warnings } = reconcileRooms(templateRooms(house3), {
      ...house3,
      bedrooms: 2,
    });
    expect(countOf(rooms, "bedroom")).toBe(2);
    expect(warnings).toEqual([]);
  });

  it("keeps edited bedrooms and warns instead of deleting them", () => {
    const rooms = templateRooms(house3).map((r) =>
      r.roomType === "bedroom" ? { ...r, edited: true } : r,
    );
    const result = reconcileRooms(rooms, { ...house3, bedrooms: 2 });
    expect(countOf(result.rooms, "bedroom")).toBe(3);
    expect(result.warnings[0]).toMatch(/You said 2 bedrooms, but 3/);
  });

  it("does not reuse an existing bedroom name", () => {
    const rooms: PlanRoom[] = templateRooms({ ...house3, bedrooms: 0 });
    rooms.push({
      ...rooms[0],
      id: "x",
      name: "Bedroom 2",
      roomType: "study",
    } as PlanRoom);
    const result = reconcileRooms(rooms, { ...house3, bedrooms: 2 });
    const names = result.rooms
      .filter((r) => r.roomType === "bedroom")
      .map((r) => r.name);
    expect(names).toEqual(["Bedroom 1", "Bedroom 3"]);
  });
});

describe("roomsFromFloorPlan", () => {
  it("tops up bedrooms the plan didn't show and flags them", () => {
    const { rooms } = roomsFromFloorPlan(
      [
        {
          name: "Lounge",
          roomType: "living_room",
          widthCm: 460,
          lengthCm: 380,
          dimensionStatus: "source_printed",
        },
        {
          name: "Bedroom 1",
          roomType: "bedroom",
          widthCm: 360,
          lengthCm: null,
          dimensionStatus: "source_printed",
        },
        {
          name: "Bed 2",
          roomType: "bedroom",
          widthCm: null,
          lengthCm: null,
          dimensionStatus: "unknown",
        },
        {
          name: "Snug",
          roomType: "den",
          widthCm: null,
          lengthCm: null,
          dimensionStatus: "unknown",
        },
      ],
      house3,
    );
    expect(countOf(rooms, "bedroom")).toBe(3);
    const added = rooms.find((r) => r.name === "Bedroom 3");
    expect(added?.note).toMatch(/Not found on the floor plan/);
    expect(rooms.find((r) => r.name === "Snug")?.roomType).toBe("other");
    // One known side is not enough to claim a printed size.
    expect(rooms.find((r) => r.name === "Bedroom 1")?.status).toBe("unknown");
    expect(rooms.find((r) => r.name === "Lounge")?.status).toBe(
      "source_printed",
    );
    expect(countOf(rooms, "bathroom")).toBe(1);
  });
});

describe("parseLength", () => {
  it.each([
    ["4.6", 460],
    ["4.6 m", 460],
    ["460cm", 460],
    ["460", 460],
    ["3,1", 310],
    ["2700mm", 270],
  ])("%s → %d cm", (input, cm) => {
    expect(parseLength(input)).toBe(cm);
  });

  it.each(["", "abc", "-2", "0"])("rejects %j", (input) => {
    expect(parseLength(input)).toBeNull();
  });
});
