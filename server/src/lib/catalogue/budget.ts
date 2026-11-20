// Pure budget helpers (FR-15, FR-22). Integer pence, GBP.

import type {
  BudgetLine,
  BudgetStatusSchema,
  BudgetTotals,
} from "@stepchange/shared";
import type { z } from "zod";

export const STALE_MS = 24 * 60 * 60 * 1000;
export const PRICE_CACHE_MS = 10 * 60 * 1000;

export type BudgetRequirement = {
  id: string;
  category: string;
  description: string;
  quantity: number;
  retainedPossessionId?: string;
  estimatedPricePence?: { low: number; high: number };
};

export type BudgetPrimary = {
  recommendationId: string;
  productTitle: string;
  retailer: string;
  pricePence: number | null;
  currency: string | null;
  availability: string;
  retrievedAt: Date;
  // Explicit user choice (PATCH); undefined = no choice made.
  userIncludeInBudget?: boolean;
};

export function productExclusion(
  p: BudgetPrimary,
  now: Date,
): BudgetLine["excludedReason"] {
  if (p.userIncludeInBudget === false) return "user_excluded";
  if (p.pricePence === null || p.currency !== "GBP") return "no_gbp_price";
  if (p.userIncludeInBudget === true) return null;
  if (p.availability === "out_of_stock") return "unavailable";
  if (now.getTime() - p.retrievedAt.getTime() > STALE_MS) return "stale";
  return null;
}

export function budgetLine(
  req: BudgetRequirement,
  primary: BudgetPrimary | undefined,
  now: Date,
): BudgetLine {
  const qty = Math.max(1, req.quantity || 1);
  const base = {
    requirementId: req.id,
    category: req.category,
    description: req.description,
    quantity: qty,
    recommendationId: primary?.recommendationId ?? null,
    productTitle: primary?.productTitle ?? null,
    retailer: primary?.retailer ?? null,
    unitPricePence: primary?.pricePence ?? null,
  };
  if (req.retainedPossessionId) {
    return {
      ...base,
      source: "retained",
      lowPence: 0,
      highPence: 0,
      excludedReason: null,
    };
  }
  const excludedReason = primary
    ? productExclusion(primary, now)
    : "no_recommendation";
  if (primary && excludedReason === null && primary.pricePence !== null) {
    const v = primary.pricePence * qty;
    return {
      ...base,
      source: "product",
      lowPence: v,
      highPence: v,
      excludedReason,
    };
  }
  if (req.estimatedPricePence) {
    return {
      ...base,
      source: "estimate",
      lowPence: req.estimatedPricePence.low * qty,
      highPence: req.estimatedPricePence.high * qty,
      excludedReason,
    };
  }
  return {
    ...base,
    source: "unpriced",
    lowPence: 0,
    highPence: 0,
    excludedReason,
  };
}

export function sumLines(lines: BudgetLine[]): BudgetTotals {
  const t: BudgetTotals = {
    productPence: 0,
    estimateLowPence: 0,
    estimateHighPence: 0,
    totalLowPence: 0,
    totalHighPence: 0,
    unpricedCount: 0,
  };
  for (const l of lines) {
    if (l.source === "product") t.productPence += l.lowPence;
    if (l.source === "estimate") {
      t.estimateLowPence += l.lowPence;
      t.estimateHighPence += l.highPence;
    }
    if (l.source === "unpriced") t.unpricedCount++;
  }
  t.totalLowPence = t.productPence + t.estimateLowPence;
  t.totalHighPence = t.productPence + t.estimateHighPence;
  return t;
}

export function addTotals(a: BudgetTotals, b: BudgetTotals): BudgetTotals {
  return {
    productPence: a.productPence + b.productPence,
    estimateLowPence: a.estimateLowPence + b.estimateLowPence,
    estimateHighPence: a.estimateHighPence + b.estimateHighPence,
    totalLowPence: a.totalLowPence + b.totalLowPence,
    totalHighPence: a.totalHighPence + b.totalHighPence,
    unpricedCount: a.unpricedCount + b.unpricedCount,
  };
}

export function compareToBudget(totals: BudgetTotals, budget: number | null) {
  type Status = z.infer<typeof BudgetStatusSchema>;
  if (budget === null) {
    return {
      status: "no_budget" as Status,
      remainingLowPence: null,
      remainingHighPence: null,
      overByPence: null,
    };
  }
  const status: Status =
    totals.totalLowPence > budget
      ? "over"
      : totals.totalHighPence > budget
        ? "at_risk"
        : "within";
  return {
    status,
    // Conservative remaining uses the high end of the range.
    remainingLowPence: budget - totals.totalHighPence,
    remainingHighPence: budget - totals.totalLowPence,
    overByPence: Math.max(0, totals.totalLowPence - budget),
  };
}

// Household budget split across open requirements, weighted by estimate
// midpoint x quantity (equal weights when estimates are missing).
export function allocateBudget(
  budgetPence: number | null,
  reqs: BudgetRequirement[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (!budgetPence || budgetPence <= 0) return out;
  const open = reqs.filter((r) => !r.retainedPossessionId);
  if (!open.length) return out;
  const mids = open.map((r) =>
    r.estimatedPricePence
      ? (r.estimatedPricePence.low + r.estimatedPricePence.high) / 2
      : null,
  );
  const known = mids.filter((m): m is number => m !== null);
  const fallback = known.length
    ? known.reduce((a, b) => a + b, 0) / known.length
    : 1;
  const weights = open.map(
    (r, i) => (mids[i] ?? fallback) * Math.max(1, r.quantity || 1),
  );
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  open.forEach((r, i) => {
    const qty = Math.max(1, r.quantity || 1);
    out.set(r.id, Math.floor((budgetPence * (weights[i] ?? 0)) / total / qty));
  });
  return out;
}
