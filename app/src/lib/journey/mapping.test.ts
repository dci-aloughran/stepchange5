import type { ListingExtractResponse } from "@stepchange/shared";
import { describe, expect, it } from "vitest";
import type { PlanRoom } from "../rooms";
import {
  buildDraft,
  contentKey,
  formatPounds,
  hasAnswers,
  homeChanged,
  homePayload,
  householdChanged,
  householdPayload,
  isRoomConfirmed,
  listingAnswers,
  listingRooms,
  needPayload,
  needProblem,
  personLabel,
  personPayload,
  possessionPayload,
  poundsToPence,
  readDraft,
  reviewedRoomMap,
  roomPatch,
  roomPayload,
} from "./mapping";
import type { LocalNeed, LocalPerson } from "./types";

const ROOM_UUID = "11111111-1111-4111-8111-111111111111";
const PERSON_UUID = "22222222-2222-4222-8222-222222222222";

const room = (over: Partial<PlanRoom> = {}): PlanRoom => ({
  id: "r1",
  name: "Living room",
  roomType: "living_room",
  widthCm: 460,
  lengthCm: 380,
  status: "user_confirmed",
  source: "manual",
  edited: true,
  ...over,
});

describe("money", () => {
  it("parses pounds to pence", () => {
    expect(poundsToPence("6,000")).toBe(600_000);
    expect(poundsToPence("£6000.50")).toBe(600_050);
    expect(poundsToPence("6k")).toBe(600_000);
    expect(poundsToPence("")).toBeNull();
    expect(poundsToPence("abc")).toBeNull();
  });
  it("formats pence as pounds", () => {
    expect(formatPounds(600_000)).toBe("£6,000");
    expect(formatPounds(16_500_000)).toBe("£165,000");
    expect(formatPounds(null)).toBe("");
  });
});

describe("homePayload", () => {
  it("maps the home step to name, address and listing", () => {
    expect(
      homePayload({
        address: " 18 Rowan Court ",
        beds: "3",
        baths: "1",
        area: "58",
        price: "165,000",
        listingUrl: "https://example.com/x",
      }),
    ).toEqual({
      name: "18 Rowan Court",
      address: "18 Rowan Court",
      listing: {
        bedrooms: 3,
        bathrooms: 1,
        floorAreaSqm: 58,
        pricePence: 16_500_000,
      },
    });
  });
  it("falls back to a generic name and omits unknown values", () => {
    expect(homePayload({})).toEqual({
      name: "My home",
      address: null,
      listing: {},
    });
  });
  it("detects changes regardless of key order", () => {
    const desired = homePayload({ beds: "3", baths: "1" });
    expect(
      homeChanged(
        {
          name: "My home",
          address: null,
          listing: { bathrooms: 1, bedrooms: 3 },
        },
        desired,
      ),
    ).toBe(false);
    expect(
      homeChanged({ name: "My home", address: null, listing: {} }, desired),
    ).toBe(true);
  });
});

describe("householdPayload", () => {
  it("maps lifestyle, practical needs and budget", () => {
    const body = householdPayload({
      lifestyle: { wfhDaysPerWeek: 2, cooking: "daily", hobbies: [" piano "] },
      practical: { childSafety: true, storageLevel: "lots" },
      budget: "6,000",
      priorities: ["Durable"],
      timing: "Nursery by April",
    });
    expect(body).toEqual({
      lifestyle: { wfhDaysPerWeek: 2, cooking: "daily", hobbies: ["piano"] },
      practicalNeeds: {
        childSafety: true,
        storageLevel: "lots",
        notes: "Priorities: Durable\nTiming: Nursery by April",
      },
      budgetTotalPence: 600_000,
    });
    expect(
      householdChanged(
        {
          lifestyle: body.lifestyle,
          practicalNeeds: body.practicalNeeds,
          budgetTotalPence: 600_000,
        },
        body,
      ),
    ).toBe(false);
    expect(
      householdChanged(
        {
          lifestyle: body.lifestyle,
          practicalNeeds: body.practicalNeeds,
          budgetTotalPence: null,
        },
        body,
      ),
    ).toBe(true);
  });
  it("clears the budget when it is removed", () => {
    expect(householdPayload({}).budgetTotalPence).toBeNull();
  });
});

