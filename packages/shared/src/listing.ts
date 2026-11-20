import { z } from "zod";
import { MeasurementStatusSchema } from "./enums.js";

// Listing preview from content the user shares (screenshots and/or pasted
// listing text). We never fetch portal pages (PRD D-003); every value comes
// from what the user provided and is null when not visible.

export const ListingPropertyTypeSchema = z.enum([
  "house",
  "flat",
  "bungalow",
  "maisonette",
]);

export const ListingDetailsSchema = z.object({
  address: z.string().nullable(),
  pricePence: z.number().int().nonnegative().nullable(),
  priceQualifier: z.string().nullable(),
  tenure: z.string().nullable(),
  propertyType: ListingPropertyTypeSchema.nullable(),
  propertySubtype: z.string().nullable(),
  bedrooms: z.number().int().min(0).max(50).nullable(),
  bathrooms: z.number().int().min(0).max(50).nullable(),
  receptions: z.number().int().min(0).max(50).nullable(),
  floorAreaSqm: z.number().positive().nullable(),
  keyFeatures: z.array(z.string()),
  summary: z.string().nullable(),
  agent: z.string().nullable(),
  portal: z.string().nullable(),
});
export type ListingDetails = z.infer<typeof ListingDetailsSchema>;

export const ListingRoomSchema = z.object({
  name: z.string(),
  roomType: z.string(),
  widthCm: z.number().positive().nullable(),
  lengthCm: z.number().positive().nullable(),
  dimensionStatus: MeasurementStatusSchema,
});
export type ListingRoom = z.infer<typeof ListingRoomSchema>;

export const ListingExtractRequestSchema = z
  .object({
    uploadIds: z.array(z.uuid()).max(8).default([]),
    text: z.string().trim().max(20_000).optional(),
    url: z.url().max(2000).optional(),
  })
  .refine((v) => v.uploadIds.length > 0 || Boolean(v.text), {
    message: "Add at least one screenshot or paste the listing text",
  });
export type ListingExtractRequest = z.infer<typeof ListingExtractRequestSchema>;

export const ListingExtractResponseSchema = z.object({
  details: ListingDetailsSchema,
  rooms: z.array(ListingRoomSchema),
  photoUploadIds: z.array(z.uuid()),
  floorPlanUploadId: z.uuid().nullable(),
  missing: z.array(z.string()),
  notes: z.array(z.string()),
  sourceUrl: z.string().nullable(),
  modelVersion: z.string(),
  promptVersion: z.string(),
});
export type ListingExtractResponse = z.infer<
  typeof ListingExtractResponseSchema
>;
