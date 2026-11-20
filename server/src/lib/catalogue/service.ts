// Recommendation / budget orchestration (DB + connector).

import type {
  CatalogueConnectorReport,
  HomeBudgetResponse,
  ProductDto,
  RecommendationDto,
  RefreshRecommendationResponse,
  RequirementRecommendations,
  RoomRecommendationsResponse,
  SwapIntent,
  SwapRecommendationResponse,
} from "@stepchange/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  type ConnectorResult,
  refreshVariant,
  searchCatalog,
} from "../../connectors/shopify.js";
import type { NormalisedProduct } from "../../connectors/shopify-normalise.js";
import { getDb, schema } from "../../db/client.js";
import type { FurnitureRequirement } from "../../db/schema.js";
import { track } from "../audit.js";
import { getOwnedHome, getOwnedRoom } from "../ownership.js";
import {
  addTotals,
  allocateBudget,
  type BudgetPrimary,
  budgetLine,
  compareToBudget,
  PRICE_CACHE_MS,
  productExclusion,
  STALE_MS,
  sumLines,
} from "./budget.js";
import {
  buildQuery,
  priceBand,
  requirementKeywords,
  swapFilter,
  swapPriceFilter,
  tasteKeywords,
} from "./intent.js";
import {
  dimensionFit,
  RANK_VERSION,
  type RankContext,
  rankCandidates,
  type ScoreBreakdown,
} from "./ranking.js";

type ProductRow = typeof schema.products.$inferSelect;
type RecRow = typeof schema.recommendations.$inferSelect;
type BriefRow = typeof schema.functionalBriefs.$inferSelect;

const DISCLOSURES = [
  "Products are matched to your room requirements first. Retailer commission never affects ranking.",
  "Prices and availability come from participating Shopify retailers and can change; we re-check before you buy.",
  "Product images are shown with retailer attribution and are not placed into generated room concepts.",
];

function report(
  status: CatalogueConnectorReport["status"],
  reason: string | null,
): CatalogueConnectorReport {
  return {
    connector: "shopify_ucp",
    status,
    reason,
    checkedAt: new Date().toISOString(),
  };
}

function reportFrom<T>(r: ConnectorResult<T>): CatalogueConnectorReport {
  return r.status === "ok" ? report("ok", null) : report(r.status, r.reason);
}

export async function currentBrief(roomId: string): Promise<BriefRow | null> {
  const briefs = await getDb()
    .select()
    .from(schema.functionalBriefs)
    .where(eq(schema.functionalBriefs.roomId, roomId))
    .orderBy(
      desc(schema.functionalBriefs.version),
      desc(schema.functionalBriefs.createdAt),
    );
  return (
    briefs.find((b) => b.status === "accepted" || b.status === "edited") ??
    briefs.find((b) => b.status === "draft") ??
    null
  );
}

export function toProductDto(p: ProductRow): ProductDto {
  return {
    id: p.id,
    retailer: p.retailer,
    connector: p.connector,
    sourceProductId: p.sourceProductId,
    sourceVariantId: p.sourceVariantId,
    title: p.title,
    description: p.description,
    category: p.category,
    widthCm: p.widthCm,
    depthCm: p.depthCm,
    heightCm: p.heightCm,
    dimensionStatus: p.dimensionStatus,
    colour: p.colour,
    material: p.material,
    pricePence: p.pricePence,
    currency: p.currency,
    availability: p.availability,
    imageUrls: p.imageUrls,
    deliversToUk: p.deliversToUk,
    canonicalUrl: p.canonicalUrl,
    checkoutUrl: p.checkoutUrl,
    licenceStatus: p.licenceStatus,
    attribution: `Image and product details: ${p.retailer} via Shopify Catalog`,
    imagesUsableInConcepts: false,
    sponsored: p.sponsored,
    retrievedAt: p.retrievedAt.toISOString(),
  };
}

function userChoice(rec: RecRow): boolean | undefined {
  const c = (rec.rankInputs as { userBudgetChoice?: { include?: boolean } })
    .userBudgetChoice;
  return typeof c?.include === "boolean" ? c.include : undefined;
}

function toPrimary(rec: RecRow, p: ProductRow): BudgetPrimary {
  return {
    recommendationId: rec.id,
    productTitle: p.title,
    retailer: p.retailer,
    pricePence: p.pricePence,
    currency: p.currency,
    availability: p.availability,
    retrievedAt: p.retrievedAt,
    userIncludeInBudget: userChoice(rec),
  };
}

