import { z } from "zod";
import {
  AvailabilitySchema,
  MeasurementStatusSchema,
  RecommendationStatusSchema,
  ReviewStatusSchema,
  SwapIntentSchema,
} from "./enums.js";

// Products, recommendations and budget (FR-13..FR-15, FR-18..FR-23, FR-28,
// FR-39). All money is integer pence; the app is GBP-only for the MVP.

const Pence = z.number().int();
const Uuid = z.string().uuid();

export const PriceRangePenceSchema = z.object({
  low: Pence.nonnegative(),
  high: Pence.nonnegative(),
});
export type PriceRangePence = z.infer<typeof PriceRangePenceSchema>;

// ---------------------------------------------------------------------------
// Connector status (FR-28: failures degrade gracefully and are reported).

export const CatalogueConnectorStatusSchema = z.enum([
  "ok",
  // Some sources (e.g. one storefront) failed; results are partial.
  "partial",
  // Live catalogue could not be reached; output is requirement-only.
  "unavailable",
  // Kill switch tripped (SE-006 / FR-28).
  "disabled",
]);
export type CatalogueConnectorStatus = z.infer<
  typeof CatalogueConnectorStatusSchema
>;

export const CatalogueConnectorReportSchema = z.object({
  connector: z.literal("shopify_ucp"),
  status: CatalogueConnectorStatusSchema,
  // Human-readable explanation when not "ok". Never contains secrets.
  reason: z.string().nullable(),
  checkedAt: z.string(),
});
export type CatalogueConnectorReport = z.infer<
  typeof CatalogueConnectorReportSchema
>;

// ---------------------------------------------------------------------------
// Product (FR-21 normalised record, as exposed to the app).

export const ProductLicenceStatusSchema = z.enum([
  // FR-23: may be displayed with attribution + canonical link, but NOT
  // transformed or placed into generated room concepts.
  "display_with_attribution",
  "unknown",
]);

export const ProductDtoSchema = z.object({
  id: Uuid,
  retailer: z.string(),
  connector: z.string(),
  sourceProductId: z.string(),
  sourceVariantId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  widthCm: z.number().nullable(),
  depthCm: z.number().nullable(),
  heightCm: z.number().nullable(),
  dimensionStatus: MeasurementStatusSchema,
  colour: z.string().nullable(),
  material: z.string().nullable(),
  pricePence: Pence.nullable(),
  currency: z.string().nullable(),
  availability: AvailabilitySchema,
  imageUrls: z.array(z.string()),
  deliversToUk: z.boolean().nullable(),
  canonicalUrl: z.string().nullable(),
  checkoutUrl: z.string().nullable(),
  licenceStatus: z.string(),
  // FR-23: images may only be shown with this attribution.
  attribution: z.string(),
  // Images must not be placed into generated scenes unless true.
  imagesUsableInConcepts: z.boolean(),
  // FR-39 / D-004: disclosed whenever true.
  sponsored: z.boolean(),
  retrievedAt: z.string(),
});
export type ProductDto = z.infer<typeof ProductDtoSchema>;

// ---------------------------------------------------------------------------
// Recommendations.

export const DimensionFitSchema = z.enum([
  // All bounded dimensions are known and within the requirement bounds.
  "fits",
  // Requirement has no size bounds.
  "unbounded",
  // At least one bounded dimension is unknown; fit cannot be verified.
  "unknown",
  // A known dimension violates the bounds (never recommended).
  "exceeds",
]);
export type DimensionFit = z.infer<typeof DimensionFitSchema>;

export const RecommendationLabelsSchema = z.object({
  // FR-22: retrieved > 24h ago.
  stale: z.boolean(),
  // FR-22: out of stock or delisted.
  unavailable: z.boolean(),
  // Shopify caching guidance: price/availability older than 10 minutes must
  // be refreshed before being presented as current.
  priceNeedsRefresh: z.boolean(),
  sponsored: z.boolean(),
  // Only true when dims are retailer-printed AND within bounds.
  verifiedFit: z.boolean(),
  dimensionFit: DimensionFitSchema,
  // Recommendation was made against an older brief version.
  fromPreviousBrief: z.boolean(),
});

