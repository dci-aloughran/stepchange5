import { describe, expect, it } from "vitest";
import {
  allocateBudget,
  budgetLine,
  compareToBudget,
  sumLines,
} from "./budget.js";
import { buildQuery } from "./intent.js";
import { type Rankable, rankCandidates, scoreCandidate } from "./ranking.js";

const base: Rankable = {
  sourceProductId: "p1",
  sourceVariantId: "v1",
  title: "Oak Coffee Table",
  description: "Solid oak, scandi style",
  colour: "Oak",
  material: null,
  widthCm: 100,
  depthCm: 50,
  heightCm: 45,
  dimensionStatus: "source_printed",
  pricePence: 20000,
  currency: "GBP",
  availability: "in_stock",
  deliversToUk: true,
};
const ctx = {
  bounds: { maxWidthCm: 110 },
  priceBand: { low: 15000, high: 25000 },
  requirementKeywords: ["coffee", "table"],
  tasteKeywords: ["oak", "scandi"],
};

describe("ranking", () => {
  it("is deterministic and ignores commission/sponsorship data (FR-39)", () => {
    const withCommission = {
      ...base,
      placement: { commission: { percentage: { value: 9 } } },
      sponsored: true,
    };
    expect(scoreCandidate(withCommission, ctx)).toEqual(
      scoreCandidate(base, ctx),
    );
  });

  it("excludes products exceeding bounds and never verifies unknown dims", () => {
    expect(scoreCandidate({ ...base, widthCm: 150 }, ctx).excluded).toBe(
      "exceeds_size_bounds",
    );
    const unknown = scoreCandidate({ ...base, widthCm: null }, ctx);
    expect(unknown.fit).toBe("unknown");
    expect(unknown.verifiedFit).toBe(false);
    expect(scoreCandidate(base, ctx).verifiedFit).toBe(true);
  });

  it("orders by score then price then id", () => {
    const a = { ...base, sourceProductId: "b", pricePence: 21000 };
    const b = { ...base, sourceProductId: "a", pricePence: 21000 };
    const c = {
      ...base,
      sourceProductId: "c",
      availability: "unknown" as const,
    };
    const ranked = rankCandidates([c, a, b], ctx).map(
      (r) => r.item.sourceProductId,
    );
    expect(ranked).toEqual(["a", "b", "c"]);
  });

  it("drops results that are not the requested item", () => {
    expect(scoreCandidate({ ...base, title: "Oak lamp" }, ctx).excluded).toBe(
      "not_matching_requirement",
    );
  });
});

describe("budget", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  it("uses product price, else estimate; excludes stale unless retained", () => {
    const req = {
      id: "r1",
      category: "sofa",
      description: "sofa",
      quantity: 1,
      estimatedPricePence: { low: 50000, high: 90000 },
    };
    const fresh = {
      recommendationId: "x",
      productTitle: "Sofa",
      retailer: "R",
      pricePence: 60000,
      currency: "GBP",
      availability: "in_stock",
      retrievedAt: now,
    };
    expect(budgetLine(req, fresh, now)).toMatchObject({
      source: "product",
      lowPence: 60000,
    });
    const stale = { ...fresh, retrievedAt: new Date(now.getTime() - 2e8) };
    expect(budgetLine(req, stale, now)).toMatchObject({
      source: "estimate",
      excludedReason: "stale",
      lowPence: 50000,
      highPence: 90000,
    });
    expect(
      budgetLine(req, { ...stale, userIncludeInBudget: true }, now).source,
    ).toBe("product");
    const totals = sumLines([budgetLine(req, undefined, now)]);
    expect(compareToBudget(totals, 70000)).toMatchObject({
      status: "at_risk",
      remainingLowPence: -20000,
      remainingHighPence: 20000,
      overByPence: 0,
    });
  });

  it("allocates household budget by estimate weight", () => {
    const a = allocateBudget(100000, [
      {
        id: "a",
        category: "",
        description: "",
        quantity: 1,
        estimatedPricePence: { low: 10000, high: 30000 },
      },
      {
        id: "b",
        category: "",
        description: "",
        quantity: 1,
        estimatedPricePence: { low: 50000, high: 70000 },
      },
    ]);
    expect(a.get("a")).toBe(25000);
    expect(a.get("b")).toBe(75000);
  });
});

describe("intent", () => {
  it("strips dimensions from the query and keeps the category", () => {
    expect(
      buildQuery({
        category: "coffee_table",
        description: "Approx. 100cm oval oak",
      }),
    ).toBe("oval oak coffee table");
    expect(
      buildQuery({
        category: "sofa",
        description: "220–240cm neutral fabric sofa",
      }),
    ).toBe("neutral fabric sofa");
  });
});
