import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const journeyType = pgEnum("journey_type", ["buyer", "homeowner"]);
export const measurementStatus = pgEnum("measurement_status", [
  "user_confirmed",
  "source_printed",
  "calculated",
  "estimated",
  "unknown",
]);
export const personRole = pgEnum("person_role", [
  "adult",
  "child",
  "regular_visitor",
]);
export const accessibilityScope = pgEnum("accessibility_scope", [
  "home",
  "room",
  "person",
]);
export const accessibilityNeedType = pgEnum("accessibility_need_type", [
  "mobility_aid",
  "clear_route",
  "turning_area",
  "transfer_area",
  "reach_range",
  "step_free",
  "seating_support",
  "trip_hazard_avoidance",
  "visual",
  "hearing",
  "dexterity",
  "cognitive",
  "sensory",
]);
export const featureType = pgEnum("feature_type", [
  "door",
  "window",
  "bay_window",
  "fireplace",
  "radiator",
  "stairs",
  "column",
  "built_in",
  "other",
]);
export const wall = pgEnum("wall", ["north", "east", "south", "west"]);
export const uploadPurpose = pgEnum("upload_purpose", [
  "floor_plan",
  "room_photo",
  "inspiration",
  // Retired listing-preview uploads; kept because Postgres can't drop enum
  // values. No longer accepted by the API.
  "listing",
]);
export const uploadStatus = pgEnum("upload_status", [
  "quarantined",
  "rejected",
  "available",
]);
export const scanStatus = pgEnum("scan_status", [
  "not_configured",
  "clean",
  "infected",
  "error",
]);
export const reviewStatus = pgEnum("review_status", [
  "draft",
  "accepted",
  "edited",
  "rejected",
]);
export const visualTier = pgEnum("visual_tier", [
  "practical",
  "recommended",
  "aspirational",
]);
export const availability = pgEnum("availability", [
  "in_stock",
  "out_of_stock",
  "unknown",
]);
export const recommendationStatus = pgEnum("recommendation_status", [
  "active",
  "replaced",
  "rejected",
]);

// Clerk user id is the primary key.
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  journeyType: journeyType("journey_type"),
  // MB-005: last confirmed step for resume after interruption.
  journeyState: jsonb("journey_state")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  // SE-010: separate, revocable consent; default off.
  aiTrainingConsent: boolean("ai_training_consent").notNull().default(false),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const households = pgTable(
  "households",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("My household"),
    lifestyle: jsonb("lifestyle")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    practicalNeeds: jsonb("practical_needs")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    budgetTotalPence: integer("budget_total_pence"),
    currency: text("currency").notNull().default("GBP"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("households_user_idx").on(t.userId)],
);