export function toRecDto(
  rec: RecRow,
  p: ProductRow,
  req: FurnitureRequirement | undefined,
  currentBriefId: string | null,
  now = new Date(),
): RecommendationDto {
  const ri = rec.rankInputs as {
    score?: number;
    reasons?: string[];
  };
  const age = now.getTime() - p.retrievedAt.getTime();
  const fit = req ? dimensionFit(p, req) : "unbounded";
  const choice = userChoice(rec);
  return {
    id: rec.id,
    roomId: rec.roomId,
    briefId: rec.briefId,
    requirementId: rec.requirementId,
    rank: rec.rank,
    status: rec.status,
    includeInBudget: productExclusion(toPrimary(rec, p), now) === null,
    includeInBudgetSetByUser: choice !== undefined,
    score: typeof ri.score === "number" ? ri.score : 0,
    reasons: Array.isArray(ri.reasons) ? ri.reasons : [],
    labels: {
      stale: age > STALE_MS,
      unavailable: p.availability === "out_of_stock",
      priceNeedsRefresh: age > PRICE_CACHE_MS,
      sponsored: p.sponsored,
      verifiedFit: fit === "fits" && p.dimensionStatus === "source_printed",
      dimensionFit: fit,
      fromPreviousBrief:
        currentBriefId !== null && rec.briefId !== currentBriefId,
    },
    product: toProductDto(p),
    createdAt: rec.createdAt.toISOString(),
  };
}

async function upsertProduct(n: NormalisedProduct): Promise<ProductRow> {
  const { upid: _upid, ...values } = n;
  const [row] = await getDb()
    .insert(schema.products)
    .values(values)
    .onConflictDoUpdate({
      target: [
        schema.products.connector,
        schema.products.sourceProductId,
        schema.products.sourceVariantId,
      ],
      set: {
        retailer: values.retailer,
        title: values.title,
        description: values.description,
        category: values.category,
        widthCm: values.widthCm,
        depthCm: values.depthCm,
        heightCm: values.heightCm,
        dimensionStatus: values.dimensionStatus,
        colour: values.colour,
        material: values.material,
        pricePence: values.pricePence,
        currency: values.currency,
        availability: values.availability,
        imageUrls: values.imageUrls,
        deliversToUk: values.deliversToUk,
        canonicalUrl: values.canonicalUrl,
        checkoutUrl: values.checkoutUrl,
        licenceStatus: values.licenceStatus,
        sponsored: values.sponsored,
        retrievedAt: values.retrievedAt,
      },
    })
    .returning();
  if (!row) throw new Error("product upsert failed");
  return row;
}

function reasonsFor(b: ScoreBreakdown): string[] {
  const r: string[] = [];
  if (b.fit === "fits")
    r.push(
      b.verifiedFit
        ? "Retailer dimensions fit the space"
        : "Dimensions appear to fit (not retailer-verified)",
    );
  if (b.fit === "unknown")
    r.push("Dimensions not published — check size before buying");
  if (b.matchedTasteKeywords.length)
    r.push(`Matches your style: ${b.matchedTasteKeywords.join(", ")}`);
  if (b.pricePosition === "in_band") r.push("Within the budget for this item");
  if (b.pricePosition === "below_band")
    r.push("Below the budget for this item");
  if (b.pricePosition === "above_band")
    r.push("Above the budget for this item");
  return r;
}

function rankInputsFor(
  n: NormalisedProduct,
  b: ScoreBreakdown,
  ctx: RankContext,
  req: FurnitureRequirement,
  query: string,
  extra: Record<string, unknown> = {},
) {
  return {
    version: RANK_VERSION,
    score: b.score,
    components: b.components,
    reasons: reasonsFor(b),
    fit: {
      status: b.fit,
      verifiedFit: b.verifiedFit,
      dimensionStatus: n.dimensionStatus,
      productDims: { w: n.widthCm, d: n.depthCm, h: n.heightCm },
      bounds: ctx.bounds,
    },
    price: {
      pricePence: n.pricePence,
      currency: n.currency,
      band: ctx.priceBand,
      position: b.pricePosition,
    },
    taste: { keywords: ctx.tasteKeywords, matched: b.matchedTasteKeywords },
    relevance: {
      keywords: ctx.requirementKeywords,
      matched: b.matchedRequirementKeywords,
    },
    availability: n.availability,
    deliversToUk: n.deliversToUk,
    requirement: { id: req.id, category: req.category },
    query,
    upid: n.upid,
    sponsored: n.sponsored,
    // FR-39: never inputs to ranking.
    excludedFromRanking: ["commission", "affiliate", "sponsorship"],
    retrievedAt: n.retrievedAt.toISOString(),
    ...extra,
  };
}

