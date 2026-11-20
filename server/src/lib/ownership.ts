import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getDb, schema } from "../db/client";

// SE-009: every home-scoped read/write must go through these checks.
export async function getOwnedHome(userId: string, homeId: string) {
  const [home] = await getDb()
    .select()
    .from(schema.homes)
    .where(and(eq(schema.homes.id, homeId), eq(schema.homes.userId, userId)));
  if (!home) throw new HTTPException(404, { message: "Not found" });
  return home;
}

export async function getOwnedRoom(userId: string, roomId: string) {
  const [row] = await getDb()
    .select({ room: schema.rooms, home: schema.homes })
    .from(schema.rooms)
    .innerJoin(schema.homes, eq(schema.rooms.homeId, schema.homes.id))
    .where(and(eq(schema.rooms.id, roomId), eq(schema.homes.userId, userId)));
  if (!row) throw new HTTPException(404, { message: "Not found" });
  return row;
}

export async function getOrCreateHousehold(userId: string) {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.households)
    .where(eq(schema.households.userId, userId));
  if (existing) return existing;
  const [created] = await db
    .insert(schema.households)
    .values({ userId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await db
    .select()
    .from(schema.households)
    .where(eq(schema.households.userId, userId));
  if (!again) throw new Error("household creation failed");
  return again;
}
