import type {
  Brief,
  Concept,
  InspirationItem,
  Layout,
  LayoutValidationDto,
  TasteProfile,
  Zone,
} from "@stepchange/shared";
import type { schema } from "../../db/client.js";

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];

export function briefDto(b: Row<typeof schema.functionalBriefs>): Brief {
  return {
    id: b.id,
    roomId: b.roomId,
    version: b.version,
    householdNeed: b.householdNeed,
    roomConstraints: b.roomConstraints,
    recommendedUse: b.recommendedUse,
    requirements: b.requirements,
    uncertainties: b.uncertainties,
    status: b.status,
    modelVersion: b.modelVersion,
    promptVersion: b.promptVersion,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

export function layoutDto(
  l: Row<typeof schema.layouts>,
  room: Row<typeof schema.rooms>,
): Layout {
  return {
    id: l.id,
    roomId: l.roomId,
    briefId: l.briefId,
    placements: l.placements.map((p) => ({
      ...p,
      rotationDeg: p.rotationDeg as 0 | 90 | 180 | 270,
    })),
    zones: l.zones as Zone[],
    validation: (l.validation as LayoutValidationDto | null) ?? null,
    status: l.status,
    createdAt: l.createdAt.toISOString(),
    room: {
      widthCm: room.widthCm,
      lengthCm: room.lengthCm,
      dimensionStatus: room.dimensionStatus,
    },
  };
}

export function conceptDto(c: Row<typeof schema.concepts>): Concept {
  return {
    id: c.id,
    roomId: c.roomId,
    briefId: c.briefId,
    layoutId: c.layoutId,
    vibe: c.vibe,
    tier: c.tier,
    sourceUploadId: c.sourceUploadId,
    sourcePhotoUsed: c.sourceUploadId != null,
    hasImage: c.imageBlobPathname != null,
    dimensionBasis: c.dimensionBasis,
    disclosure: c.disclosure,
    looksLikeMyRoom: c.looksLikeMyRoom,
    status: c.status,
    modelVersion: c.modelVersion,
    promptVersion: c.promptVersion,
    createdAt: c.createdAt.toISOString(),
  };
}

export function inspirationDto(
  i: Row<typeof schema.inspirationItems>,
  uploadStatus: string | null,
): InspirationItem {
  return {
    id: i.id,
    uploadId: i.uploadId,
    sourceUrl: i.sourceUrl,
    kind: i.kind,
    reaction: (["love", "dislike", "neutral"].includes(i.reaction)
      ? i.reaction
      : "neutral") as InspirationItem["reaction"],
    note: i.note,
    usableForDerivation: i.uploadId != null && uploadStatus === "available",
    createdAt: i.createdAt.toISOString(),
  };
}

export function tasteDto(t: Row<typeof schema.tasteProfiles>): TasteProfile {
  const attrs = t.attributes ?? [];
  return {
    id: t.id,
    summary: t.summary,
    attributes: attrs,
    preferredBrands: attrs
      .filter((a) => a.key.startsWith("brand."))
      .map((a) => a.value),
    preferredColours: attrs
      .filter((a) => a.key.startsWith("colour."))
      .map((a) => a.value),
    status: t.status,
    modelVersion: t.modelVersion,
    promptVersion: t.promptVersion,
    updatedAt: t.updatedAt.toISOString(),
  };
}
