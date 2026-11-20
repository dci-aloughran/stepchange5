import type { RetentionState } from "@stepchange/shared";
import { and, inArray, isNotNull, lte } from "drizzle-orm";
import { getDb, schema } from "../../db/client.js";
import { blobPathsForRooms, deleteBlobs } from "../profile/db.js";

// SE-011 / SE-012: buyer homes are kept for 180 days, or 30 days once the
// purchase is not proceeding; afterwards the scheduled job deletes them.

// Only these states carry an expiry. Homeowner ("active") homes are never
// deleted by the job, even if a stray retainUntil were set.
export const EXPIRING_STATES = [
  "buyer_active",
  "purchase_not_proceeding",
] as const satisfies readonly RetentionState[];

export type RetentionCandidate = {
  id: string;
  retentionState: string;
  retainUntil: Date | null;
};

export function isExpired(home: RetentionCandidate, now: Date): boolean {
  return (
    home.retainUntil !== null &&
    home.retainUntil.getTime() <= now.getTime() &&
    (EXPIRING_STATES as readonly string[]).includes(home.retentionState)
  );
}

export function selectExpired<T extends RetentionCandidate>(
  homes: T[],
  now: Date,
): T[] {
  return homes.filter((h) => isExpired(h, now));
}

export function countByState(homes: Array<{ retentionState: string }>) {
  const counts: Record<string, number> = {};
  for (const h of homes) {
    counts[h.retentionState] = (counts[h.retentionState] ?? 0) + 1;
  }
  return counts;
}

const BATCH = 100;
const MAX_BATCHES = 20;

export type RetentionRunResult = {
  dryRun: boolean;
  homesDeleted: number;
  blobsDeleted: number;
  byState: Record<string, number>;
  homeIds: string[];
  truncated: boolean;
};

function expiredWhere(now: Date) {
  return and(
    isNotNull(schema.homes.retainUntil),
    lte(schema.homes.retainUntil, now),
    inArray(schema.homes.retentionState, [...EXPIRING_STATES]),
  );
}

async function findExpired(now: Date, limit: number) {
  const rows = await getDb()
    .select({
      id: schema.homes.id,
      retentionState: schema.homes.retentionState,
      retainUntil: schema.homes.retainUntil,
    })
    .from(schema.homes)
    .where(expiredWhere(now))
    .limit(limit);
  // Re-check in code so a query mistake can never widen the deletion.
  return selectExpired(rows, now);
}

async function blobPathsForHomes(homeIds: string[]) {
  const db = getDb();
  const [uploads, rooms] = await Promise.all([
    db
      .select({ p: schema.uploads.blobPathname })
      .from(schema.uploads)
      .where(inArray(schema.uploads.homeId, homeIds)),
    db
      .select({ id: schema.rooms.id })
      .from(schema.rooms)
      .where(inArray(schema.rooms.homeId, homeIds)),
  ]);
  const concepts = await blobPathsForRooms(rooms.map((r) => r.id));
  return [...uploads.map((u) => u.p), ...concepts];
}

// Deletes expired homes in batches: private blobs first (fail closed, so a
// Blob API error stops the run before any row is dropped), then the home
// rows, which cascade to floors, rooms, uploads, layouts and concepts.
export async function runRetention(
  now: Date,
  { dryRun = false } = {},
): Promise<RetentionRunResult> {
  const result: RetentionRunResult = {
    dryRun,
    homesDeleted: 0,
    blobsDeleted: 0,
    byState: {},
    homeIds: [],
    truncated: false,
  };
  if (dryRun) {
    const homes = await findExpired(now, BATCH * MAX_BATCHES + 1);
    result.truncated = homes.length > BATCH * MAX_BATCHES;
    const counted = homes.slice(0, BATCH * MAX_BATCHES);
    result.homesDeleted = counted.length;
    result.byState = countByState(counted);
    result.homeIds = counted.map((h) => h.id);
    return result;
  }

  for (let i = 0; i < MAX_BATCHES; i++) {
    const homes = await findExpired(now, BATCH);
    if (homes.length === 0) return result;
    const ids = homes.map((h) => h.id);
    result.blobsDeleted += await deleteBlobs(await blobPathsForHomes(ids));
    const deleted = await getDb()
      .delete(schema.homes)
      .where(and(inArray(schema.homes.id, ids), expiredWhere(now)))
      .returning({
        id: schema.homes.id,
        retentionState: schema.homes.retentionState,
      });
    result.homesDeleted += deleted.length;
    result.homeIds.push(...deleted.map((h) => h.id));
    for (const [state, n] of Object.entries(countByState(deleted))) {
      result.byState[state] = (result.byState[state] ?? 0) + n;
    }
    if (homes.length < BATCH) return result;
  }
  result.truncated = true;
  return result;
}