describe("persons", () => {
  const people: LocalPerson[] = [
    { id: "a", role: "adult", ageYears: 34, worksFromHome: true },
    { id: "b", role: "adult", ageYears: null },
    { id: "c", role: "child", ageYears: null, onTheWay: true },
    { id: "d", role: "regular_visitor", ageYears: 68, label: "Mum" },
  ];
  it("labels people by role unless they have their own label", () => {
    expect(people.map((p) => personLabel(people, p))).toEqual([
      "Adult 1",
      "Adult 2",
      "Child 1",
      "Mum",
    ]);
  });
  it("stores a baby on the way as age 0 with a note", () => {
    expect(personPayload(people, people[2] as LocalPerson)).toEqual({
      role: "child",
      label: "Child 1",
      ageYears: 0,
      routines: { notes: "Baby on the way" },
    });
    expect(personPayload(people, people[0] as LocalPerson).routines).toEqual({
      worksFromHome: true,
    });
  });
});

describe("accessibility needs", () => {
  const turning: LocalNeed = {
    id: "n1",
    needType: "turning_area",
    scope: "room",
    roomId: "r1",
    params: { diameterCm: "150" },
    confirmed: true,
  };
  it("maps local room ids to server ids and numbers", () => {
    const r = needPayload(turning, {
      rooms: { r1: ROOM_UUID },
      persons: {},
    });
    expect(r).toEqual({
      ok: true,
      value: {
        needType: "turning_area",
        scope: "room",
        roomId: ROOM_UUID,
        personId: null,
        params: { diameterCm: 150 },
        confirmed: true,
        notes: null,
      },
    });
  });
  it("rejects incomplete needs", () => {
    expect(
      needPayload(
        { ...turning, params: {} },
        { rooms: { r1: ROOM_UUID }, persons: {} },
      ).ok,
    ).toBe(false);
    // Room not synced yet / removed.
    expect(needPayload(turning, { rooms: {}, persons: {} }).ok).toBe(false);
    expect(
      needPayload(
        {
          id: "n2",
          needType: "reach_range",
          scope: "home",
          params: { minCm: "120", maxCm: "40" },
          confirmed: false,
        },
        { rooms: {}, persons: {} },
      ).ok,
    ).toBe(false);
  });
  it("supports person scope and preference needs", () => {
    const r = needPayload(
      {
        id: "n3",
        needType: "step_free",
        scope: "person",
        personId: "d",
        params: { details: " ramps " },
        confirmed: false,
      },
      { rooms: {}, persons: { d: PERSON_UUID } },
    );
    expect(r.ok && r.value).toMatchObject({
      scope: "person",
      personId: PERSON_UUID,
      roomId: null,
      params: { details: "ramps" },
    });
  });
  it("explains problems before sign-in", () => {
    expect(needProblem(turning, ["r1"], [])).toBeNull();
    expect(needProblem(turning, [], [])).toMatch(/room was removed/);
    expect(needProblem({ ...turning, params: {} }, ["r1"], [])).toMatch(
      /measurements/,
    );
  });
});

describe("possessions", () => {
  it("maps size, room and keep", () => {
    expect(
      possessionPayload(
        {
          id: "p1",
          name: " Grey sofa ",
          category: "Sofa",
          widthCm: 210,
          depthCm: null,
          heightCm: 0,
          roomId: "r1",
          keep: true,
        },
        { r1: ROOM_UUID },
      ),
    ).toEqual({
      name: "Grey sofa",
      category: "Sofa",
      widthCm: 210,
      depthCm: null,
      heightCm: null,
      keep: true,
      notes: null,
      roomId: ROOM_UUID,
    });
  });
});

