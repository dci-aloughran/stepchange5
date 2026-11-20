import type { Layout, PlacementDto } from "@stepchange/shared";
import { describe, expect, it } from "vitest";
import {
  conflictSets,
  describeLayout,
  describePosition,
  featureShape,
  fitLabel,
  placementKeys,
  placementRect,
  schematicFrame,
  wallBasis,
} from "./schematic";

const sofa: PlacementDto = {
  requirementId: "sofa",
  label: "Sofa",
  xCm: 10,
  yCm: 20,
  widthCm: 200,
  depthCm: 90,
  rotationDeg: 0,
};

describe("schematicFrame", () => {
  it("builds a cm viewBox with padding and a scale bar", () => {
    const f = schematicFrame(460, 380);
    expect(f.pad).toBe(37);
    expect(f.viewBox).toBe(`-37 -37 ${460 + 74} ${380 + 37 * 2.6}`);
    expect(f.scaleBarCm).toBe(100);
    expect(f.fontSize).toBeCloseTo(460 / 30);
  });
  it("picks a smaller scale bar for small rooms", () => {
    expect(schematicFrame(120, 200).scaleBarCm).toBe(25);
    expect(schematicFrame(900, 600).scaleBarCm).toBe(200);
  });
});

describe("placementRect", () => {
  it("keeps width along x for 0/180", () => {
    expect(placementRect(sofa)).toEqual({ x: 10, y: 20, w: 200, d: 90 });
    expect(placementRect({ ...sofa, rotationDeg: 180 })).toEqual({
      x: 10,
      y: 20,
      w: 200,
      d: 90,
    });
  });
  it("swaps width and depth for 90/270", () => {
    expect(placementRect({ ...sofa, rotationDeg: 90 })).toEqual({
      x: 10,
      y: 20,
      w: 90,
      d: 200,
    });
  });
});

describe("featureShape", () => {
  it("places a north-wall door from the west end with an inward swing", () => {
    const s = featureShape(
      { id: "d", type: "door", wall: "north", offsetCm: 50, widthCm: 80 },
      460,
      380,
    );
    expect(s?.from).toEqual({ x: 50, y: 0 });
    expect(s?.to).toEqual({ x: 130, y: 0 });
    expect(s?.swingPath).toBe("M 50 0 L 50 80 A 80 80 0 0 0 130 0");
  });
  it("places east-wall features from the north end", () => {
    const s = featureShape(
      { id: "w", type: "window", wall: "east", offsetCm: 100, widthCm: 120 },
      460,
      380,
    );
    expect(s?.from).toEqual({ x: 460, y: 100 });
    expect(s?.to).toEqual({ x: 460, y: 220 });
    expect(s?.swingPath).toBeNull();
  });
  it("swings south and west doors into the room", () => {
    const south = featureShape(
      { id: "s", type: "door", wall: "south", offsetCm: 0, widthCm: 90 },
      400,
      300,
    );
    expect(south?.swingPath).toBe("M 0 300 L 0 210 A 90 90 0 0 1 90 300");
    const west = featureShape(
      { id: "w", type: "door", wall: "west", offsetCm: 10, widthCm: 90 },
      400,
      300,
    );
    expect(west?.swingPath).toBe("M 0 10 L 90 10 A 90 90 0 0 1 0 100");
  });
  it("assumes default widths and clamps features to the wall", () => {
    const s = featureShape(
      { id: "d", type: "door", wall: "north", offsetCm: 440, widthCm: null },
      460,
      380,
    );
    expect(s?.widthAssumed).toBe(true);
    expect(s?.to.x).toBe(460);
    expect(s?.from.x).toBe(370);
  });
  it("returns null for unlocated features", () => {
    expect(
      featureShape(
        { id: "x", type: "door", wall: null, offsetCm: null, widthCm: 80 },
        460,
        380,
      ),
    ).toBeNull();
  });
  it("has unit inward normals pointing into the room", () => {
    for (const wall of ["north", "east", "south", "west"] as const) {
      const b = wallBasis(wall, 400, 300);
      const p = {
        x: b.start.x + b.inward.x * 10,
        y: b.start.y + b.inward.y * 10,
      };
      expect(p.x >= 0 && p.x <= 400 && p.y >= 0 && p.y <= 300).toBe(true);
    }
  });
});

const validation: NonNullable<Layout["validation"]> = {
  verifiedFit: false,
  verifiedAccessible: false,
  conflicts: [
    {
      code: "zone_overlap",
      message: "Sofa blocks the door swing.",
      requirementId: "sofa",
      severity: "error",
      kind: "fit",
    },
  ],
  warnings: [
    {
      code: "window_front",
      message: "Desk is in front of a window.",
      requirementId: "desk",
      severity: "warning",
      kind: "fit",
    },
    {
      code: "radiator_front",
      message: "Sofa near radiator.",
      requirementId: "sofa",
      severity: "warning",
      kind: "fit",
    },
  ],
  reasons: ["1 item conflicts with the room."],
  notes: [],
  needs: [],
  repairs: [],
};

describe("conflicts and text alternative", () => {
  it("separates error and warning requirement ids", () => {
    const { errors, warnings } = conflictSets(validation);
    expect([...errors]).toEqual(["sofa"]);
    expect([...warnings]).toEqual(["desk"]);
    expect(conflictSets(null).errors.size).toBe(0);
  });
  it("gives repeated requirements unique keys", () => {
    expect(
      placementKeys([sofa, sofa, { ...sofa, requirementId: "x" }]),
    ).toEqual(["sofa#1", "sofa#2", "x#1"]);
  });
  it("truncates labels to fit", () => {
    expect(fitLabel("Sofa", { x: 0, y: 0, w: 200, d: 90 }, 12)).toBe("Sofa");
    expect(
      fitLabel("Very long bookcase label", { x: 0, y: 0, w: 60, d: 30 }, 12),
    ).toBe("Very lon…");
    expect(fitLabel("Lamp", { x: 0, y: 0, w: 10, d: 10 }, 12)).toBe("");
  });
  it("describes positions", () => {
    expect(describePosition({ x: 0, y: 0, w: 50, d: 50 }, 400, 300)).toBe(
      "against the north and west wall",
    );
    expect(describePosition({ x: 180, y: 130, w: 40, d: 40 }, 400, 300)).toBe(
      "centre",
    );
  });
  it("describes the whole layout in words", () => {
    const text = describeLayout(
      {
        placements: [sofa],
        zones: [
          {
            kind: "turning_area",
            label: "Turning space 150cm",
            xCm: 100,
            yCm: 100,
            widthCm: 150,
            depthCm: 150,
            hard: true,
            accessibility: true,
          },
        ],
        validation,
        room: {
          widthCm: 460,
          lengthCm: 380,
          dimensionStatus: "user_confirmed",
        },
      },
      [{ type: "door", wall: "north" }],
    );
    expect(text).toContain("4.6 metres wide");
    expect(text).toContain("door on the north wall");
    expect(text).toContain("Sofa (200 by 90 cm)");
    expect(text).toContain("Turning space 150cm");
    expect(text).toContain("Fit not verified");
    expect(text).toContain("Sofa blocks the door swing.");
  });
  it("explains when the room can't be drawn", () => {
    expect(
      describeLayout({
        placements: [],
        zones: [],
        validation: null,
        room: { widthCm: null, lengthCm: 300, dimensionStatus: "unknown" },
      }),
    ).toMatch(/cannot be drawn to scale/);
  });
});
