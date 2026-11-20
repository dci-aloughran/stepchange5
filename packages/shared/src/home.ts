import { z } from "zod";
import {
  FeatureTypeSchema,
  JourneyTypeSchema,
  MeasurementStatusSchema,
  WallSchema,
} from "./enums.js";

// Home area: homes, floors, rooms, architectural features, measurements and
// the home overview. Money is integer pence; lengths are cm.

const cm = z.number().positive().max(10_000);
const isoDate = z.string();

// ---------------------------------------------------------------------------
// Homes (FR-03, D-003: listing details are entered by the user, never
// scraped; SE-011 buyer retention)
// ---------------------------------------------------------------------------

export const RetentionStateSchema = z.enum([
  // Homeowner data, or a buyer home that has been purchased.
  "active",
  // Prospective purchase in progress: retained for 180 days.
  "buyer_active",
  // Purchase not proceeding: retained for 30 days, then deleted.
  "purchase_not_proceeding",
]);
export type RetentionState = z.infer<typeof RetentionStateSchema>;

export const BUYER_RETENTION_DAYS = 180;
export const NOT_PROCEEDING_RETENTION_DAYS = 30;

export const ListingSchema = z.object({
  pricePence: z.number().int().min(0).max(100_000_000_000).optional(),
  floorAreaSqm: z.number().positive().max(10_000).optional(),
  bedrooms: z.number().int().min(0).max(50).optional(),
  bathrooms: z.number().int().min(0).max(50).optional(),
  description: z.string().max(5000).optional(),
});
export type Listing = z.infer<typeof ListingSchema>;

export const CreateHomeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  journeyType: JourneyTypeSchema,
  address: z.string().trim().max(300).nullable().optional(),
  listing: ListingSchema.optional(),
});
export type CreateHome = z.infer<typeof CreateHomeSchema>;

export const UpdateHomeSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    journeyType: JourneyTypeSchema,
    address: z.string().trim().max(300).nullable(),
    listing: ListingSchema,
    retentionState: RetentionStateSchema,
  })
  .partial();
export type UpdateHome = z.infer<typeof UpdateHomeSchema>;

export const HomeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  journeyType: JourneyTypeSchema,
  source: z.string(),
  address: z.string().nullable(),
  listing: ListingSchema,
  retentionState: RetentionStateSchema,
  retainUntil: isoDate.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Home = z.infer<typeof HomeSchema>;

export const HomeListItemSchema = HomeSchema.extend({
  roomCount: z.number().int(),
});
export type HomeListItem = z.infer<typeof HomeListItemSchema>;

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

export const CreateFloorSchema = z.object({
  name: z.string().trim().min(1).max(60),
  level: z.number().int().min(-5).max(200).optional(),
});
export type CreateFloor = z.infer<typeof CreateFloorSchema>;

export const UpdateFloorSchema = CreateFloorSchema.partial();
export type UpdateFloor = z.infer<typeof UpdateFloorSchema>;

export const FloorSchema = z.object({
  id: z.uuid(),
  homeId: z.uuid(),
  name: z.string(),
  level: z.number().int(),
  createdAt: isoDate,
});
export type Floor = z.infer<typeof FloorSchema>;

// ---------------------------------------------------------------------------
// Measurements (FP-003 provenance)
// ---------------------------------------------------------------------------

export const MeasurementKindSchema = z.enum(["width", "length", "height"]);
export type MeasurementKind = z.infer<typeof MeasurementKindSchema>;

export const MeasurementSchema = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  kind: z.string(),
  valueCm: z.number().nullable(),
  status: MeasurementStatusSchema,
  source: z.string(),
  sourceUploadId: z.uuid().nullable(),
  confidence: z.number().nullable(),
  recordedAt: isoDate,
});
export type Measurement = z.infer<typeof MeasurementSchema>;

// ---------------------------------------------------------------------------
// Rooms (FP-004 review, FP-006 manual creation)
// ---------------------------------------------------------------------------