describe("rooms", () => {
  it("maps a local room", () => {
    expect(roomPayload(room())).toEqual({
      name: "Living room",
      roomType: "living_room",
      widthCm: 460,
      lengthCm: 380,
      dimensionStatus: "user_confirmed",
    });
    expect(
      roomPayload(room({ widthCm: null, lengthCm: null, status: "unknown" }))
        .dimensionStatus,
    ).toBe("unknown");
  });
  it("patches only what changed so reviews aren't cleared needlessly", () => {
    const server = {
      name: "Living room",
      roomType: "living_room",
      widthCm: 460,
      lengthCm: 380,
      dimensionStatus: "user_confirmed",
    };
    expect(roomPatch(server, roomPayload(room()))).toBeNull();
    expect(roomPatch(server, roomPayload(room({ name: "Lounge" })))).toEqual({
      name: "Lounge",
    });
    expect(roomPatch(server, roomPayload(room({ widthCm: 470 })))).toEqual({
      widthCm: 470,
      dimensionStatus: "user_confirmed",
    });
  });
  it("tracks which rooms the user confirmed", () => {
    const rooms = [room(), room({ id: "r2", name: "Bedroom 1" })];
    const reviewed = reviewedRoomMap(rooms);
    expect(isRoomConfirmed(rooms[0] as PlanRoom, reviewed)).toBe(true);
    expect(isRoomConfirmed(room({ widthCm: 300 }), reviewed)).toBe(false);
    expect(isRoomConfirmed(room({ id: "r3" }), reviewed)).toBe(false);
  });
});

describe("listing preview", () => {
  const result: ListingExtractResponse = {
    details: {
      address: "18 Rowan Court",
      pricePence: 16_500_000,
      priceQualifier: null,
      tenure: null,
      propertyType: "flat",
      propertySubtype: null,
      bedrooms: 2,
      bathrooms: null,
      receptions: null,
      floorAreaSqm: 58,
      keyFeatures: [],
      summary: "Ground floor flat",
      agent: null,
      portal: null,
    },
    rooms: [
      {
        name: "Bedroom 1",
        roomType: "bedroom",
        widthCm: 360,
        lengthCm: 320,
        dimensionStatus: "source_printed",
      },
    ],
    photoUploadIds: [],
    floorPlanUploadId: null,
    missing: [],
    notes: [],
    sourceUrl: null,
    modelVersion: "m",
    promptVersion: "p",
  };
  it("fills only known values", () => {
    expect(listingAnswers(result)).toEqual({
      propertyType: "Flat",
      beds: "2",
      area: "58",
      price: "165,000",
      address: "18 Rowan Court",
      listingDescription: "Ground floor flat",
      listingPhotoUploadIds: [],
      listingFloorPlanUploadId: null,
    });
  });
  it("seeds rooms unless the user already edited them", () => {
    const basics = { propertyType: "flat" as const, bedrooms: 2, bathrooms: 1 };
    const seeded = listingRooms(result, null, basics);
    expect(seeded?.map((r) => r.name)).toEqual([
      "Bedroom 1",
      "Bedroom 2",
      "Bathroom 1",
    ]);
    expect(seeded?.[1]?.note).toMatch(/listing/);
    expect(listingRooms(result, [room()], basics)).toBeNull();
    expect(listingRooms({ ...result, rooms: [] }, null, basics)).toBeNull();
  });
});

describe("resume", () => {
  it("ignores bookkeeping when checking for answers", () => {
    expect(hasAnswers({})).toBe(false);
    expect(
      hasAnswers({
        lastStep: "home",
        ownerUserId: "u",
        people: [],
        budget: "",
      }),
    ).toBe(false);
    expect(hasAnswers({ budget: "6,000" })).toBe(true);
  });
  it("round-trips a draft without the device owner", () => {
    const draft = buildDraft({ budget: "6,000", ownerUserId: "u1" }, [room()]);
    expect(draft.answers).toEqual({ budget: "6,000" });
    expect(readDraft(draft)).toEqual({
      answers: { budget: "6,000" },
      rooms: [room()],
    });
    expect(readDraft({ version: 2 })).toBeNull();
    expect(readDraft(null)).toBeNull();
  });
  it("content key ignores sync ids", () => {
    expect(contentKey({ budget: "1" }, null)).toBe(
      contentKey({ budget: "1", homeId: "h", serverIds: { rooms: {} } }, null),
    );
    expect(contentKey({ budget: "1" }, null)).not.toBe(
      contentKey({ budget: "2" }, null),
    );
  });
});
