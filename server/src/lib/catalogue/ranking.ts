// Deterministic recommendation ranking (FR-13, FR-39, D-004).
// Inputs are ONLY: dimensional fit, relevance/taste keyword match, price vs
// band, availability and UK delivery. Commission, affiliate or sponsorship
// data is never an input — the Rankable type does not even carry it.

export const RANK_VERSION = "rank-v1";

export type Rankable = {
  sourceProductId: string;
  sourceVariantId: string;
  title: string;
  description: string | null;
  colour: string | null;
  material: string | null;
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
  dimensionStatus: string;
  pricePence: number | null;
  currency: string | null;
  availability: "in_stock" | "out_of_stock" | "unknown";
  deliversToUk: boolean | null;
};

export type Bounds = {
  minWidthCm?: number;
  maxWidthCm?: number;
  maxDepthCm?: number;
  maxHeightCm?: number;
};

export type RankContext = {
  bounds: Bounds;
  priceBand: { low: number; high: number } | null;
  requirementKeywords: string[];
  tasteKeywords: string[];
};

export type DimensionFit = "fits" | "unbounded" | "unknown" | "exceeds";

export function dimensionFit(
  p: Pick<Rankable, "widthCm" | "depthCm" | "heightCm">,
  b: Bounds,
): DimensionFit {
  const checks: Array<[number | null, (v: number) => boolean]> = [];
  if (b.minWidthCm !== undefined)
    checks.push([p.widthCm, (v) => v >= (b.minWidthCm as number)]);
  if (b.maxWidthCm !== undefined)
    checks.push([p.widthCm, (v) => v <= (b.maxWidthCm as number)]);
  if (b.maxDepthCm !== undefined)
    checks.push([p.depthCm, (v) => v <= (b.maxDepthCm as number)]);
  if (b.maxHeightCm !== undefined)
    checks.push([p.heightCm, (v) => v <= (b.maxHeightCm as number)]);
  if (checks.length === 0) return "unbounded";
  let unknown = false;
  for (const [value, ok] of checks) {
    if (value === null) unknown = true;
    else if (!ok(value)) return "exceeds";
  }
  return unknown ? "unknown" : "fits";
}

const STOP = new Set([
  "and",
  "the",
  "with",
  "for",
  "approx",
  "max",
  "min",
  "wide",
  "low",
  "plus",
  "seat",
  "seater",
]);

export function keywords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[_-]/g, " ")
        .replace(/\d+(\.\d+)?\s*(cm|mm|m)?/g, " ")
        .split(/[^a-z]+/)
        .filter((w) => w.length >= 3 && !STOP.has(w)),
    ),
  ];
}

export type ScoreBreakdown = {
  score: number;
  components: {
    fit: number;
    relevance: number;
    taste: number;
    price: number;
    availability: number;
    delivery: number;
  };
  fit: DimensionFit;
  verifiedFit: boolean;
  matchedRequirementKeywords: string[];
  matchedTasteKeywords: string[];
  pricePosition: "below_band" | "in_band" | "above_band" | "unknown";
  excluded: string | null;
};

export function scoreCandidate(p: Rankable, ctx: RankContext): ScoreBreakdown {
  const fit = dimensionFit(p, ctx.bounds);
  const haystack =
    ` ${[p.title, p.description, p.colour, p.material].filter(Boolean).join(" ")} `.toLowerCase();
  const titleLc = p.title.toLowerCase();
  const matchedReq = ctx.requirementKeywords.filter((k) => titleLc.includes(k));
  const matchedTaste = ctx.tasteKeywords.filter((k) => haystack.includes(k));

  const fitScore = { fits: 35, unbounded: 20, unknown: 12, exceeds: 0 }[fit];
  const relevance = ctx.requirementKeywords.length
    ? Math.round((15 * matchedReq.length) / ctx.requirementKeywords.length)
    : 8;
  const taste = ctx.tasteKeywords.length
    ? Math.round(
        (25 * matchedTaste.length) / Math.min(ctx.tasteKeywords.length, 5),
      )
    : 12;

  let price = 0;
  let pricePosition: ScoreBreakdown["pricePosition"] = "unknown";
  if (p.pricePence !== null && p.currency === "GBP") {
    if (!ctx.priceBand) {
      price = 8;
      pricePosition = "in_band";
    } else if (p.pricePence < ctx.priceBand.low) {
      price = 12;
      pricePosition = "below_band";
    } else if (p.pricePence <= ctx.priceBand.high) {
      price = 15;
      pricePosition = "in_band";
    } else {
      pricePosition = "above_band";
      const over = (p.pricePence - ctx.priceBand.high) / ctx.priceBand.high;
      price = Math.max(0, Math.round(15 * (1 - over * 2)));
    }
  }
  const availability = { in_stock: 7, unknown: 3, out_of_stock: 0 }[
    p.availability
  ];
  const delivery =
    p.deliversToUk === true ? 3 : p.deliversToUk === null ? 1 : 0;

  let excluded: string | null = null;
  if (fit === "exceeds") excluded = "exceeds_size_bounds";
  else if (p.deliversToUk === false) excluded = "no_uk_delivery";
  else if (p.currency !== null && p.currency !== "GBP")
    excluded = "non_gbp_price";
  else if (ctx.requirementKeywords.length && matchedReq.length === 0)
    excluded = "not_matching_requirement";

  const components = {
    fit: fitScore,
    relevance: Math.min(15, relevance),
    taste: Math.min(25, taste),
    price,
    availability,
    delivery,
  };
  return {
    score: Object.values(components).reduce((a, b) => a + b, 0),
    components,
    fit,
    verifiedFit: fit === "fits" && p.dimensionStatus === "source_printed",
    matchedRequirementKeywords: matchedReq,
    matchedTasteKeywords: matchedTaste,
    pricePosition,
    excluded,
  };
}

// Sort: score desc, then price asc, then ids — fully deterministic.
export function rankCandidates<T extends Rankable>(
  candidates: T[],
  ctx: RankContext,
): Array<{ item: T; breakdown: ScoreBreakdown }> {
  return candidates
    .map((item) => ({ item, breakdown: scoreCandidate(item, ctx) }))
    .filter((c) => c.breakdown.excluded === null)
    .sort(
      (a, b) =>
        b.breakdown.score - a.breakdown.score ||
        (a.item.pricePence ?? Number.MAX_SAFE_INTEGER) -
          (b.item.pricePence ?? Number.MAX_SAFE_INTEGER) ||
        a.item.sourceProductId.localeCompare(b.item.sourceProductId) ||
        a.item.sourceVariantId.localeCompare(b.item.sourceVariantId),
    );
}