export const RoomTypeSchema = z.enum([
  "living_room",
  "kitchen",
  "kitchen_diner",
  "dining_room",
  "bedroom",
  "bathroom",
  "en_suite",
  "wc",
  "study",
  "playroom",
  "hallway",
  "landing",
  "utility",
  "conservatory",
  "garage",
  "other",
]);
export type RoomType = z.infer<typeof RoomTypeSchema>;

export const PolygonSchema = z
  .array(z.object({ x: z.number(), y: z.number() }))
  .min(3)
  .max(200);

const roomFields = {
  name: z.string().trim().min(1).max(80),
  roomType: RoomTypeSchema,
  floorId: z.uuid().nullable(),
  selected: z.boolean(),
  widthCm: cm.nullable(),
  lengthCm: cm.nullable(),
  heightCm: cm.nullable(),
  // Defaults to "user_confirmed" when the user enters dimensions.
  dimensionStatus: MeasurementStatusSchema,
  // Provenance for the measurement rows; defaults to "user".
  dimensionSource: z.string().trim().min(1).max(40),
  confidence: z.number().min(0).max(1).nullable(),
  sourceUploadId: z.uuid().nullable(),
  polygon: PolygonSchema.nullable(),
};

export const CreateRoomSchema = z.object({
  ...roomFields,
  roomType: roomFields.roomType.optional(),
  floorId: roomFields.floorId.optional(),
  selected: roomFields.selected.optional(),
  widthCm: roomFields.widthCm.optional(),
  lengthCm: roomFields.lengthCm.optional(),
  heightCm: roomFields.heightCm.optional(),
  dimensionStatus: roomFields.dimensionStatus.optional(),
  dimensionSource: roomFields.dimensionSource.optional(),
  confidence: roomFields.confidence.optional(),
  sourceUploadId: roomFields.sourceUploadId.optional(),
  polygon: roomFields.polygon.optional(),
});
export type CreateRoom = z.infer<typeof CreateRoomSchema>;

// Changing dimensions, status or polygon clears the room's review (FP-004).
export const UpdateRoomSchema = z.object(roomFields).partial();
export type UpdateRoom = z.infer<typeof UpdateRoomSchema>;

export const RoomSchema = z.object({
  id: z.uuid(),
  homeId: z.uuid(),
  floorId: z.uuid().nullable(),
  name: z.string(),
  roomType: z.string(),
  selected: z.boolean(),
  widthCm: z.number().nullable(),
  lengthCm: z.number().nullable(),
  heightCm: z.number().nullable(),
  dimensionStatus: MeasurementStatusSchema,
  polygon: PolygonSchema.nullable(),
  reviewedAt: isoDate.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Room = z.infer<typeof RoomSchema>;

// ---------------------------------------------------------------------------
// Architectural features
// ---------------------------------------------------------------------------

export type FeatureType = z.infer<typeof FeatureTypeSchema>;
export type Wall = z.infer<typeof WallSchema>;

const featureFields = {
  type: FeatureTypeSchema,
  wall: WallSchema.nullable(),
  offsetCm: z.number().min(0).max(10_000).nullable(),
  widthCm: cm.nullable(),
  heightCm: cm.nullable(),
  // Defaults to "user_confirmed" when any dimension is given, else "unknown".
  status: MeasurementStatusSchema,
  notes: z.string().max(500).nullable(),
};

export const CreateFeatureSchema = z.object({
  type: featureFields.type,
  wall: featureFields.wall.optional(),
  offsetCm: featureFields.offsetCm.optional(),
  widthCm: featureFields.widthCm.optional(),
  heightCm: featureFields.heightCm.optional(),
  status: featureFields.status.optional(),
  notes: featureFields.notes.optional(),
});
export type CreateFeature = z.infer<typeof CreateFeatureSchema>;

export const UpdateFeatureSchema = z.object(featureFields).partial();
export type UpdateFeature = z.infer<typeof UpdateFeatureSchema>;

export const ArchitecturalFeatureSchema = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  type: FeatureTypeSchema,
  wall: WallSchema.nullable(),
  offsetCm: z.number().nullable(),
  widthCm: z.number().nullable(),
  heightCm: z.number().nullable(),
  status: MeasurementStatusSchema,
  notes: z.string().nullable(),
  createdAt: isoDate,
});
export type ArchitecturalFeature = z.infer<typeof ArchitecturalFeatureSchema>;

