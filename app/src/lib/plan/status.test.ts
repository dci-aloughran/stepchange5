import type { HomeBudgetResponse } from "@stepchange/shared";
import { describe, expect, it } from "vitest";
import {
  budgetShare,
  budgetStatus,
  buildShoppingList,
  deriveRoomStatus,
  firstOverBudgetIndex,
  isMeasurementRequest,
  pickHomeId,
  productCountForRoom,
} from "./status";

const known = { dimensionState: "known" as const, reviewed: true };
const verified = {
  validation: {
    verifiedFit: true,
    verifiedAccessible: true,
    conflicts: [],
    warnings: [],
    reasons: [],
    notes: [],
    needs: [],
    repairs: [],
  },
};

describe("deriveRoomStatus", () => {
  it("asks for measurement or review before a brief exists", () => {
    expect(
      deriveRoomStatus({
        room: { dimensionState: "unknown", reviewed: false },
        brief: null,
        layout: null,
        productCount: 0,
      }),
    ).toBe("needs_measurement");
    expect(
      deriveRoomStatus({
        room: { dimensionState: "known", reviewed: false },
        brief: null,
        layout: null,
        productCount: 0,
      }),
    ).toBe("needs_review");
    expect(
      deriveRoomStatus({
        room: known,
        brief: null,
        layout: null,
        productCount: 0,
      }),
    ).toBe("ready_for_brief");
  });

  it("tracks brief, layout and products", () => {
    expect(
      deriveRoomStatus({
        room: known,
        brief: { status: "draft" },
        layout: null,
        productCount: 0,
      }),
    ).toBe("brief_draft");
    expect(
      deriveRoomStatus({
        room: known,
        brief: { status: "accepted" },
        layout: null,
        productCount: 0,
      }),
    ).toBe("brief_ready");
    expect(
      deriveRoomStatus({
        room: known,
        brief: { status: "edited" },
        layout: verified,
        productCount: 0,
      }),
    ).toBe("layout_verified");
    expect(
      deriveRoomStatus({
        room: known,
        brief: { status: "accepted" },
        layout: verified,
        productCount: 2,
      }),
    ).toBe("products_chosen");
  });

  it("never reports a verified layout when fit or access is unverified", () => {
    expect(
      deriveRoomStatus({
        room: { dimensionState: "estimated", reviewed: true },
        brief: { status: "accepted" },
        layout: {
          validation: { ...verified.validation, verifiedAccessible: false },
        },
        productCount: 0,
      }),
    ).toBe("layout_needs_attention");
    expect(
      deriveRoomStatus({
        room: known,
        brief: { status: "accepted" },
        layout: { validation: null },
        productCount: 0,
      }),
    ).toBe("layout_needs_attention");
  });
});

describe("budget helpers", () => {
  it("classifies a range against the budget", () => {
    expect(budgetStatus(100, 200, null)).toBe("no_budget");
    expect(budgetStatus(100, 200, 300)).toBe("within");
    expect(budgetStatus(100, 200, 200)).toBe("within");
    expect(budgetStatus(100, 400, 300)).toBe("at_risk");
    expect(budgetStatus(400, 500, 300)).toBe("over");
  });
  it("computes budget share", () => {
    expect(budgetShare(150, 300)).toBe(0.5);
    expect(budgetShare(150, null)).toBeNull();
    expect(budgetShare(150, 0)).toBeNull();
  });
});

const line = (
  requirementId: string,
  source: "product" | "estimate" | "retained" | "unpriced",
  low: number,
  high = low,
) => ({
  requirementId,
  category: requirementId,
  description: `${requirementId} desc`,
  quantity: 1,
  source,
  recommendationId: source === "product" ? `rec-${requirementId}` : null,
  productTitle: source === "product" ? `${requirementId} product` : null,
  retailer: source === "product" ? "Shop" : null,
  unitPricePence: source === "product" ? low : null,
  lowPence: low,
  highPence: high,
  excludedReason: source === "product" ? null : ("no_recommendation" as const),
});

const totals = {
  productPence: 0,
  estimateLowPence: 0,
  estimateHighPence: 0,
  totalLowPence: 0,
  totalHighPence: 0,
  unpricedCount: 0,
};

const budget: HomeBudgetResponse = {
  homeId: "h",
  currency: "GBP",
  householdBudgetPence: 100000,
  rooms: [
    {
      roomId: "r1",
      name: "Living room",
      briefId: "b1",
      briefIsDraft: false,
      totals,
      lines: [
        line("rug", "estimate", 5000, 15000),
        line("sofa", "product", 60000),
        line("lamp", "retained", 0),
      ],
    },
    {
      roomId: "r2",
      name: "Bedroom",
      briefId: "b2",
      briefIsDraft: false,
      totals,
      lines: [
        line("bed", "estimate", 30000, 50000),
        line("art", "unpriced", 0),
      ],
    },
  ],
  totals,
  status: "at_risk",
  remainingLowPence: null,
  remainingHighPence: null,
  overByPence: null,
  notes: [],
  generatedAt: "",
};

describe("buildShoppingList", () => {
  it("orders by priority, then live prices first, and drops retained items", () => {
    const priorities = new Map([
      ["r1:rug", "could" as const],
      ["r1:sofa", "must" as const],
      ["r2:bed", "must" as const],
      ["r2:art", "could" as const],
    ]);
    const list = buildShoppingList(budget, priorities);
    expect(list.map((i) => i.requirementId)).toEqual([
      "sofa",
      "bed",
      "rug",
      "art",
    ]);
    expect(list[0]?.roomName).toBe("Living room");
  });
  it("defaults missing priorities to should", () => {
    const list = buildShoppingList(budget, new Map());
    expect(list.every((i) => i.priority === "should")).toBe(true);
    expect(list[0]?.source).toBe("product");
  });
  it("finds where a running total passes the budget", () => {
    const list = buildShoppingList(
      budget,
      new Map([
        ["r1:sofa", "must" as const],
        ["r2:bed", "must" as const],
      ]),
    );
    // sofa 600 + bed 500 (high) = 1100 > 1000
    expect(firstOverBudgetIndex(list, 100000)).toBe(1);
    expect(firstOverBudgetIndex(list, null)).toBeNull();
    expect(firstOverBudgetIndex(list, 10_000_000)).toBeNull();
  });
  it("counts products chosen per room", () => {
    expect(productCountForRoom(budget, "r1")).toBe(1);
    expect(productCountForRoom(budget, "r2")).toBe(0);
    expect(productCountForRoom(null, "r1")).toBe(0);
  });
});

describe("misc", () => {
  it("flags measurement requests", () => {
    expect(
      isMeasurementRequest(
        "Room width and length are unknown. Measure the room wall to wall.",
      ),
    ).toBe(true);
    expect(isMeasurementRequest("Would you like a reading lamp?")).toBe(false);
  });
  it("picks the profile home, else the most recent", () => {
    const homes = [{ id: "a" }, { id: "b" }];
    expect(pickHomeId("b", homes)).toBe("b");
    expect(pickHomeId("zzz", homes)).toBe("a");
    expect(pickHomeId(undefined, homes)).toBe("a");
    expect(pickHomeId("a", [])).toBeNull();
  });
});