async function loadContext(userId: string, homeId: string, roomId: string) {
  const db = getDb();
  const [household] = await db
    .select()
    .from(schema.households)
    .where(eq(schema.households.userId, userId));
  const [taste] = await db
    .select()
    .from(schema.tasteProfiles)
    .where(eq(schema.tasteProfiles.userId, userId));
  // Budget allocation across all selected rooms of the home.
  const rooms = await db
    .select()
    .from(schema.rooms)
    .where(
      and(eq(schema.rooms.homeId, homeId), eq(schema.rooms.selected, true)),
    );
  const all: Array<FurnitureRequirement & { key: string }> = [];
  for (const r of rooms.some((x) => x.id === roomId)
    ? rooms
    : [...rooms, { id: roomId }]) {
    const b = await currentBrief(r.id);
    for (const q of b?.requirements ?? [])
      all.push({ ...q, id: `${r.id}:${q.id}`, key: q.id });
  }
  const alloc = allocateBudget(household?.budgetTotalPence ?? null, all);
  return {
    tasteKw: tasteKeywords(taste?.attributes ?? []),
    tasteSummary: taste?.summary ?? "",
    alloc: (reqId: string) => alloc.get(`${roomId}:${reqId}`),
  };
}

function rankContextFor(
  req: FurnitureRequirement,
  tasteKw: string[],
  allocation: number | undefined,
): RankContext {
  return {
    bounds: {
      minWidthCm: req.minWidthCm,
      maxWidthCm: req.maxWidthCm,
      maxDepthCm: req.maxDepthCm,
      maxHeightCm: req.maxHeightCm,
    },
    priceBand: priceBand(req.estimatedPricePence, allocation),
    requirementKeywords: requirementKeywords(req),
    tasteKeywords: tasteKw,
  };
}

function intentText(req: FurnitureRequirement, tasteSummary: string) {
  return `Furnishing a UK home: ${req.description}${tasteSummary ? `. Style: ${tasteSummary.slice(0, 200)}` : ""}`;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx] as T);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------

export async function roomRecommendations(
  userId: string,
  roomId: string,
  connector: CatalogueConnectorReport | null = null,
  stateOverrides: Map<
    string,
    { state: string; message: string | null }
  > = new Map(),
): Promise<RoomRecommendationsResponse> {
  await getOwnedRoom(userId, roomId);
  const brief = await currentBrief(roomId);
  const rows = await getDb()
    .select({ rec: schema.recommendations, product: schema.products })
    .from(schema.recommendations)
    .innerJoin(
      schema.products,
      eq(schema.recommendations.productId, schema.products.id),
    )
    .where(
      and(
        eq(schema.recommendations.roomId, roomId),
        eq(schema.recommendations.status, "active"),
      ),
    )
    .orderBy(schema.recommendations.rank);
  const now = new Date();
  const requirements: RequirementRecommendations[] = (
    brief?.requirements ?? []
  ).map((req) => {
    const recs = rows
      .filter((r) => r.rec.requirementId === req.id)
      .map((r) => toRecDto(r.rec, r.product, req, brief?.id ?? null, now));
    const override = stateOverrides.get(req.id);
    const state = req.retainedPossessionId
      ? "retained"
      : recs.length
        ? "recommended"
        : ((override?.state as RequirementRecommendations["state"]) ??
          "not_requested");
    const ri = recs[0]
      ? (rows.find((r) => r.rec.id === recs[0]?.id)?.rec.rankInputs as {
          price?: { band?: { low: number; high: number } | null };
        })
      : undefined;
    return {
      requirement: req,
      state,
      priceBandPence: ri?.price?.band ?? req.estimatedPricePence ?? null,
      estimate: req.estimatedPricePence
        ? {
            lowPence: req.estimatedPricePence.low,
            highPence: req.estimatedPricePence.high,
            label: "estimate" as const,
          }
        : null,
      message: override?.message ?? null,
      recommendations: recs,
    };
  });
  return {
    roomId,
    briefId: brief?.id ?? null,
    briefStatus: brief?.status ?? null,
    briefIsDraft: brief?.status === "draft",
    connector,
    requirements,
    disclosures: DISCLOSURES,
    generatedAt: now.toISOString(),
  };
}

