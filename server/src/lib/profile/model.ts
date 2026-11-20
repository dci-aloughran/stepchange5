import type { HomeDetail } from "@stepchange/shared";
import { asc, count, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../../db/client.js";
import {
  type FeatureRow,
  type HomeRow,
  latestByKind,
  type MeasurementRow,
  toFeature,
  toFloor,
  toHome,
  toRoom,
} from "./dto.js";

export async function loadHomeParts(homeId: string) {
  const db = getDb();
  const [floors, rooms] = await Promise.all([
    db
      .select()
      .from(schema.floors)
      .where(eq(schema.floors.homeId, homeId))
      .orderBy(asc(schema.floors.level), asc(schema.floors.createdAt)),
    db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.homeId, homeId))
      .orderBy(asc(schema.rooms.createdAt)),
  ]);
  const roomIds = rooms.map((r) => r.id);
  const [features, measurements] =
    roomIds.length === 0
      ? [[] as FeatureRow[], [] as MeasurementRow[]]
      : await Promise.all([
          db
            .select()
            .from(schema.architecturalFeatures)
            .where(inArray(schema.architecturalFeatures.roomId, roomIds))
            .orderBy(asc(schema.architecturalFeatures.createdAt)),
          db
            .select()
            .from(schema.measurements)
            .where(inArray(schema.measurements.roomId, roomIds)),
        ]);
  return { floors, rooms, features, measurements };
}

export function groupBy<T, K>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k) ?? [];
    list.push(r);
    out.set(k, list);
  }
  return out;
}

// Full editable model for one (already ownership-checked) home.
export async function loadHomeDetail(home: HomeRow): Promise<HomeDetail> {
  const [parts, [uploadCount]] = await Promise.all([
    loadHomeParts(home.id),
    getDb()
      .select({ n: count() })
      .from(schema.uploads)
      .where(eq(schema.uploads.homeId, home.id)),
  ]);
  const featuresByRoom = groupBy(parts.features, (f) => f.roomId);
  const measurementsByRoom = groupBy(parts.measurements, (m) => m.roomId);
  return {
    home: toHome(home),
    floors: parts.floors.map(toFloor),
    rooms: parts.rooms.map((r) => ({
      ...toRoom(r),
      features: (featuresByRoom.get(r.id) ?? []).map(toFeature),
      measurements: latestByKind(measurementsByRoom.get(r.id) ?? []),
    })),
    counts: {
      floors: parts.floors.length,
      rooms: parts.rooms.length,
      selectedRooms: parts.rooms.filter((r) => r.selected).length,
      reviewedRooms: parts.rooms.filter((r) => r.reviewedAt !== null).length,
      features: parts.features.length,
      uploads: uploadCount?.n ?? 0,
    },
  };
}
