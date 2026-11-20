import { describe, expect, it } from "vitest";
import { postCheckBrief } from "./brief-checks.js";
import { validateWithRepair } from "./repair.js";
import type {
  FeatureInput,
  LayoutItem,
  NeedInput,
  RoomGeometry,
} from "./types.js";
import { validateLayout } from "./validator.js";

const room: RoomGeometry = {
  widthCm: 400,
  lengthCm: 500,
  dimensionStatus: "user_confirmed",
};
const door: FeatureInput = {
  type: "door",
  wall: "north",
  offsetCm: 20,
  widthCm: 90,
  status: "user_confirmed",
};

function item(p: Partial<LayoutItem> & { label: string }): LayoutItem {
  return {
    requirementId: p.label.toLowerCase(),
    category: p.label.toLowerCase(),
    priority: "should",
    xCm: 0,
    yCm: 0,
    widthCm: 100,
    depthCm: 50,
    rotationDeg: 0,
    heightCm: null,
    dimsKnown: true,
    ...p,
  };
}

const turning: NeedInput = {
  needType: "turning_area",
  params: { turningDiameterCm: 150 },
  confirmed: true,
};

describe("validateLayout", () => {
  it("verifies a clean layout with confirmed dims", () => {
    const r = validateLayout({
      room,
      features: [door],
      needs: [],
      items: [
        item({ label: "Sofa", xCm: 0, yCm: 400, widthCm: 200, depthCm: 90 }),
      ],
    });
    expect(r.conflicts).toEqual([]);
    expect(r.verifiedFit).toBe(true);
    // No confirmed needs -> never labelled verified-accessible.
    expect(r.verifiedAccessible).toBe(false);
  });

  it("flags items outside the room", () => {
    const r = validateLayout({
      room,
      features: [],
      needs: [],
      items: [item({ label: "Sofa", xCm: 300, yCm: 0, widthCm: 200 })],
    });
    expect(r.conflicts.map((c) => c.code)).toContain("outside_room");
    expect(r.verifiedFit).toBe(false);
  });

  it("flags overlapping items but lets rugs sit under furniture", () => {
    const r = validateLayout({
      room,
      features: [],
      needs: [],
      items: [
        item({ label: "Sofa", xCm: 100, yCm: 300 }),
        item({ label: "Chair", xCm: 150, yCm: 320 }),
        item({ label: "Rug", xCm: 50, yCm: 250, widthCm: 250, depthCm: 200 }),
      ],
    });
    const overlaps = r.conflicts.filter((c) => c.code === "item_overlap");
    expect(overlaps).toHaveLength(1);
  });

  it("flags furniture in a door swing", () => {
    const r = validateLayout({
      room,
      features: [door],
      needs: [],
      items: [item({ label: "Bookcase", xCm: 40, yCm: 10 })],
    });
    expect(r.conflicts.map((c) => c.code)).toContain("zone_overlap");
  });

  it("never verifies fit on estimated or unknown dimensions (AC-005)", () => {
    const est = validateLayout({
      room: { ...room, dimensionStatus: "estimated" },
      features: [],
      needs: [],
      items: [item({ label: "Sofa", xCm: 0, yCm: 0 })],
    });
    expect(est.conflicts).toEqual([]);
    expect(est.verifiedFit).toBe(false);
    expect(est.reasons.join(" ")).toMatch(/estimated/);

    const unknown = validateLayout({
      room: { widthCm: null, lengthCm: null, dimensionStatus: "unknown" },
      features: [],
      needs: [turning],
      items: [item({ label: "Sofa" })],
    });
    expect(unknown.verifiedFit).toBe(false);
    expect(unknown.needs[0]?.status).toBe("not_evaluable");
  });

  it("does not verify fit when an item uses typical (unknown) dims", () => {
    const r = validateLayout({
      room,
      features: [],
      needs: [],
      items: [item({ label: "Desk", dimsKnown: false })],
    });
    expect(r.verifiedFit).toBe(false);
  });

  it("keeps a confirmed turning space and verifies accessibility", () => {
    const r = validateLayout({
      room,
      features: [door],
      needs: [turning],
      items: [
        item({ label: "Sofa", xCm: 0, yCm: 410, widthCm: 200, depthCm: 90 }),
      ],
    });
    expect(r.zones.some((z) => z.kind === "turning_area")).toBe(true);
    expect(r.verifiedFit).toBe(true);
    expect(r.verifiedAccessible).toBe(true);
  });

  it("reports an impossible turning space as a hard error", () => {
    const r = validateLayout({
      room: { widthCm: 120, lengthCm: 300, dimensionStatus: "user_confirmed" },
      features: [],
      needs: [turning],
      items: [],
    });
    expect(r.conflicts.map((c) => c.code)).toContain(
      "turning_area_unavailable",
    );
    expect(r.verifiedAccessible).toBe(false);
  });

  it("flags storage above the confirmed reach range (AC-004)", () => {
    const reach: NeedInput = {
      needType: "reach_range",
      params: { reachMaxCm: 120 },
      confirmed: true,
    };
    const r = validateLayout({
      room,
      features: [],
      needs: [reach],
      items: [item({ label: "Wardrobe", category: "wardrobe", heightCm: 200 })],
    });
    expect(r.conflicts.map((c) => c.code)).toContain("reach_range");
  });

  it("ignores unconfirmed needs as hard constraints", () => {
    const r = validateLayout({
      room: { widthCm: 120, lengthCm: 300, dimensionStatus: "user_confirmed" },
      features: [],
      needs: [{ ...turning, confirmed: false }],
      items: [],
    });
    expect(r.conflicts).toEqual([]);
  });
});