export async function recommendRoom(
  userId: string,
  roomId: string,
  opts: { perRequirement: number; requirementIds?: string[] },
): Promise<RoomRecommendationsResponse> {
  const { room } = await getOwnedRoom(userId, roomId);
  const brief = await currentBrief(roomId);
  if (!brief) {
    throw new HTTPException(409, {
      message: "Create the room's functional brief before asking for products.",
    });
  }
  const ctx = await loadContext(userId, room.homeId, roomId);
  const open = brief.requirements.filter(
    (r) =>
      !r.retainedPossessionId &&
      (!opts.requirementIds || opts.requirementIds.includes(r.id)),
  );
  const overrides = new Map<
    string,
    { state: string; message: string | null }
  >();
  const statuses: CatalogueConnectorReport[] = [];
  let shown = 0;

  await mapLimit(open, 3, async (req) => {
    const rctx = rankContextFor(req, ctx.tasteKw, ctx.alloc(req.id));
    const query = buildQuery(req);
    const res = await searchCatalog({
      query,
      intent: intentText(req, ctx.tasteSummary),
      maxPricePence: rctx.priceBand
        ? Math.round(rctx.priceBand.high * 1.5)
        : undefined,
      limit: 12,
    });
    statuses.push(reportFrom(res));
    if (res.status !== "ok") {
      // Keep any existing recommendations; output is requirement-only.
      overrides.set(req.id, {
        state: "catalogue_unavailable",
        message:
          "Live retailer catalogue is unavailable right now. Showing the requirement and its estimated price range only.",
      });
      return;
    }
    // At most one offer per universal product in the top N.
    const seenUpid = new Set<string>();
    const ranked = rankCandidates(res.data, rctx).filter(({ item }) => {
      const k = item.upid ?? item.sourceProductId;
      if (seenUpid.has(k)) return false;
      seenUpid.add(k);
      return true;
    });
    const top = ranked.slice(0, opts.perRequirement);
    const db = getDb();
    await db
      .update(schema.recommendations)
      .set({ status: "replaced" })
      .where(
        and(
          eq(schema.recommendations.roomId, roomId),
          eq(schema.recommendations.requirementId, req.id),
          eq(schema.recommendations.status, "active"),
        ),
      );
    if (!top.length) {
      overrides.set(req.id, {
        state: "no_match",
        message:
          "No participating retailer product matched this requirement. The estimate is shown instead.",
      });
      return;
    }
    let rank = 1;
    for (const { item, breakdown } of top) {
      const product = await upsertProduct(item);
      await db.insert(schema.recommendations).values({
        roomId,
        briefId: brief.id,
        requirementId: req.id,
        productId: product.id,
        rank: rank++,
        rankInputs: rankInputsFor(item, breakdown, rctx, req, query),
        status: "active",
        includeInBudget: true,
      });
      shown++;
    }
  });

  const failed = statuses.filter((s) => s.status !== "ok");
  const connector =
    statuses.length === 0
      ? report("ok", null)
      : failed.length === 0
        ? report("ok", null)
        : failed.length === statuses.length
          ? (failed[0] as CatalogueConnectorReport)
          : report("partial", failed[0]?.reason ?? null);
  await track("product.recommendations_shown", {
    userId,
    props: { roomId, count: shown, connector: connector.status },
  }).catch(() => {});
  const out = await roomRecommendations(userId, roomId, connector, overrides);
  return { ...out, briefIsDraft: brief.status === "draft" };
}

async function loadOwnedRec(userId: string, id: string) {
  const [row] = await getDb()
    .select({ rec: schema.recommendations, product: schema.products })
    .from(schema.recommendations)
    .innerJoin(
      schema.products,
      eq(schema.recommendations.productId, schema.products.id),
    )
    .where(eq(schema.recommendations.id, id));
  if (!row) throw new HTTPException(404, { message: "Not found" });
  const owned = await getOwnedRoom(userId, row.rec.roomId);
  return { ...row, ...owned };
}

async function requirementFor(rec: RecRow) {
  let brief: BriefRow | null = null;
  if (rec.briefId) {
    const [b] = await getDb()
      .select()
      .from(schema.functionalBriefs)
      .where(eq(schema.functionalBriefs.id, rec.briefId));
    brief = b ?? null;
  }
  brief ??= await currentBrief(rec.roomId);
  return {
    brief,
    req: brief?.requirements.find((r) => r.id === rec.requirementId),
  };
}

