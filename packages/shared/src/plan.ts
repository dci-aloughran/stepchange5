import { z } from "zod";
import {
  AccessibilityNeedTypeSchema,
  MeasurementStatusSchema,
  ReviewStatusSchema,
  VisualTierSchema,
} from "./enums.js";

// Planning area: functional brief (FR-09..FR-11), layout (AC-003/AC-004,
// VS-004) and visual concepts (FR-12, FR-17, VS-001..VS-005).
//
// Spatial conventions (all values in cm):
// - Origin is the room's north-west corner; x runs west->east along the room
//   width, y runs north->south along the room length.
// - Architectural feature offsetCm is measured along its wall from the wall's
//   start: the west end for north/south walls, the north end for east/west
//   walls.
// - A placement's xCm/yCm is the north-west corner of its footprint *after*
//   rotation. widthCm/depthCm are the unrotated item dimensions; for 90/270
//   the footprint is depthCm wide (x) and widthCm deep (y).

export const RequirementPrioritySchema = z.enum(["must", "should", "could"]);

export const PricePenceRangeSchema = z
  .object({
    low: z.int().min(0),
    high: z.int().min(0),
  })
  .refine((v) => v.low <= v.high, { message: "low must be <= high" });

const Cm = z.number().positive().max(5000);

export const FurnitureRequirementSchema = z.object({
  id: z.string().min(1).max(64),
  category: z.string().min(1).max(60),
  description: z.string().min(1).max(500),
  quantity: z.int().min(1).max(20),
  minWidthCm: Cm.optional(),
  maxWidthCm: Cm.optional(),
  maxDepthCm: Cm.optional(),
  maxHeightCm: Cm.optional(),
  priority: RequirementPrioritySchema,
  retainedPossessionId: z.string().optional(),
  estimatedPricePence: PricePenceRangeSchema.optional(),
});
export type FurnitureRequirementDto = z.infer<
  typeof FurnitureRequirementSchema
>;

// Requirement edits from the user: id optional for new requirements.
export const FurnitureRequirementInputSchema =
  FurnitureRequirementSchema.extend({
    id: z.string().min(1).max(64).optional(),
  });
export type FurnitureRequirementInput = z.infer<
  typeof FurnitureRequirementInputSchema
>;

export const BriefSchema = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  version: z.int(),
  householdNeed: z.string(),
  roomConstraints: z.array(z.string()),
  recommendedUse: z.string(),
  requirements: z.array(FurnitureRequirementSchema),
  uncertainties: z.array(z.string()),
  status: ReviewStatusSchema,
  modelVersion: z.string().nullable(),
  promptVersion: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Brief = z.infer<typeof BriefSchema>;

export const BriefGenerateQuerySchema = z.object({
  allowUnreviewed: z.enum(["true", "false"]).optional(),
});

export const BriefPatchSchema = z
  .object({
    householdNeed: z.string().trim().min(1).max(2000).optional(),
    recommendedUse: z.string().trim().min(1).max(2000).optional(),
    requirements: z.array(FurnitureRequirementInputSchema).max(40).optional(),
    status: z.enum(["accepted", "edited", "rejected"]).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Nothing to update",
  });
export type BriefPatch = z.infer<typeof BriefPatchSchema>;

export const BriefListResponseSchema = z.object({
  briefs: z.array(BriefSchema),
});

// ---------- Layout ----------

export const RotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);
export type Rotation = z.infer<typeof RotationSchema>;

export const PlacementSchema = z.object({
  requirementId: z.string(),
  label: z.string(),
  xCm: z.number(),
  yCm: z.number(),
  widthCm: z.number().positive(),
  depthCm: z.number().positive(),
  rotationDeg: RotationSchema,
});
export type PlacementDto = z.infer<typeof PlacementSchema>;

export const ZoneKindSchema = z.enum([
  "door_swing",
  "obstruction",
  "hearth",
  "window_front",
  "radiator_front",
  "clear_route",
  "turning_area",
  "transfer_area",
]);
export type ZoneKind = z.infer<typeof ZoneKindSchema>;

export const ZoneSchema = z.object({
  kind: ZoneKindSchema,
  label: z.string(),
  xCm: z.number(),
  yCm: z.number(),
  widthCm: z.number(),
  depthCm: z.number(),
  // Hard zones produce errors when overlapped; soft zones produce warnings.
  hard: z.boolean(),
  // Derived from a confirmed accessibility need (AC-003).
  accessibility: z.boolean(),
});
export type Zone = z.infer<typeof ZoneSchema>;

export const ConflictCodeSchema = z.enum([
  "outside_room",
  "item_overlap",
  "zone_overlap",
  "accessibility_zone_overlap",
  "turning_area_unavailable",
  "transfer_area_blocked",
  "clear_route_obstructed",
  "reach_range",
  "window_front",
  "radiator_front",
  "rug_in_door_swing",
]);
export type ConflictCode = z.infer<typeof ConflictCodeSchema>;

