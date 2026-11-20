import { describe, expect, it } from "vitest";
import {
  featureInsertValues,
  featureUpdateValues,
  planRoomCreate,
  planRoomUpdate,
  weakerStatus,
} from "./rooms.js";

const ROOM_ID = "00000000-0000-4000-8000-000000000001";

describe("planRoomCreate", () => {
  it("defaults user-entered dimensions to user_confirmed with provenance rows", () => {
    const plan = planRoomCreate(ROOM_ID, {
      name: "Living room",
      widthCm: 400,
      lengthCm: 500,
    });
    expect(plan.values).toMatchObject({
      name: "Living room",
      roomType: "other",
      selected: true,
      widthCm: 400,
      lengthCm: 500,
      heightCm: null,
      dimensionStatus: "user_confirmed",
    });
    expect(plan.measurements).toEqual([
      {
        roomId: ROOM_ID,
        kind: "width",
        valueCm: 400,
        status: "user_confirmed",
        source: "user",
        sourceUploadId: null,
        confidence: null,
      },
      expect.objectContaining({ kind: "length", valueCm: 500 }),
    ]);
  });

  it("is unknown with no measurements when no dimensions are given", () => {
    const plan = planRoomCreate(ROOM_ID, { name: "Hall" });
    expect(plan.values.dimensionStatus).toBe("unknown");
    expect(plan.measurements).toEqual([]);
  });

  it("keeps a given status, source and confidence", () => {
    const plan = planRoomCreate(ROOM_ID, {
      name: "Bedroom",
      widthCm: 300,
      dimensionStatus: "estimated",
      dimensionSource: "floor_plan",
      confidence: 0.4,
    });
    expect(plan.values.dimensionStatus).toBe("estimated");
    expect(plan.measurements[0]).toMatchObject({
      status: "estimated",
      source: "floor_plan",
      confidence: 0.4,
    });
  });
});

describe("planRoomUpdate", () => {
  const current = {
    id: ROOM_ID,
    widthCm: 400,
    lengthCm: 500,
    heightCm: null,
    dimensionStatus: "estimated" as const,
  };

  it("does not touch dimensions or review for a rename", () => {
    const plan = planRoomUpdate(current, { name: "Lounge" });
    expect(plan.set).toEqual({ name: "Lounge" });
    expect(plan.measurements).toEqual([]);
    expect(plan.invalidatesReview).toBe(false);
  });

  it("records only changed dimensions and clears the review", () => {
    const plan = planRoomUpdate(current, { widthCm: 410, lengthCm: 520 });
    expect(plan.set).toMatchObject({
      widthCm: 410,
      lengthCm: 520,
      dimensionStatus: "user_confirmed",
      reviewedAt: null,
    });
    expect(plan.measurements.map((m) => [m.kind, m.valueCm, m.status])).toEqual(
      [
        ["width", 410, "user_confirmed"],
        ["length", 520, "user_confirmed"],
      ],
    );
    expect(plan.invalidatesReview).toBe(true);
  });

  it("does not overclaim when an estimated plan dimension is untouched", () => {
    const plan = planRoomUpdate(current, { widthCm: 410 });
    expect(plan.set.dimensionStatus).toBe("estimated");
    expect(plan.measurements).toHaveLength(1);
    expect(plan.measurements[0]?.status).toBe("user_confirmed");
  });

  it("ignores values equal to the current ones", () => {
    const plan = planRoomUpdate(current, { widthCm: 400 });
    expect(plan.measurements).toEqual([]);
    expect(plan.invalidatesReview).toBe(false);
  });

  it("re-records known dimensions on a status-only change", () => {
    const plan = planRoomUpdate(current, { dimensionStatus: "user_confirmed" });
    expect(plan.set.dimensionStatus).toBe("user_confirmed");
    expect(plan.measurements.map((m) => m.kind)).toEqual(["width", "length"]);
    expect(plan.invalidatesReview).toBe(true);
  });

  it("records a cleared dimension as unknown", () => {
    const plan = planRoomUpdate(
      { ...current, lengthCm: null, dimensionStatus: "user_confirmed" },
      { widthCm: null },
    );
    expect(plan.set).toMatchObject({
      widthCm: null,
      dimensionStatus: "unknown",
    });
    expect(plan.measurements[0]).toMatchObject({
      kind: "width",
      valueCm: null,
      status: "unknown",
    });
  });

  it("clears the review when the polygon changes", () => {
    const plan = planRoomUpdate(current, {
      polygon: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 500 },
      ],
    });
    expect(plan.invalidatesReview).toBe(true);
    expect(plan.set.reviewedAt).toBeNull();
  });
});

describe("weakerStatus", () => {
  it("picks the weaker provenance", () => {
    expect(weakerStatus("user_confirmed", "estimated")).toBe("estimated");
    expect(weakerStatus("unknown", "calculated")).toBe("unknown");
    expect(weakerStatus("source_printed", "user_confirmed")).toBe(
      "source_printed",
    );
  });
});

describe("feature values", () => {
  it("defaults status from whether dimensions were given", () => {
    expect(featureInsertValues(ROOM_ID, { type: "door" }).status).toBe(
      "unknown",
    );
    expect(
      featureInsertValues(ROOM_ID, { type: "door", widthCm: 76 }).status,
    ).toBe("user_confirmed");
    expect(
      featureInsertValues(ROOM_ID, {
        type: "window",
        widthCm: 120,
        status: "estimated",
      }).status,
    ).toBe("estimated");
  });

  it("marks edited dimensions as user-confirmed", () => {
    const current = { widthCm: null, heightCm: null, offsetCm: null };
    expect(featureUpdateValues(current, { widthCm: 80 })).toEqual({
      widthCm: 80,
      status: "user_confirmed",
    });
    expect(featureUpdateValues(current, { notes: "sticks" })).toEqual({
      notes: "sticks",
    });
  });
});