export async function swapRecommendation(
  userId: string,
  id: string,
  intent: SwapIntent,
): Promise<SwapRecommendationResponse> {
  const { rec, product: current, room } = await loadOwnedRec(userId, id);
  if (rec.status !== "active") {
    throw new HTTPException(409, { message: "Recommendation is not active" });
  }
  const { brief, req } = await requirementFor(rec);
  if (!req) {
    throw new HTTPException(409, {
      message: "The requirement for this recommendation no longer exists.",
    });
  }
  const ctx = await loadContext(userId, room.homeId, rec.roomId);
  const rctx = rankContextFor(req, ctx.tasteKw, ctx.alloc(req.id));
  const query = buildQuery(req, intent);
  const res = await searchCatalog({
    query,
    intent: intentText(req, ctx.tasteSummary),
    ...swapPriceFilter(intent, current.pricePence),
    limit: 20,
  });
  const now = new Date();
  const keep = (
    outcome: SwapRecommendationResponse["outcome"],
    message: string,
  ) => ({
    outcome,
    previousRecommendationId: rec.id,
    recommendation: toRecDto(rec, current, req, brief?.id ?? null, now),
    connector: reportFrom(res),
    message,
  });
  if (res.status !== "ok") {
    return keep(
      "catalogue_unavailable",
      "Live retailer catalogue is unavailable; your current choice is unchanged.",
    );
  }
  const active = await getDb()
    .select({ product: schema.products })
    .from(schema.recommendations)
    .innerJoin(
      schema.products,
      eq(schema.recommendations.productId, schema.products.id),
    )
    .where(
      and(
        eq(schema.recommendations.roomId, rec.roomId),
        eq(schema.recommendations.requirementId, rec.requirementId),
        eq(schema.recommendations.status, "active"),
      ),
    );
  const taken = new Set(
    active.map(
      (a) => `${a.product.sourceProductId}|${a.product.sourceVariantId}`,
    ),
  );
  const candidates = res.data.filter(
    (c) =>
      !taken.has(`${c.sourceProductId}|${c.sourceVariantId}`) &&
      swapFilter(intent, current, c),
  );
  const best = rankCandidates(candidates, rctx)[0];
  if (!best) {
    return keep(
      "no_alternative",
      "No suitable alternative found for that request; your current choice is unchanged.",
    );
  }
  const product = await upsertProduct(best.item);
  const db = getDb();
  await db
    .update(schema.recommendations)
    .set({ status: "replaced" })
    .where(eq(schema.recommendations.id, rec.id));
  const [created] = await db
    .insert(schema.recommendations)
    .values({
      roomId: rec.roomId,
      briefId: rec.briefId,
      requirementId: rec.requirementId,
      productId: product.id,
      rank: rec.rank,
      rankInputs: rankInputsFor(best.item, best.breakdown, rctx, req, query, {
        swap: { intent, replacedRecommendationId: rec.id },
      }),
      status: "active",
      includeInBudget: true,
    })
    .returning();
  if (!created) throw new Error("insert failed");
  await track("product.swap", {
    userId,
    props: { intent, requirementId: rec.requirementId },
  }).catch(() => {});
  return {
    outcome: "swapped",
    previousRecommendationId: rec.id,
    recommendation: toRecDto(created, product, req, brief?.id ?? null, now),
    connector: report("ok", null),
    message: null,
  };
}

