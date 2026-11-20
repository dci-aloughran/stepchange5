import type { DataExport } from "@stepchange/shared";
import { eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getDb, schema } from "../../db/client.js";
import {
  toAccessibilityNeed,
  toHousehold,
  toPerson,
  toPossession,
  toUserProfile,
} from "./dto.js";
import { groupBy } from "./model.js";

type Row = Record<string, unknown>;

// Internal storage locations are not part of the user's data.
export function omitKeys<T extends Row, K extends keyof T>(
  row: T,
  keys: K[],
): Omit<T, K> {
  const out: Row = { ...row };
  for (const k of keys) delete out[k as string];
  return out as Omit<T, K>;
}

// Plain JSON (Dates -> ISO strings) so the export is self-describing.
const plain = <T>(v: T): Row => JSON.parse(JSON.stringify(v));

export function exportFilename(now: Date) {
  return `deloitful-home-export-${now.toISOString().slice(0, 10)}.json`;
}

// SE-008: everything the user owns, in one document.
export async function buildExport(
  userId: string,
  now: Date,
): Promise<DataExport> {
  const db = getDb();
  const [[user], [household], homes, uploads, inspiration, [taste]] =
    await Promise.all([
      db.select().from(schema.users).where(eq(schema.users.id, userId)),
      db
        .select()
        .from(schema.households)
        .where(eq(schema.households.userId, userId)),
      db.select().from(schema.homes).where(eq(schema.homes.userId, userId)),
      db.select().from(schema.uploads).where(eq(schema.uploads.userId, userId)),
      db
        .select()
        .from(schema.inspirationItems)
        .where(eq(schema.inspirationItems.userId, userId)),
      db
        .select()
        .from(schema.tasteProfiles)
        .where(eq(schema.tasteProfiles.userId, userId)),
    ]);
  if (!user) throw new HTTPException(404, { message: "Not found" });

  const [persons, needs, possessions] = household
    ? await Promise.all([
        db
          .select()
          .from(schema.persons)
          .where(eq(schema.persons.householdId, household.id)),
        db
          .select()
          .from(schema.accessibilityNeeds)
          .where(eq(schema.accessibilityNeeds.householdId, household.id)),
        db
          .select()
          .from(schema.existingPossessions)
          .where(eq(schema.existingPossessions.householdId, household.id)),
      ])
    : [[], [], []];

  const homeIds = homes.map((h) => h.id);
  const [floors, rooms] =
    homeIds.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select()
            .from(schema.floors)
            .where(inArray(schema.floors.homeId, homeIds)),
          db
            .select()
            .from(schema.rooms)
            .where(inArray(schema.rooms.homeId, homeIds)),
        ]);

  const roomIds = rooms.map((r) => r.id);
  const [features, measurements, briefs, layouts, concepts, recs] =
    roomIds.length === 0
      ? [[], [], [], [], [], []]
      : await Promise.all([
          db
            .select()
            .from(schema.architecturalFeatures)
            .where(inArray(schema.architecturalFeatures.roomId, roomIds)),
          db
            .select()
            .from(schema.measurements)
            .where(inArray(schema.measurements.roomId, roomIds)),
          db
            .select()
            .from(schema.functionalBriefs)
            .where(inArray(schema.functionalBriefs.roomId, roomIds)),
          db
            .select()
            .from(schema.layouts)
            .where(inArray(schema.layouts.roomId, roomIds)),
          db
            .select()
            .from(schema.concepts)
            .where(inArray(schema.concepts.roomId, roomIds)),
          db
            .select({
              recommendation: schema.recommendations,
              product: schema.products,
            })
            .from(schema.recommendations)
            .innerJoin(
              schema.products,
              eq(schema.recommendations.productId, schema.products.id),
            )
            .where(inArray(schema.recommendations.roomId, roomIds)),
        ]);

  const floorsByHome = groupBy(floors, (f) => f.homeId);
  const roomsByHome = groupBy(rooms, (r) => r.homeId);
  const featuresByRoom = groupBy(features, (f) => f.roomId);
  const measurementsByRoom = groupBy(measurements, (m) => m.roomId);

  return {
    format: "deloitful-home-export",
    version: 1,
    exportedAt: now.toISOString(),
    user: toUserProfile(user),
    household: household ? toHousehold(household) : null,
    persons: persons.map(toPerson),
    accessibilityNeeds: needs.map(toAccessibilityNeed),
    possessions: possessions.map(toPossession),
    homes: homes.map((h) => ({
      ...plain(h),
      floors: (floorsByHome.get(h.id) ?? []).map(plain),
      rooms: (roomsByHome.get(h.id) ?? []).map((r) => ({
        ...plain(r),
        features: (featuresByRoom.get(r.id) ?? []).map(plain),
        measurements: (measurementsByRoom.get(r.id) ?? []).map(plain),
      })),
    })),
    uploads: uploads.map((u) => plain(omitKeys(u, ["blobPathname"]))),
    inspiration: inspiration.map(plain),
    tasteProfile: taste ? plain(taste) : null,
    briefs: briefs.map(plain),
    layouts: layouts.map(plain),
    concepts: concepts.map((c) => ({
      ...plain(omitKeys(c, ["imageBlobPathname"])),
      hasImage: c.imageBlobPathname !== null,
    })),
    recommendations: recs.map(({ recommendation, product }) => ({
      ...plain(recommendation),
      product: plain(product),
    })),
  };
}
