import { get } from "@vercel/blob";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getDb, schema } from "../../db/client.js";
import { getOrCreateHousehold, getOwnedRoom } from "../ownership.js";
import type { PossessionInput } from "./brief-checks.js";
import type { FeatureInput, NeedInput } from "./types.js";

export async function loadRoomContext(userId: string, roomId: string) {
  const db = getDb();
  const { room, home } = await getOwnedRoom(userId, roomId);
  const household = await getOrCreateHousehold(userId);
  const [features, needs, possessions, persons, selectedRooms] =
    await Promise.all([
      db
        .select()
        .from(schema.architecturalFeatures)
        .where(eq(schema.architecturalFeatures.roomId, roomId)),
      db
        .select()
        .from(schema.accessibilityNeeds)
        .where(
          and(
            eq(schema.accessibilityNeeds.householdId, household.id),
            or(
              eq(schema.accessibilityNeeds.scope, "home"),
              eq(schema.accessibilityNeeds.scope, "person"),
              and(
                eq(schema.accessibilityNeeds.scope, "room"),
                eq(schema.accessibilityNeeds.roomId, roomId),
              ),
            ),
          ),
        ),
      db
        .select()
        .from(schema.existingPossessions)
        .where(
          and(
            eq(schema.existingPossessions.householdId, household.id),
            eq(schema.existingPossessions.roomId, roomId),
            eq(schema.existingPossessions.keep, true),
          ),
        ),
      db
        .select()
        .from(schema.persons)
        .where(eq(schema.persons.householdId, household.id)),
      db
        .select({ id: schema.rooms.id })
        .from(schema.rooms)
        .where(
          and(
            eq(schema.rooms.homeId, home.id),
            eq(schema.rooms.selected, true),
          ),
        ),
    ]);

  const featureInputs: FeatureInput[] = features.map((f) => ({
    id: f.id,
    type: f.type,
    wall: f.wall,
    offsetCm: f.offsetCm,
    widthCm: f.widthCm,
    status: f.status,
  }));
  // Person-scoped needs only apply to people in this household.
  const needInputs: NeedInput[] = needs
    .filter(
      (n) => n.scope !== "person" || persons.some((p) => p.id === n.personId),
    )
    .map((n) => ({
      id: n.id,
      needType: n.needType,
      params: n.params ?? {},
      confirmed: n.confirmed,
    }));
  const possessionInputs: PossessionInput[] = possessions.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    widthCm: p.widthCm,
    depthCm: p.depthCm,
    heightCm: p.heightCm,
  }));
  const roomCount = Math.max(1, selectedRooms.length);
  const roomBudgetPence =
    household.budgetTotalPence != null
      ? Math.round(household.budgetTotalPence / roomCount)
      : null;

  return {
    room,
    home,
    household,
    persons,
    rawNeeds: needs,
    features: featureInputs,
    needs: needInputs,
    possessions: possessionInputs,
    selectedRoomCount: selectedRooms.length,
    roomBudgetPence,
  };
}

export type RoomContext = Awaited<ReturnType<typeof loadRoomContext>>;

export async function getOwnedBrief(userId: string, briefId: string) {
  const [row] = await getDb()
    .select({ brief: schema.functionalBriefs, room: schema.rooms })
    .from(schema.functionalBriefs)
    .innerJoin(
      schema.rooms,
      eq(schema.functionalBriefs.roomId, schema.rooms.id),
    )
    .innerJoin(schema.homes, eq(schema.rooms.homeId, schema.homes.id))
    .where(
      and(
        eq(schema.functionalBriefs.id, briefId),
        eq(schema.homes.userId, userId),
      ),
    );
  if (!row) throw new HTTPException(404, { message: "Not found" });
  return row;
}

export async function getOwnedLayout(userId: string, layoutId: string) {
  const [row] = await getDb()
    .select({
      layout: schema.layouts,
      room: schema.rooms,
      brief: schema.functionalBriefs,
    })
    .from(schema.layouts)
    .innerJoin(schema.rooms, eq(schema.layouts.roomId, schema.rooms.id))
    .innerJoin(schema.homes, eq(schema.rooms.homeId, schema.homes.id))
    .innerJoin(
      schema.functionalBriefs,
      eq(schema.layouts.briefId, schema.functionalBriefs.id),
    )
    .where(
      and(eq(schema.layouts.id, layoutId), eq(schema.homes.userId, userId)),
    );
  if (!row) throw new HTTPException(404, { message: "Not found" });
  return row;
}

export async function getOwnedConcept(userId: string, conceptId: string) {
  const [row] = await getDb()
    .select({ concept: schema.concepts })
    .from(schema.concepts)
    .innerJoin(schema.rooms, eq(schema.concepts.roomId, schema.rooms.id))
    .innerJoin(schema.homes, eq(schema.rooms.homeId, schema.homes.id))
    .where(
      and(eq(schema.concepts.id, conceptId), eq(schema.homes.userId, userId)),
    );
  if (!row) throw new HTTPException(404, { message: "Not found" });
  return row.concept;
}

export async function latestBriefForRoom(roomId: string, statuses?: string[]) {
  const db = getDb();
  const where = statuses
    ? and(
        eq(schema.functionalBriefs.roomId, roomId),
        inArray(
          schema.functionalBriefs.status,
          statuses as Array<"draft" | "accepted" | "edited" | "rejected">,
        ),
      )
    : eq(schema.functionalBriefs.roomId, roomId);
  const [brief] = await db
    .select()
    .from(schema.functionalBriefs)
    .where(where)
    .orderBy(desc(schema.functionalBriefs.version))
    .limit(1);
  return brief;
}

export async function latestLayoutForBrief(briefId: string) {
  const [layout] = await getDb()
    .select()
    .from(schema.layouts)
    .where(eq(schema.layouts.briefId, briefId))
    .orderBy(desc(schema.layouts.createdAt))
    .limit(1);
  return layout;
}

// An upload is only usable once the pipeline marked it available (SE-003).
export async function getUsableUpload(
  userId: string,
  uploadId: string,
  purpose: "room_photo" | "inspiration",
) {
  const [upload] = await getDb()
    .select()
    .from(schema.uploads)
    .where(
      and(
        eq(schema.uploads.id, uploadId),
        eq(schema.uploads.userId, userId),
        eq(schema.uploads.purpose, purpose),
      ),
    );
  if (!upload) throw new HTTPException(404, { message: "Upload not found" });
  return upload;
}

export const IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function readUploadBytes(upload: {
  blobPathname: string | null;
  status: string;
  detectedMime: string | null;
}): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
  if (upload.status !== "available" || !upload.blobPathname) return null;
  const mediaType = upload.detectedMime ?? "";
  if (!IMAGE_MIME.has(mediaType)) return null;
  const res = await get(upload.blobPathname, { access: "private" });
  if (!res || res.statusCode !== 200) return null;
  const bytes = new Uint8Array(await new Response(res.stream).arrayBuffer());
  return { bytes, mediaType };
}
