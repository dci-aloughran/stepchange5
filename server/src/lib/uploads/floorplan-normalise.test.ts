import {
  type FloorplanDimension,
  type FloorplanExtraction,
  FloorplanExtractionSchema,
} from "@stepchange/shared";
import { describe, expect, it } from "vitest";
import {
  NotAFloorPlanError,
  normaliseDimension,
  normaliseExtraction,
  normaliseRoomType,
} from "./floorplan-normalise.js";

const range = { min: 50, max: 3000 };

function dim(p: Partial<FloorplanDimension>): FloorplanDimension {
  return {
    valueCm: 345,
    status: "source_printed",
    basis: "printed_label",
    confidence: 0.9,
    printedText: "3.45m",
    ...p,
  };
}

function extraction(p: Partial<FloorplanExtraction> = {}): FloorplanExtraction {
  return {
    isFloorPlan: true,
    floors: [{ name: "Ground Floor", level: 0 }],
    rooms: [
      {
        name: "Kitchen",
        roomType: "Kitchen",
        floorLevel: 0,
        width: dim({}),
        length: dim({ valueCm: 410, printedText: "4.10m" }),
        features: [{ type: "door", wall: "south", widthCm: null, notes: null }],
        notes: null,
      },
    ],
    labels: ["Not to scale"],
    scale: { hasScaleBar: false, printedScale: null },
    needsKnownMeasurement: false,
    uncertaintyNotes: [],
    ...p,
  };
}

describe("FloorplanExtractionSchema", () => {
  it("accepts a well-formed model output", () => {
    expect(FloorplanExtractionSchema.parse(extraction())).toBeTruthy();
  });

  it("rejects invalid statuses and feature types", () => {
    const bad = extraction();
    (bad.rooms[0] as { width: { status: string } }).width.status =
      "user_confirmed";
    expect(FloorplanExtractionSchema.safeParse(bad).success).toBe(false);
    const bad2 = extraction();
    (bad2.rooms[0]?.features[0] as { type: string }).type = "trapdoor";
    expect(FloorplanExtractionSchema.safeParse(bad2).success).toBe(false);
  });
});

describe("normaliseDimension (FP-003 / FP-005)", () => {
  it("keeps source_printed only with a printed label", () => {
    expect(normaliseDimension(dim({}), range).dim).toEqual({
      valueCm: 345,
      status: "source_printed",
      confidence: 0.9,
    });
  });

  it("downgrades source_printed from a scale bar to low-confidence estimated", () => {
    expect(
      normaliseDimension(dim({ basis: "scale_bar", confidence: 0.9 }), range)
        .dim,
    ).toEqual({ valueCm: 345, status: "estimated", confidence: 0.5 });
  });

  it("never keeps a value without a printed basis (no pixel/page-size scale)", () => {
    expect(
      normaliseDimension(dim({ status: "estimated", basis: "none" }), range)
        .dim,
    ).toEqual({ valueCm: null, status: "unknown", confidence: null });
    expect(
      normaliseDimension(
        dim({ status: "source_printed", basis: "none" }),
        range,
      ).dim.status,
    ).toBe("unknown");
  });

  it("drops values for unknown status and implausible numbers", () => {
    expect(
      normaliseDimension(dim({ status: "unknown" }), range).dim.valueCm,
    ).toBeNull();
    const r = normaliseDimension(dim({ valueCm: 99999 }), range);
    expect(r.implausible).toBe(true);
    expect(r.dim.status).toBe("unknown");
  });

  it("clamps confidence", () => {
    expect(
      normaliseDimension(dim({ confidence: 7 }), range).dim.confidence,
    ).toBe(1);
  });
});

describe("normaliseExtraction", () => {
  it("normalises a fully printed plan", () => {
    const n = normaliseExtraction(extraction());
    expect(n.rooms[0]).toMatchObject({
      name: "Kitchen",
      roomType: "kitchen",
      dimensionStatus: "source_printed",
    });
    expect(n.needsKnownMeasurement).toBe(false);
    expect(n.warnings).toEqual([]);
  });

  it("flags rooms with unknown dimensions and requests a measurement", () => {
    const e = extraction();
    if (e.rooms[0]) {
      e.rooms[0].length = dim({
        valueCm: null,
        status: "unknown",
        basis: "none",
      });
    }
    const n = normaliseExtraction(e);
    expect(n.rooms[0]?.dimensionStatus).toBe("unknown");
    expect(n.needsKnownMeasurement).toBe(true);
    expect(n.uncertaintyNotes.length).toBeGreaterThan(0);
    expect(n.warnings.join(" ")).toMatch(/measure/i);
  });

  it("creates missing floors and defaults to a ground floor", () => {
    const e = extraction({ floors: [] });
    if (e.rooms[0]) e.rooms[0].floorLevel = 1;
    const n = normaliseExtraction(e);
    expect(n.floors).toEqual([{ name: "First floor", level: 1 }]);
    expect(
      normaliseExtraction(extraction({ floors: [], rooms: [] })).floors,
    ).toEqual([{ name: "Ground floor", level: 0 }]);
  });

  it("throws for non floor plans", () => {
    expect(() =>
      normaliseExtraction(extraction({ isFloorPlan: false })),
    ).toThrow(NotAFloorPlanError);
  });

  it("maps room type aliases", () => {
    expect(normaliseRoomType("Lounge")).toBe("living_room");
    expect(normaliseRoomType("En-suite")).toBe("en_suite");
    expect(normaliseRoomType("Wine cellar")).toBe("other");
  });
});