export const ConflictSchema = z.object({
  code: ConflictCodeSchema,
  message: z.string(),
  requirementId: z.string().optional(),
  label: z.string().optional(),
  severity: z.enum(["error", "warning"]),
  kind: z.enum(["fit", "accessibility"]),
});
export type Conflict = z.infer<typeof ConflictSchema>;

export const NeedEvaluationSchema = z.object({
  needId: z.string().optional(),
  needType: AccessibilityNeedTypeSchema,
  status: z.enum(["satisfied", "violated", "not_evaluable", "not_assessed"]),
  message: z.string(),
});
export type NeedEvaluation = z.infer<typeof NeedEvaluationSchema>;

export const RepairMoveSchema = z.object({
  requirementId: z.string(),
  label: z.string(),
  from: z.object({ xCm: z.number(), yCm: z.number(), rotationDeg: z.number() }),
  to: z.object({ xCm: z.number(), yCm: z.number(), rotationDeg: z.number() }),
});

export const LayoutValidationSchema = z.object({
  verifiedFit: z.boolean(),
  verifiedAccessible: z.boolean(),
  // Errors only. Any error blocks verifiedFit.
  conflicts: z.array(ConflictSchema),
  warnings: z.array(ConflictSchema),
  // Why verifiedFit / verifiedAccessible is false (AC-005).
  reasons: z.array(z.string()),
  notes: z.array(z.string()),
  needs: z.array(NeedEvaluationSchema),
  repairs: z.array(RepairMoveSchema),
});
export type LayoutValidationDto = z.infer<typeof LayoutValidationSchema>;

export const LayoutSchema = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  briefId: z.uuid(),
  placements: z.array(PlacementSchema),
  zones: z.array(ZoneSchema),
  validation: LayoutValidationSchema.nullable(),
  status: ReviewStatusSchema,
  createdAt: z.string(),
  // Room envelope for drawing the to-scale schematic (VS-004).
  room: z.object({
    widthCm: z.number().nullable(),
    lengthCm: z.number().nullable(),
    dimensionStatus: MeasurementStatusSchema,
  }),
});
export type Layout = z.infer<typeof LayoutSchema>;

export const LayoutPlacementInputSchema = z.object({
  requirementId: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(120).optional(),
  xCm: z.number().min(-1000).max(5000),
  yCm: z.number().min(-1000).max(5000),
  rotationDeg: RotationSchema,
  // Only used when the requirement has no known dimensions.
  widthCm: Cm.optional(),
  depthCm: Cm.optional(),
});

export const LayoutPatchSchema = z
  .object({
    placements: z.array(LayoutPlacementInputSchema).max(80).optional(),
    status: z.enum(["accepted", "edited", "rejected"]).optional(),
    // When true, attempt the deterministic repair after applying the moves.
    repair: z.boolean().optional(),
  })
  .refine((v) => v.placements !== undefined || v.status !== undefined, {
    message: "Nothing to update",
  });
export type LayoutPatch = z.infer<typeof LayoutPatchSchema>;

// ---------- Concepts ----------

export const ConceptCreateSchema = z.object({
  roomId: z.uuid(),
  vibe: z.string().trim().min(2).max(80),
  tier: VisualTierSchema.default("recommended"),
  sourceUploadId: z.uuid().optional(),
});
export type ConceptCreate = z.infer<typeof ConceptCreateSchema>;

export const ConceptPatchSchema = z
  .object({
    looksLikeMyRoom: z.boolean().optional(),
    status: z.enum(["accepted", "edited", "rejected"]).optional(),
  })
  .refine((v) => v.looksLikeMyRoom !== undefined || v.status !== undefined, {
    message: "Nothing to update",
  });
export type ConceptPatch = z.infer<typeof ConceptPatchSchema>;

export const ConceptSchema = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  briefId: z.uuid().nullable(),
  layoutId: z.uuid().nullable(),
  vibe: z.string(),
  tier: VisualTierSchema,
  sourceUploadId: z.uuid().nullable(),
  sourcePhotoUsed: z.boolean(),
  hasImage: z.boolean(),
  dimensionBasis: MeasurementStatusSchema,
  disclosure: z.string(),
  looksLikeMyRoom: z.boolean().nullable(),
  status: ReviewStatusSchema,
  modelVersion: z.string().nullable(),
  promptVersion: z.string().nullable(),
  createdAt: z.string(),
});
export type Concept = z.infer<typeof ConceptSchema>;

export const ConceptListQuerySchema = z.object({
  roomId: z.uuid().optional(),
});

export const ConceptCompareQuerySchema = z.object({
  roomId: z.uuid(),
});

export const ConceptImageUrlResponseSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
});

export const ConceptCompareResponseSchema = z.object({
  roomId: z.uuid(),
  groups: z.array(
    z.object({
      vibe: z.string(),
      tiers: z.object({
        practical: z.array(ConceptSchema),
        recommended: z.array(ConceptSchema),
        aspirational: z.array(ConceptSchema),
      }),
    }),
  ),
});
export type ConceptCompareResponse = z.infer<
  typeof ConceptCompareResponseSchema
>;