export const RecommendationDtoSchema = z.object({
  id: Uuid,
  roomId: Uuid,
  briefId: Uuid.nullable(),
  requirementId: z.string(),
  rank: z.number().int(),
  status: RecommendationStatusSchema,
  // Effective inclusion in budget totals (after FR-22 rules).
  includeInBudget: z.boolean(),
  // Whether the user explicitly chose (PATCH) to include/exclude.
  includeInBudgetSetByUser: z.boolean(),
  score: z.number(),
  reasons: z.array(z.string()),
  labels: RecommendationLabelsSchema,
  product: ProductDtoSchema,
  createdAt: z.string(),
});
export type RecommendationDto = z.infer<typeof RecommendationDtoSchema>;

export const RecommendationRequirementSchema = z.object({
  id: z.string(),
  category: z.string(),
  description: z.string(),
  quantity: z.number().int(),
  priority: z.enum(["must", "should", "could"]),
  minWidthCm: z.number().optional(),
  maxWidthCm: z.number().optional(),
  maxDepthCm: z.number().optional(),
  maxHeightCm: z.number().optional(),
  retainedPossessionId: z.string().optional(),
  estimatedPricePence: PriceRangePenceSchema.optional(),
});

export const RequirementRecommendationStateSchema = z.enum([
  // Satisfied by a retained possession (FR-11); nothing to buy.
  "retained",
  // Has at least one active product recommendation.
  "recommended",
  // Catalogue answered but nothing matched the requirement.
  "no_match",
  // Catalogue unavailable; requirement-only output with estimate.
  "catalogue_unavailable",
  // Not yet asked for recommendations.
  "not_requested",
]);

export const RequirementRecommendationsSchema = z.object({
  requirement: RecommendationRequirementSchema,
  state: RequirementRecommendationStateSchema,
  // Price band used for ranking (pence, per unit).
  priceBandPence: PriceRangePenceSchema.nullable(),
  // Requirement-level estimate. Clearly an estimate, not a live price.
  estimate: z
    .object({
      lowPence: Pence,
      highPence: Pence,
      label: z.literal("estimate"),
    })
    .nullable(),
  message: z.string().nullable(),
  // rank 1 = primary; others are alternatives.
  recommendations: z.array(RecommendationDtoSchema),
});
export type RequirementRecommendations = z.infer<
  typeof RequirementRecommendationsSchema
>;

export const RoomRecommendationsResponseSchema = z.object({
  roomId: Uuid,
  briefId: Uuid.nullable(),
  briefStatus: ReviewStatusSchema.nullable(),
  // True when recommendations are based on an unreviewed draft brief.
  briefIsDraft: z.boolean(),
  connector: CatalogueConnectorReportSchema.nullable(),
  requirements: z.array(RequirementRecommendationsSchema),
  disclosures: z.array(z.string()),
  generatedAt: z.string(),
});
export type RoomRecommendationsResponse = z.infer<
  typeof RoomRecommendationsResponseSchema
>;

// POST /products/rooms/:roomId/recommend
export const RecommendRoomRequestSchema = z
  .object({
    perRequirement: z.number().int().min(1).max(5).default(3),
    // Limit to specific requirement ids; default all open requirements.
    requirementIds: z.array(z.string()).max(50).optional(),
  })
  .default({ perRequirement: 3 });
export type RecommendRoomRequest = z.infer<typeof RecommendRoomRequestSchema>;

// POST /products/recommendations/:id/swap (FR-14)
export const SwapRecommendationRequestSchema = z.object({
  intent: SwapIntentSchema,
});
export type SwapRecommendationRequest = z.infer<
  typeof SwapRecommendationRequestSchema
>;

export const SwapRecommendationResponseSchema = z.object({
  // "swapped": old marked replaced, new active. Otherwise old stays active.
  outcome: z.enum(["swapped", "no_alternative", "catalogue_unavailable"]),
  previousRecommendationId: Uuid,
  recommendation: RecommendationDtoSchema,
  connector: CatalogueConnectorReportSchema,
  message: z.string().nullable(),
});
export type SwapRecommendationResponse = z.infer<
  typeof SwapRecommendationResponseSchema
>;