// SE-007: children's data minimised to role + age only; no names required.
export const persons = pgTable("persons", {
  id: id(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  role: personRole("role").notNull(),
  ageYears: integer("age_years"),
  routines: jsonb("routines")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: createdAt(),
});

export const homes = pgTable("homes", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  householdId: uuid("household_id").references(() => households.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  journeyType: journeyType("journey_type").notNull().default("homeowner"),
  source: text("source").notNull().default("manual"),
  // SE-009: address-level data is only ever returned to the owner.
  address: text("address"),
  listing: jsonb("listing")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  // SE-011: buyer data gets a distinct retention state.
  retentionState: text("retention_state").notNull().default("active"),
  retainUntil: timestamp("retain_until", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const floors = pgTable("floors", {
  id: id(),
  homeId: uuid("home_id")
    .notNull()
    .references(() => homes.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  level: integer("level").notNull().default(0),
  createdAt: createdAt(),
});

export const rooms = pgTable(
  "rooms",
  {
    id: id(),
    homeId: uuid("home_id")
      .notNull()
      .references(() => homes.id, { onDelete: "cascade" }),
    floorId: uuid("floor_id").references(() => floors.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    roomType: text("room_type").notNull().default("other"),
    selected: boolean("selected").notNull().default(true),
    widthCm: doublePrecision("width_cm"),
    lengthCm: doublePrecision("length_cm"),
    heightCm: doublePrecision("height_cm"),
    dimensionStatus: measurementStatus("dimension_status")
      .notNull()
      .default("unknown"),
    // Optional polygon in cm, origin at the room's north-west corner.
    polygon: jsonb("polygon").$type<Array<{ x: number; y: number }>>(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("rooms_home_idx").on(t.homeId)],
);

// FP-003: provenance for every material measurement.
export const measurements = pgTable("measurements", {
  id: id(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  valueCm: doublePrecision("value_cm"),
  status: measurementStatus("status").notNull(),
  source: text("source").notNull(),
  sourceUploadId: uuid("source_upload_id"),
  confidence: real("confidence"),
  recordedAt: createdAt(),
});

export const architecturalFeatures = pgTable("architectural_features", {
  id: id(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  type: featureType("type").notNull(),
  wall: wall("wall"),
  offsetCm: doublePrecision("offset_cm"),
  widthCm: doublePrecision("width_cm"),
  heightCm: doublePrecision("height_cm"),
  status: measurementStatus("status").notNull().default("unknown"),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const accessibilityNeeds = pgTable("accessibility_needs", {
  id: id(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  scope: accessibilityScope("scope").notNull(),
  roomId: uuid("room_id").references(() => rooms.id, { onDelete: "cascade" }),
  personId: uuid("person_id").references(() => persons.id, {
    onDelete: "cascade",
  }),
  needType: accessibilityNeedType("need_type").notNull(),
  // e.g. { widthCm, turningDiameterCm, reachMinCm, reachMaxCm }
  params: jsonb("params")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  // AC-003: only confirmed needs become hard constraints.
  confirmed: boolean("confirmed").notNull().default(false),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const existingPossessions = pgTable("existing_possessions", {
  id: id(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  widthCm: doublePrecision("width_cm"),
  depthCm: doublePrecision("depth_cm"),
  heightCm: doublePrecision("height_cm"),
  keep: boolean("keep").notNull().default(true),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const uploads = pgTable(
  "uploads",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    homeId: uuid("home_id").references(() => homes.id, { onDelete: "cascade" }),
    roomId: uuid("room_id").references(() => rooms.id, {
      onDelete: "set null",
    }),
    purpose: uploadPurpose("purpose").notNull(),
    originalName: text("original_name").notNull(),
    declaredMime: text("declared_mime"),
    detectedMime: text("detected_mime"),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    pageCount: integer("page_count"),
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),
    status: uploadStatus("status").notNull().default("quarantined"),
    scanStatus: scanStatus("scan_status").notNull().default("not_configured"),
    rejectionCode: text("rejection_code"),
    blobPathname: text("blob_pathname"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("uploads_user_idx").on(t.userId)],
);

export const inspirationItems = pgTable("inspiration_items", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  uploadId: uuid("upload_id").references(() => uploads.id, {
    onDelete: "cascade",
  }),
  sourceUrl: text("source_url"),
  kind: text("kind").notNull().default("image"),
  reaction: text("reaction").notNull().default("love"),
  note: text("note"),
  createdAt: createdAt(),
});

export type TasteAttribute = {
  key: string;
  label: string;
  value: string;
  confidence: number;
  userEdited: boolean;
};

export const tasteProfiles = pgTable(
  "taste_profiles",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    summary: text("summary").notNull().default(""),
    attributes: jsonb("attributes")
      .$type<TasteAttribute[]>()
      .notNull()
      .default([]),
    status: reviewStatus("status").notNull().default("draft"),
    modelVersion: text("model_version"),
    promptVersion: text("prompt_version"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("taste_profiles_user_idx").on(t.userId)],
);

export type FurnitureRequirement = {
  id: string;
  category: string;
  description: string;
  quantity: number;
  minWidthCm?: number;
  maxWidthCm?: number;
  maxDepthCm?: number;
  maxHeightCm?: number;
  priority: "must" | "should" | "could";
  retainedPossessionId?: string;
  estimatedPricePence?: { low: number; high: number };
};

export const functionalBriefs = pgTable("functional_briefs", {
  id: id(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  householdNeed: text("household_need").notNull(),
  roomConstraints: jsonb("room_constraints")
    .$type<string[]>()
    .notNull()
    .default([]),
  recommendedUse: text("recommended_use").notNull(),
  requirements: jsonb("requirements")
    .$type<FurnitureRequirement[]>()
    .notNull()
    .default([]),
  // AC-005: unresolved uncertainty that blocks fit / accessibility claims.
  uncertainties: jsonb("uncertainties").$type<string[]>().notNull().default([]),
  status: reviewStatus("status").notNull().default("draft"),
  modelVersion: text("model_version"),
  promptVersion: text("prompt_version"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type Placement = {
  requirementId: string;
  label: string;
  xCm: number;
  yCm: number;
  widthCm: number;
  depthCm: number;
  rotationDeg: number;
};

export type LayoutValidation = {
  verifiedFit: boolean;
  verifiedAccessible: boolean;
  conflicts: Array<{ code: string; message: string; requirementId?: string }>;
  reasons: string[];
};

export const layouts = pgTable("layouts", {
  id: id(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  briefId: uuid("brief_id")
    .notNull()
    .references(() => functionalBriefs.id, { onDelete: "cascade" }),
  placements: jsonb("placements").$type<Placement[]>().notNull().default([]),
  // Reserved zones (circulation / turning / transfer) in cm.
  zones: jsonb("zones")
    .$type<
      Array<{
        kind: string;
        xCm: number;
        yCm: number;
        widthCm: number;
        depthCm: number;
      }>
    >()
    .notNull()
    .default([]),
  validation: jsonb("validation").$type<LayoutValidation>(),
  status: reviewStatus("status").notNull().default("draft"),
  createdAt: createdAt(),
});

export const concepts = pgTable("concepts", {
  id: id(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  briefId: uuid("brief_id").references(() => functionalBriefs.id, {
    onDelete: "set null",
  }),
  layoutId: uuid("layout_id").references(() => layouts.id, {
    onDelete: "set null",
  }),
  vibe: text("vibe").notNull(),
  tier: visualTier("tier").notNull().default("recommended"),
  sourceUploadId: uuid("source_upload_id").references(() => uploads.id, {
    onDelete: "set null",
  }),
  imageBlobPathname: text("image_blob_pathname"),
  // VS-005
  dimensionBasis: measurementStatus("dimension_basis")
    .notNull()
    .default("unknown"),
  // VS-002
  disclosure: text("disclosure").notNull(),
  looksLikeMyRoom: boolean("looks_like_my_room"),
  status: reviewStatus("status").notNull().default("draft"),
  modelVersion: text("model_version"),
  promptVersion: text("prompt_version"),
  createdAt: createdAt(),
});

// FR-21 normalised product record.
export const products = pgTable(
  "products",
  {
    id: id(),
    retailer: text("retailer").notNull(),
    connector: text("connector").notNull(),
    sourceProductId: text("source_product_id").notNull(),
    sourceVariantId: text("source_variant_id"),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category"),
    widthCm: doublePrecision("width_cm"),
    depthCm: doublePrecision("depth_cm"),
    heightCm: doublePrecision("height_cm"),
    dimensionStatus: measurementStatus("dimension_status")
      .notNull()
      .default("unknown"),
    colour: text("colour"),
    material: text("material"),
    pricePence: integer("price_pence"),
    currency: text("currency"),
    availability: availability("availability").notNull().default("unknown"),
    imageUrls: jsonb("image_urls").$type<string[]>().notNull().default([]),
    deliversToUk: boolean("delivers_to_uk"),
    canonicalUrl: text("canonical_url"),
    checkoutUrl: text("checkout_url"),
    licenceStatus: text("licence_status").notNull().default("unknown"),
    sponsored: boolean("sponsored").notNull().default(false),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("products_source_idx").on(
      t.connector,
      t.sourceProductId,
      t.sourceVariantId,
    ),
  ],
);

export const recommendations = pgTable("recommendations", {
  id: id(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  briefId: uuid("brief_id").references(() => functionalBriefs.id, {
    onDelete: "cascade",
  }),
  requirementId: text("requirement_id").notNull(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  rank: integer("rank").notNull(),
  // FR-39: auditable ranking inputs; commission is never an input.
  rankInputs: jsonb("rank_inputs")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  status: recommendationStatus("status").notNull().default("active"),
  includeInBudget: boolean("include_in_budget").notNull().default(true),
  createdAt: createdAt(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    userId: text("user_id"),
    type: text("type").notNull(),
    severity: text("severity").notNull().default("info"),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_type_idx").on(t.type, t.createdAt)],
);

// OP-001..003. No sensitive content in props.
export const analyticsEvents = pgTable("analytics_events", {
  id: id(),
  userId: text("user_id"),
  name: text("name").notNull(),
  journeyType: journeyType("journey_type"),
  device: text("device"),
  props: jsonb("props").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

// SE-006 / FR-28: runtime kill switches without a redeploy.
export const killSwitches = pgTable("kill_switches", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  reason: text("reason"),
  updatedAt: updatedAt(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