// ---------------------------------------------------------------------------
// Full editable model (GET /homes/:homeId)
// ---------------------------------------------------------------------------

export const RoomDetailSchema = RoomSchema.extend({
  features: z.array(ArchitecturalFeatureSchema),
  // Latest measurement per kind ("width" | "length" | "height" | ...).
  measurements: z.record(z.string(), MeasurementSchema),
});
export type RoomDetail = z.infer<typeof RoomDetailSchema>;

export const HomeDetailSchema = z.object({
  home: HomeSchema,
  floors: z.array(FloorSchema),
  rooms: z.array(RoomDetailSchema),
  counts: z.object({
    floors: z.number().int(),
    rooms: z.number().int(),
    selectedRooms: z.number().int(),
    reviewedRooms: z.number().int(),
    features: z.number().int(),
    uploads: z.number().int(),
  }),
});
export type HomeDetail = z.infer<typeof HomeDetailSchema>;

// ---------------------------------------------------------------------------
// Home overview (GET /homes/:homeId/overview)
// ---------------------------------------------------------------------------

// known: confirmed, printed or calculated from verified scale.
export const DimensionStateSchema = z.enum(["known", "estimated", "unknown"]);
export type DimensionState = z.infer<typeof DimensionStateSchema>;

export const OverviewWarningCodeSchema = z.enum([
  "no_rooms",
  "no_rooms_selected",
  "dimensions_unknown",
  "dimensions_estimated",
  "feature_dimensions_unknown",
  "room_not_reviewed",
]);
export type OverviewWarningCode = z.infer<typeof OverviewWarningCodeSchema>;

export const OverviewWarningSchema = z.object({
  code: OverviewWarningCodeSchema,
  severity: z.enum(["info", "warning"]),
  roomId: z.uuid().nullable(),
  message: z.string(),
  // What the app should ask the user for, if anything.
  action: z.enum([
    "measure_room",
    "measure_feature",
    "review_room",
    "add_rooms",
    "select_rooms",
  ]),
});
export type OverviewWarning = z.infer<typeof OverviewWarningSchema>;

export const OverviewRoomSchema = z.object({
  id: z.uuid(),
  floorId: z.uuid().nullable(),
  name: z.string(),
  roomType: z.string(),
  selected: z.boolean(),
  widthCm: z.number().nullable(),
  lengthCm: z.number().nullable(),
  heightCm: z.number().nullable(),
  areaSqm: z.number().nullable(),
  dimensionStatus: MeasurementStatusSchema,
  dimensionState: DimensionStateSchema,
  featureCount: z.number().int(),
  reviewed: z.boolean(),
  reviewedAt: isoDate.nullable(),
  // Reviewed and with known dimensions: layouts may use it (FP-004, AC-005).
  readyForLayouts: z.boolean(),
});
export type OverviewRoom = z.infer<typeof OverviewRoomSchema>;

export const HomeOverviewSchema = z.object({
  home: HomeSchema.pick({
    id: true,
    name: true,
    journeyType: true,
    retentionState: true,
    retainUntil: true,
  }),
  floors: z.array(FloorSchema.pick({ id: true, name: true, level: true })),
  rooms: z.array(OverviewRoomSchema),
  summary: z.object({
    totalRooms: z.number().int(),
    selectedRooms: z.number().int(),
    reviewedRooms: z.number().int(),
    roomsNeedingMeasurement: z.number().int(),
    roomsReadyForLayouts: z.number().int(),
    // All selected rooms are ready (and at least one is selected).
    readyForLayouts: z.boolean(),
  }),
  warnings: z.array(OverviewWarningSchema),
});
export type HomeOverview = z.infer<typeof HomeOverviewSchema>;
