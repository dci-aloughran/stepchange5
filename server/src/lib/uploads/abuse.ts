import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../../db/client.js";
import { audit } from "../audit.js";

// SE-006: repeated rejected uploads from one account trip a throttle and a
// critical audit event (the alert hook). Counter lives in rate_limits under a
// dedicated key so users cannot reset it by deleting their upload rows.

export const ABUSE_THRESHOLD = 10;
export const ABUSE_WINDOW_SECONDS = 3600;

function abuseKey(userId: string) {
  return `uploads:rejected:${userId}`;
}

function windowStart(now = Date.now()) {
  const ms = ABUSE_WINDOW_SECONDS * 1000;
  return new Date(Math.floor(now / ms) * ms);
}

/** Current rejection count for the user in this window. */
export async function rejectionCount(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: schema.rateLimits.count })
    .from(schema.rateLimits)
    .where(
      and(
        eq(schema.rateLimits.key, abuseKey(userId)),
        eq(schema.rateLimits.windowStart, windowStart()),
      ),
    );
  return row?.count ?? 0;
}

export async function isThrottledForAbuse(userId: string): Promise<boolean> {
  return (await rejectionCount(userId)) >= ABUSE_THRESHOLD;
}

/** Record a rejection; raises a critical audit event on crossing the threshold. */
export async function recordRejection(userId: string, code: string) {
  const [row] = await getDb()
    .insert(schema.rateLimits)
    .values({ key: abuseKey(userId), windowStart: windowStart(), count: 1 })
    .onConflictDoUpdate({
      target: [schema.rateLimits.key, schema.rateLimits.windowStart],
      set: { count: sql`${schema.rateLimits.count} + 1` },
    })
    .returning({ count: schema.rateLimits.count });
  const count = row?.count ?? 0;
  if (count === ABUSE_THRESHOLD) {
    await audit("upload.abuse_threshold", {
      userId,
      severity: "critical",
      payload: {
        rejections: count,
        windowSeconds: ABUSE_WINDOW_SECONDS,
        lastCode: code,
        action: "uploads_throttled",
      },
    });
  }
  return count;
}
