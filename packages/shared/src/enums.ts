import { z } from "zod";

export const JourneyTypeSchema = z.enum(["buyer", "homeowner"]);
export type JourneyType = z.infer<typeof JourneyTypeSchema>;

// FP-003 / VS-005: every material measurement carries one of these.
export const MeasurementStatusSchema = z.enum([
  "user_confirmed",
  "source_printed",
  "calculated",
  "estimated",
  "unknown",
]);
export type MeasurementStatus = z.infer<typeof MeasurementStatusSchema>;

export const PersonRoleSchema = z.enum(["adult", "child", "regular_visitor"]);

export const AccessibilityScopeSchema = z.enum(["home", "room", "person"]);

// AC-002
export const AccessibilityNeedTypeSchema = z.enum([
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
export type AccessibilityNeedType = z.infer<typeof AccessibilityNeedTypeSchema>;

export const FeatureTypeSchema = z.enum([
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

export const WallSchema = z.enum(["north", "east", "south", "west"]);

export const UploadPurposeSchema = z.enum([
  "floor_plan",
  "room_photo",
  "inspiration",
]);
export type UploadPurpose = z.infer<typeof UploadPurposeSchema>;

export const UploadStatusSchema = z.enum([
  "quarantined",
  "rejected",
  "available",
]);

export const ScanStatusSchema = z.enum([
  "not_configured",
  "clean",
  "infected",
  "error",
]);

export const ReviewStatusSchema = z.enum([
  "draft",
  "accepted",
  "edited",
  "rejected",
]);

export const VisualTierSchema = z.enum([
  "practical",
  "recommended",
  "aspirational",
]);

export const AvailabilitySchema = z.enum([
  "in_stock",
  "out_of_stock",
  "unknown",
]);

export const RecommendationStatusSchema = z.enum([
  "active",
  "replaced",
  "rejected",
]);

// FR-14 refinement intents
export const SwapIntentSchema = z.enum([
  "cheaper",
  "similar",
  "upgrade",
  "different_colour",
  "different_retailer",
  "more_durable",
  "child_friendly",
  "available_sooner",
]);
export type SwapIntent = z.infer<typeof SwapIntentSchema>;