// POST /products/recommendations/:id/refresh (FR-22)
export const RefreshRecommendationRequestSchema = z
  .object({
    // OP-003: set when the app is about to hand off to the retailer.
    handoff: z.boolean().default(false),
  })
  .default({ handoff: false });
export type RefreshRecommendationRequest = z.infer<
  typeof RefreshRecommendationRequestSchema
>;

export const RefreshRecommendationResponseSchema = z.object({
  recommendation: RecommendationDtoSchema,
  // True when price/availability were confirmed live just now.
  verified: z.boolean(),
  changes: z.object({
    priceChanged: z.boolean(),
    previousPricePence: Pence.nullable(),
    currentPricePence: Pence.nullable(),
    availabilityChanged: z.boolean(),
    previousAvailability: AvailabilitySchema,
    currentAvailability: AvailabilitySchema,
    variantChanged: z.boolean(),
    delisted: z.boolean(),
  }),
  checkoutUrl: z.string().nullable(),
  canonicalUrl: z.string().nullable(),
  connector: CatalogueConnectorReportSchema,
  message: z.string().nullable(),
});
export type RefreshRecommendationResponse = z.infer<
  typeof RefreshRecommendationResponseSchema
>;

// PATCH /products/recommendations/:id (FR-22 retain choice)
export const UpdateRecommendationRequestSchema = z.object({
  includeInBudget: z.boolean(),
});
export type UpdateRecommendationRequest = z.infer<
  typeof UpdateRecommendationRequestSchema
>;

// ---------------------------------------------------------------------------
// Budget (FR-15).

export const BudgetLineSourceSchema = z.enum([
  // Live product price counted.
  "product",
  // Requirement estimate range (no product, or product excluded).
  "estimate",
  // Satisfied by a retained possession.
  "retained",
  // No product and no estimate available.
  "unpriced",
]);

export const BudgetLineSchema = z.object({
  requirementId: z.string(),
  category: z.string(),
  description: z.string(),
  quantity: z.number().int(),
  source: BudgetLineSourceSchema,
  recommendationId: Uuid.nullable(),
  productTitle: z.string().nullable(),
  retailer: z.string().nullable(),
  unitPricePence: Pence.nullable(),
  // Exact (product) amounts have low === high.
  lowPence: Pence,
  highPence: Pence,
  // Why a product price was not counted (stale/unavailable/excluded...).
  excludedReason: z
    .enum([
      "stale",
      "unavailable",
      "user_excluded",
      "no_gbp_price",
      "no_recommendation",
    ])
    .nullable(),
});
export type BudgetLine = z.infer<typeof BudgetLineSchema>;

export const BudgetTotalsSchema = z.object({
  // Sum of counted live product prices.
  productPence: Pence,
  // Sum of estimate ranges for requirements without a counted product.
  estimateLowPence: Pence,
  estimateHighPence: Pence,
  totalLowPence: Pence,
  totalHighPence: Pence,
  unpricedCount: z.number().int(),
});
export type BudgetTotals = z.infer<typeof BudgetTotalsSchema>;

export const BudgetRoomSchema = z.object({
  roomId: Uuid,
  name: z.string(),
  briefId: Uuid.nullable(),
  briefIsDraft: z.boolean(),
  totals: BudgetTotalsSchema,
  lines: z.array(BudgetLineSchema),
});

export const BudgetStatusSchema = z.enum([
  "within",
  // Upper end of the range exceeds the budget.
  "at_risk",
  // Even the lower end exceeds the budget.
  "over",
  "no_budget",
]);

export const HomeBudgetResponseSchema = z.object({
  homeId: Uuid,
  currency: z.literal("GBP"),
  householdBudgetPence: Pence.nullable(),
  rooms: z.array(BudgetRoomSchema),
  totals: BudgetTotalsSchema,
  status: BudgetStatusSchema,
  // Budget minus total range (null without a budget). Negative = over.
  remainingLowPence: Pence.nullable(),
  remainingHighPence: Pence.nullable(),
  overByPence: Pence.nullable(),
  notes: z.array(z.string()),
  generatedAt: z.string(),
});
export type HomeBudgetResponse = z.infer<typeof HomeBudgetResponseSchema>;
