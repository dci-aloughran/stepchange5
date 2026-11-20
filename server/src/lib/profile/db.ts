import { del } from "@vercel/blob";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getDb, schema } from "../../db/client.js";
import { track } from "../audit.js";
import { getOwnedHome, getOwnedRoom } from "../ownership.js";

// SE-009 helpers for nested resources, blob clean-up and best-effort
// analytics used by the profile and home routes.

export async function getOwnedRoomInHome(
  userId: string,
  homeId: string,
  roomId: string,
) {
  const { room, home } = await getOwnedRoom(userId, roomId);
  if (room.homeId !== homeId) {
    throw new HTTPException(404, { message: "Not found" });
  }
  return { room, home };
}

// Optional room link (e.g. possessions, accessibility): must be the user's.
export async function assertOwnedRoom(userId: string, roomId: string | null) {
  if (roomId) await getOwnedRoom(userId, roomId);
}

export async function assertOwnedPerson(
  householdId: string,
  personId: string | null,
) {
  if (!personId) return;
  const [row] = await getDb()
    .select({ id: schema.persons.id })
    .from(schema.persons)
    .where(
      and(
        eq(schema.persons.id, personId),
        eq(schema.persons.householdId, householdId),
      ),
    );
  if (!row) throw new HTTPException(404, { message: "Not found" });
}

export async function assertFloorInHome(
  homeId: string,
  floorId: string | null | undefined,
) {
  if (!floorId) return;
  const [row] = await getDb()
    .select({ id: schema.floors.id })
    .from(schema.floors)
    .where(
      and(eq(schema.floors.id, floorId), eq(schema.floors.homeId, homeId)),
    );
  if (!row) throw new HTTPException(400, { message: "floorId: Unknown floor" });
}

export { getOwnedHome };

// Analytics must never break a user request.
export async function safeTrack(...args: Parameters<typeof track>) {
  await track(...args).catch((err) => {
    console.error("analytics failed", err);
  });
}

const BLOB_BATCH = 100;

// Deletes private blobs. Throws (fail closed) if the Blob API errors so the
// caller does not drop the DB rows that reference them.
export async function deleteBlobs(pathnames: Array<string | null>) {
  const list = [...new Set(pathnames.filter((p): p is string => !!p))];
  if (list.length === 0) return 0;
  try {
    for (let i = 0; i < list.length; i += BLOB_BATCH) {
      await del(list.slice(i, i + BLOB_BATCH));
    }
  } catch (err) {
    console.error("blob delete failed", err);
    throw new HTTPException(502, {
      message: "We couldn't delete your files just now. Please try again.",
    });
  }
  return list.length;
}

export async function blobPathsForRooms(roomIds: string[]) {
  if (roomIds.length === 0) return [];
  const rows = await getDb()
    .select({ p: schema.concepts.imageBlobPathname })
    .from(schema.concepts)
    .where(
      and(
        inArray(schema.concepts.roomId, roomIds),
        isNotNull(schema.concepts.imageBlobPathname),
      ),
    );
  return rows.map((r) => r.p);
}

export async function blobPathsForHome(userId: string, homeId: string) {
  const db = getDb();
  const [uploads, roomRows] = await Promise.all([
    db
      .select({ p: schema.uploads.blobPathname })
      .from(schema.uploads)
      .where(
        and(
          eq(schema.uploads.homeId, homeId),
          eq(schema.uploads.userId, userId),
        ),
      ),
    db
      .select({ id: schema.rooms.id })
      .from(schema.rooms)
      .where(eq(schema.rooms.homeId, homeId)),
  ]);
  const concepts = await blobPathsForRooms(roomRows.map((r) => r.id));
  return [...uploads.map((u) => u.p), ...concepts];
}
