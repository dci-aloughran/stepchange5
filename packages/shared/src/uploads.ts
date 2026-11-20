import { z } from "zod";
import {
  FeatureTypeSchema,
  MeasurementStatusSchema,
  ScanStatusSchema,
  UploadPurposeSchema,
  UploadStatusSchema,
  WallSchema,
} from "./enums.js";

// ---------------------------------------------------------------------------
// Upload policy (SE-001). Shared so the app can pre-check and downscale before
// sending; the server enforces the same values authoritatively.
// ---------------------------------------------------------------------------

/** 4 MiB. Vercel's request body limit is 4.5 MB, multipart overhead included. */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** Maximum decoded pixel count (width x height) for raster uploads. */
export const UPLOAD_MAX_PIXELS = 40_000_000;
/** Maximum page count for PDF floor plans. */
export const UPLOAD_MAX_PDF_PAGES = 20;
/** Presigned view URLs expire after this many seconds (<= 10 minutes). */
export const UPLOAD_VIEW_URL_TTL_SECONDS = 300;

export const UploadMimeSchema = z.enum([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
export type UploadMime = z.infer<typeof UploadMimeSchema>;

/** Allowlisted MIME types per purpose. */
export const UPLOAD_ALLOWED_MIME: Record<
  z.infer<typeof UploadPurposeSchema>,
  readonly UploadMime[]
> = {
  floor_plan: ["application/pdf", "image/png", "image/jpeg"],
  room_photo: ["image/png", "image/jpeg", "image/webp"],
  inspiration: ["image/png", "image/jpeg", "image/webp"],
  // Retired (listing preview removed): no file types are accepted.
  listing: [],
};

/** Allowlisted file extensions per MIME type. */
export const UPLOAD_EXTENSIONS: Record<UploadMime, readonly string[]> = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
};

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** POST /uploads multipart form body. */
export const UploadCreateFormSchema = z.object({
  file: z.file(),
  purpose: UploadPurposeSchema,
  homeId: z.uuid().optional(),
  roomId: z.uuid().optional(),
});
export type UploadCreateForm = z.infer<typeof UploadCreateFormSchema>;

/** GET /uploads query. */
export const UploadListQuerySchema = z.object({
  homeId: z.uuid().optional(),
  roomId: z.uuid().optional(),
  purpose: UploadPurposeSchema.optional(),
  status: UploadStatusSchema.optional(),
});
export type UploadListQuery = z.infer<typeof UploadListQuerySchema>;

export const UploadIdParamSchema = z.object({ id: z.uuid() });

/** POST /uploads/:id/extract-floorplan JSON body (optional). */
export const FloorplanExtractRequestSchema = z.object({
  /**
   * When true, unreviewed rooms previously created from this upload are
   * deleted before the new extraction is saved. Otherwise a repeat extraction
   * returns 409.
   */
  replaceExisting: z.boolean().optional(),
});
export type FloorplanExtractRequest = z.infer<
  typeof FloorplanExtractRequestSchema
>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * Coarse, user-safe rejection category (SE-005: never exposes detection
 * internals). The precise code is kept server-side for audit.
 */
export const UploadRejectionReasonSchema = z.enum([
  "too_large",
  "unsupported_type",
  "invalid_file",
  "processing_error",
]);
export type UploadRejectionReason = z.infer<typeof UploadRejectionReasonSchema>;

export const UploadDtoSchema = z.object({
  id: z.uuid(),
  purpose: UploadPurposeSchema,
  status: UploadStatusSchema,
  scanStatus: ScanStatusSchema,
  homeId: z.uuid().nullable(),
  roomId: z.uuid().nullable(),
  originalName: z.string(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int(),
  widthPx: z.number().int().nullable(),
  heightPx: z.number().int().nullable(),
  pageCount: z.number().int().nullable(),
  rejectionReason: UploadRejectionReasonSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UploadDto = z.infer<typeof UploadDtoSchema>;

export const UploadCreateResponseSchema = z.object({ upload: UploadDtoSchema });
export type UploadCreateResponse = z.infer<typeof UploadCreateResponseSchema>;

/** 422 body when an upload is rejected (fail closed, safe to retry). */
export const UploadRejectedResponseSchema = z.object({
  error: z.string(),
  uploadId: z.uuid().nullable(),
  reason: UploadRejectionReasonSchema,
  retryable: z.literal(true),
});
export type UploadRejectedResponse = z.infer<
  typeof UploadRejectedResponseSchema
>;

export const UploadListResponseSchema = z.object({
  uploads: z.array(UploadDtoSchema),
});
export type UploadListResponse = z.infer<typeof UploadListResponseSchema>;

export const UploadViewUrlResponseSchema = z.object({
  url: z.url(),
  expiresAt: z.string(),
  mimeType: z.string(),
});
export type UploadViewUrlResponse = z.infer<typeof UploadViewUrlResponseSchema>;

// ---------------------------------------------------------------------------
// Floor-plan extraction (FP-002, FP-003, FP-005)
// ---------------------------------------------------------------------------

/**
 * How the model arrived at a dimension. Only `printed_label` can justify
 * `source_printed`; `scale_bar` / `other_printed_dimensions` can justify at
 * most `estimated`. Image resolution or page size is never a valid basis.
 */
export const DimensionBasisSchema = z.enum([
  "printed_label",
  "scale_bar",
  "other_printed_dimensions",
  "none",
]);
export type DimensionBasis = z.infer<typeof DimensionBasisSchema>;

const nullableNumber = z.number().nullable();

/** One dimension as reported by the model (validated, then normalised). */
export const FloorplanDimensionSchema = z.object({
  valueCm: nullableNumber.describe(
    "Value in centimetres, or null if not legible/derivable.",
  ),
  status: z
    .enum(["source_printed", "estimated", "unknown"])
    .describe(
      "source_printed only when a printed dimension label for this exact measurement is legible; estimated only when derived from a legible scale bar or other printed dimensions; otherwise unknown.",
    ),
  basis: DimensionBasisSchema,
  confidence: z.number().describe("0..1"),
  printedText: z
    .string()
    .nullable()
    .describe("The printed label text as it appears, e.g. 3.45m x 4.10m."),
});
export type FloorplanDimension = z.infer<typeof FloorplanDimensionSchema>;

export const FloorplanFeatureSchema = z.object({
  type: FeatureTypeSchema,
  wall: WallSchema.nullable().describe(
    "Plan-relative wall: top of drawing = north, right = east. Null when not determinable.",
  ),
  widthCm: FloorplanDimensionSchema.nullable(),
  notes: z.string().nullable(),
});
export type FloorplanFeature = z.infer<typeof FloorplanFeatureSchema>;

export const FloorplanRoomSchema = z.object({
  name: z.string().describe("Room label as printed, e.g. 'Bedroom 2'."),
  roomType: z
    .string()
    .describe(
      "One of living_room, kitchen, kitchen_diner, dining_room, bedroom, bathroom, en_suite, wc, hallway, landing, study, utility, conservatory, garage, storage, other.",
    ),
  floorLevel: z.number().int().describe("Matches a floors[].level value."),
  width: FloorplanDimensionSchema.describe(
    "Horizontal extent as drawn (left-right).",
  ),
  length: FloorplanDimensionSchema.describe(
    "Vertical extent as drawn (top-bottom).",
  ),
  features: z.array(FloorplanFeatureSchema),
  notes: z.string().nullable(),
});
export type FloorplanRoom = z.infer<typeof FloorplanRoomSchema>;

/** Raw model output schema for floor-plan extraction. */
export const FloorplanExtractionSchema = z.object({
  isFloorPlan: z
    .boolean()
    .describe("False if the document is not an architectural floor plan."),
  floors: z.array(
    z.object({
      name: z.string(),
      level: z.number().int().describe("0 = ground, 1 = first, -1 = lower."),
    }),
  ),
  rooms: z.array(FloorplanRoomSchema),
  labels: z
    .array(z.string())
    .describe("Other legible text labels (excluding addresses/agent names)."),
  scale: z.object({
    hasScaleBar: z.boolean(),
    printedScale: z.string().nullable().describe("e.g. '1:100' if printed."),
  }),
  needsKnownMeasurement: z.boolean(),
  uncertaintyNotes: z.array(z.string()),
});
export type FloorplanExtraction = z.infer<typeof FloorplanExtractionSchema>;

// Normalised extraction persisted into the home.

export const ExtractedMeasurementSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  valueCm: z.number().nullable(),
  status: MeasurementStatusSchema,
  source: z.string(),
  sourceUploadId: z.uuid().nullable(),
  confidence: z.number().nullable(),
});
export type ExtractedMeasurement = z.infer<typeof ExtractedMeasurementSchema>;

export const ExtractedFeatureSchema = z.object({
  id: z.uuid(),
  type: FeatureTypeSchema,
  wall: WallSchema.nullable(),
  widthCm: z.number().nullable(),
  status: MeasurementStatusSchema,
  notes: z.string().nullable(),
});
export type ExtractedFeature = z.infer<typeof ExtractedFeatureSchema>;

export const ExtractedRoomSchema = z.object({
  id: z.uuid(),
  floorId: z.uuid().nullable(),
  name: z.string(),
  roomType: z.string(),
  widthCm: z.number().nullable(),
  lengthCm: z.number().nullable(),
  dimensionStatus: MeasurementStatusSchema,
  /** Always null after extraction: the user must review (FP-004). */
  reviewedAt: z.string().nullable(),
  features: z.array(ExtractedFeatureSchema),
  measurements: z.array(ExtractedMeasurementSchema),
});
export type ExtractedRoom = z.infer<typeof ExtractedRoomSchema>;

export const ExtractedFloorSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  level: z.number().int(),
});
export type ExtractedFloor = z.infer<typeof ExtractedFloorSchema>;

export const FloorplanExtractResponseSchema = z.object({
  uploadId: z.uuid(),
  homeId: z.uuid(),
  floors: z.array(ExtractedFloorSchema),
  rooms: z.array(ExtractedRoomSchema),
  labels: z.array(z.string()),
  needsKnownMeasurement: z.boolean(),
  uncertaintyNotes: z.array(z.string()),
  warnings: z.array(z.string()),
  requiresReview: z.literal(true),
  modelVersion: z.string(),
  promptVersion: z.string(),
});
export type FloorplanExtractResponse = z.infer<
  typeof FloorplanExtractResponseSchema
>;

/** Error body when extraction fails (FP-006: fall back to manual rooms). */
export const FloorplanExtractFailedResponseSchema = z.object({
  error: z.string(),
  fallback: z.literal("manual_room_entry"),
});
export type FloorplanExtractFailedResponse = z.infer<
  typeof FloorplanExtractFailedResponseSchema
>;