describe("validateWithRepair", () => {
  it("moves furniture out of the turning space and door swing", () => {
    const { result, items } = validateWithRepair({
      room,
      features: [door],
      needs: [turning],
      items: [
        item({
          label: "Coffee table",
          xCm: 150,
          yCm: 220,
          widthCm: 100,
          depthCm: 60,
        }),
        item({ label: "Bookcase", xCm: 30, yCm: 10, widthCm: 80, depthCm: 35 }),
      ],
    });
    expect(result.conflicts).toEqual([]);
    expect(result.repairs.length).toBeGreaterThan(0);
    expect(items).toHaveLength(2);
  });
});

describe("postCheckBrief", () => {
  const ctx = {
    room: { ...room, heightCm: 240, name: "Living", reviewed: true },
    features: [door],
    possessions: [
      {
        id: "p1",
        name: "grey sofa",
        category: "sofa",
        widthCm: 210,
        depthCm: 90,
        heightCm: 80,
      },
    ],
    needs: [] as NeedInput[],
    roomBudgetPence: 100_000,
    allowUnreviewed: false,
  };

  it("clamps oversize bounds and adds retained possessions", () => {
    const out = postCheckBrief(
      {
        householdNeed: "Family",
        recommendedUse: "Living",
        roomConstraints: [],
        uncertainties: [],
        requirements: [
          {
            category: "media unit",
            description: "Low unit",
            quantity: 1,
            maxWidthCm: 900,
          },
        ],
      },
      ctx,
    );
    const media = out.requirements.find((r) => r.category === "media unit");
    expect(media?.maxWidthCm).toBe(500);
    const kept = out.requirements.find((r) => r.retainedPossessionId === "p1");
    expect(kept?.estimatedPricePence).toEqual({ low: 0, high: 0 });
    expect(kept?.maxWidthCm).toBe(210);
  });

  it("requests a measurement when dims are unknown, and flags unreviewed rooms", () => {
    const out = postCheckBrief(
      {
        householdNeed: "x",
        recommendedUse: "y",
        roomConstraints: [],
        uncertainties: [],
        requirements: [],
      },
      {
        ...ctx,
        room: {
          widthCm: null,
          lengthCm: null,
          dimensionStatus: "unknown",
          name: "R",
          reviewed: false,
        },
      },
    );
    expect(out.uncertainties.join(" ")).toMatch(/Measure the room/);
    expect(out.uncertainties.join(" ")).toMatch(/not been reviewed/);
  });

  it("caps storage height at the confirmed reach range", () => {
    const out = postCheckBrief(
      {
        householdNeed: "x",
        recommendedUse: "y",
        roomConstraints: [],
        uncertainties: [],
        requirements: [
          {
            category: "storage unit",
            description: "Toys",
            quantity: 1,
            maxHeightCm: 180,
          },
        ],
      },
      {
        ...ctx,
        possessions: [],
        needs: [
          {
            needType: "reach_range",
            params: { reachMaxCm: 120 },
            confirmed: true,
          },
        ],
      },
    );
    expect(out.requirements[0]?.maxHeightCm).toBe(120);
  });
});
