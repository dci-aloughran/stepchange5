import { z } from "zod";
import { ReviewStatusSchema } from "./enums.js";

// Taste area (FR-07, FR-08, D-003). Owned by the planning slice.

export const InspirationReactionSchema = z.enum(["love", "dislike", "neutral"]);
export type InspirationReaction = z.infer<typeof InspirationReactionSchema>;

// Board/post links are stored as references only and are never fetched or
// scraped (D-003).
export const InspirationKindSchema = z.enum([
  "image",
  "pinterest",
  "instagram",
  "link",
]);
export type InspirationKind = z.infer<typeof InspirationKindSchema>;

export const InspirationCreateSchema = z
  .object({
    uploadId: z.uuid().optional(),
    sourceUrl: z
      .url({ protocol: /^https?$/ })
      .max(2048)
      .optional(),
    reaction: InspirationReactionSchema.default("love"),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => Boolean(v.uploadId) !== Boolean(v.sourceUrl), {
    message: "Provide exactly one of uploadId or sourceUrl",
  });
export type InspirationCreate = z.infer<typeof InspirationCreateSchema>;

export const InspirationUpdateSchema = z
  .object({
    reaction: InspirationReactionSchema.optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => v.reaction !== undefined || v.note !== undefined, {
    message: "Nothing to update",
  });
export type InspirationUpdate = z.infer<typeof InspirationUpdateSchema>;

export const InspirationItemSchema = z.object({
  id: z.uuid(),
  uploadId: z.uuid().nullable(),
  sourceUrl: z.string().nullable(),
  kind: z.string(),
  reaction: InspirationReactionSchema,
  note: z.string().nullable(),
  // Only true when the referenced upload passed the upload pipeline.
  usableForDerivation: z.boolean(),
  createdAt: z.string(),
});
export type InspirationItem = z.infer<typeof InspirationItemSchema>;

// Attribute key convention: "<category>.<slug>", e.g. "material.natural-oak".
// Categories prefixed "avoid" capture dislikes; "brand" and "colour" capture
// explicit user preferences supplied as profile input.
export const TasteCategorySchema = z.enum([
  "style",
  "palette",
  "material",
  "texture",
  "form",
  "accent",
  "light",
  "clutter",
  "pattern",
  "mood",
  "avoid",
  "brand",
  "colour",
]);
export type TasteCategory = z.infer<typeof TasteCategorySchema>;

export const TasteAttributeSchema = z.object({
  key: z.string().min(1).max(120),
  label: z.string().min(1).max(80),
  value: z.string().min(1).max(160),
  confidence: z.number().min(0).max(1),
  userEdited: z.boolean(),
});
export type TasteAttributeDto = z.infer<typeof TasteAttributeSchema>;

export const TasteAttributeInputSchema = z.object({
  // Omit key for a brand-new attribute; the server derives one.
  key: z.string().min(1).max(120).optional(),
  label: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(160),
  confidence: z.number().min(0).max(1).optional(),
});
export type TasteAttributeInput = z.infer<typeof TasteAttributeInputSchema>;

const BrandListSchema = z.array(z.string().trim().min(1).max(80)).max(20);

export const TasteDeriveRequestSchema = z.object({
  preferredBrands: BrandListSchema.optional(),
  preferredColours: BrandListSchema.optional(),
  // Free-text description used alongside (or instead of) images.
  description: z.string().trim().max(1000).optional(),
});
export type TasteDeriveRequest = z.infer<typeof TasteDeriveRequestSchema>;

export const TasteProfileUpdateSchema = z.object({
  summary: z.string().trim().max(1000).optional(),
  // Full replacement list: attributes omitted here are removed.
  attributes: z.array(TasteAttributeInputSchema).max(60).optional(),
  preferredBrands: BrandListSchema.optional(),
  preferredColours: BrandListSchema.optional(),
  // Defaults to "edited" when anything changed, otherwise "accepted".
  status: z.enum(["accepted", "edited", "rejected"]).optional(),
});
export type TasteProfileUpdate = z.infer<typeof TasteProfileUpdateSchema>;

export const TasteProfileSchema = z.object({
  id: z.uuid(),
  summary: z.string(),
  attributes: z.array(TasteAttributeSchema),
  preferredBrands: z.array(z.string()),
  preferredColours: z.array(z.string()),
  status: ReviewStatusSchema,
  modelVersion: z.string().nullable(),
  promptVersion: z.string().nullable(),
  updatedAt: z.string(),
});
export type TasteProfile = z.infer<typeof TasteProfileSchema>;

export const TasteDerivationBasisSchema = z.object({
  imageCount: z.number().int(),
  skippedImageCount: z.number().int(),
  linkCount: z.number().int(),
  textOnly: z.boolean(),
  message: z.string(),
});
export type TasteDerivationBasis = z.infer<typeof TasteDerivationBasisSchema>;

export const TasteProfileResponseSchema = z.object({
  profile: TasteProfileSchema.nullable(),
});

export const TasteDeriveResponseSchema = z.object({
  profile: TasteProfileSchema,
  basis: TasteDerivationBasisSchema,
});
export type TasteDeriveResponse = z.infer<typeof TasteDeriveResponseSchema>;