export async function refreshRecommendation(
  userId: string,
  id: string,
  handoff: boolean,
): Promise<RefreshRecommendationResponse> {
  const { rec, product: before } = await loadOwnedRec(userId, id);
  const { brief, req } = await requirementFor(rec);
  const res = before.sourceVariantId
    ? await refreshVariant(before.sourceVariantId)
    : ({ status: "unavailable", reason: "No variant id" } as const);
  let after = before;
  let delisted = false;
  let verified = false;
  let message: string | null = null;
  if (res.status === "ok") {
    verified = true;
    if (res.data.found) {
      after = await upsertProduct({
        ...res.data.product,
        // Keep the original UK-delivery basis when refresh can't tell.
        deliversToUk: res.data.product.deliversToUk ?? before.deliversToUk,
      });
    } else {
      delisted = true;
      const [row] = await getDb()
        .update(schema.products)
        .set({
          availability: "out_of_stock",
          checkoutUrl: null,
          retrievedAt: new Date(),
        })
        .where(eq(schema.products.id, before.id))
        .returning();
      after = row ?? before;
      message = "This product is no longer listed by the retailer.";
    }
  } else {
    message =
      "Couldn't confirm the latest price and availability. Check on the retailer's site before buying.";
  }
  if (handoff) {
    await track("product.outbound_click", {
      userId,
      props: {
        recommendationId: rec.id,
        productId: after.id,
        connector: after.connector,
        retailer: after.retailer,
        sponsored: after.sponsored,
        verified,
      },
    }).catch(() => {});
  }
  return {
    recommendation: toRecDto(rec, after, req, brief?.id ?? null),
    verified,
    changes: {
      priceChanged: before.pricePence !== after.pricePence,
      previousPricePence: before.pricePence,
      currentPricePence: after.pricePence,
      availabilityChanged: before.availability !== after.availability,
      previousAvailability: before.availability,
      currentAvailability: after.availability,
      variantChanged: before.sourceVariantId !== after.sourceVariantId,
      delisted,
    },
    checkoutUrl: after.checkoutUrl,
    canonicalUrl: after.canonicalUrl,
    connector: reportFrom(res),
    message,
  };
}

export async function updateRecommendation(
  userId: string,
  id: string,
  includeInBudget: boolean,
): Promise<RecommendationDto> {
  const { rec } = await loadOwnedRec(userId, id);
  const [updated] = await getDb()
    .update(schema.recommendations)
    .set({
      includeInBudget,
      // Explicit user choice (FR-22 retain), distinguishable from default.
      rankInputs: {
        ...rec.rankInputs,
        userBudgetChoice: {
          include: includeInBudget,
          at: new Date().toISOString(),
        },
      },
    })
    .where(eq(schema.recommendations.id, id))
    .returning();
  if (!updated) throw new HTTPException(404, { message: "Not found" });
  const [product] = await getDb()
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, updated.productId));
  if (!product) throw new HTTPException(404, { message: "Not found" });
  const { brief, req } = await requirementFor(updated);
  return toRecDto(updated, product, req, brief?.id ?? null);
}

export async function homeBudget(
  userId: string,
  homeId: string,
): Promise<HomeBudgetResponse> {
  await getOwnedHome(userId, homeId);
  const db = getDb();
  const [household] = await db
    .select()
    .from(schema.households)
    .where(eq(schema.households.userId, userId));
  const rooms = await db
    .select()
    .from(schema.rooms)
    .where(
      and(eq(schema.rooms.homeId, homeId), eq(schema.rooms.selected, true)),
    );
  const roomIds = rooms.map((r) => r.id);
  const primaries = roomIds.length
    ? await db
        .select({ rec: schema.recommendations, product: schema.products })
        .from(schema.recommendations)
        .innerJoin(
          schema.products,
          eq(schema.recommendations.productId, schema.products.id),
        )
        .where(
          and(
            inArray(schema.recommendations.roomId, roomIds),
            eq(schema.recommendations.status, "active"),
            eq(schema.recommendations.rank, 1),
          ),
        )
    : [];
  const now = new Date();
  let totals = sumLines([]);
  const out: HomeBudgetResponse["rooms"] = [];
  for (const room of rooms) {
    const brief = await currentBrief(room.id);
    const lines = (brief?.requirements ?? []).map((req) => {
      const p = primaries.find(
        (x) => x.rec.roomId === room.id && x.rec.requirementId === req.id,
      );
      return budgetLine(req, p ? toPrimary(p.rec, p.product) : undefined, now);
    });
    const roomTotals = sumLines(lines);
    totals = addTotals(totals, roomTotals);
    out.push({
      roomId: room.id,
      name: room.name,
      briefId: brief?.id ?? null,
      briefIsDraft: brief?.status === "draft",
      totals: roomTotals,
      lines,
    });
  }
  const budget = household?.budgetTotalPence ?? null;
  const notes: string[] = [
    "Totals use current prices of your chosen products plus estimate ranges for items without one.",
    "Stale (over 24 hours) or unavailable products are excluded unless you choose to keep them.",
  ];
  if (totals.unpricedCount)
    notes.push(
      `${totals.unpricedCount} item(s) have no price or estimate yet and are not included.`,
    );
  return {
    homeId,
    currency: "GBP",
    householdBudgetPence: budget,
    rooms: out,
    totals,
    ...compareToBudget(totals, budget),
    notes,
    generatedAt: now.toISOString(),
  };
}
