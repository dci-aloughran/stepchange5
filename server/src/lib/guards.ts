import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getDb, schema } from "../db/client";

export const KILL_SWITCHES = {
  uploads: "uploads",
  parser: "parser",
  ai: "ai",
  shopify: "connector:shopify",
} as const;

// SE-006 / FR-28. Env var KILL_<KEY> also trips the switch for emergencies.
export async function isKilled(key: string): Promise<boolean> {
  const envKey = `KILL_${key.replace(/[^a-z0-9]/gi, "_").toUpperCase()}`;
  if (process.env[envKey] === "1") return true;
  const [row] = await getDb()
    .select({ enabled: schema.killSwitches.enabled })
    .from(schema.killSwitches)
    .where(eq(schema.killSwitches.key, key));
  return row?.enabled ?? false;
}

export async function assertNotKilled(key: string) {
  if (await isKilled(key)) {
    throw new HTTPException(503, {
      message: "This feature is temporarily unavailable. Please try later.",
    });
  }
}

// Fixed-window counter in Postgres. Returns false when over the limit.
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const windowStart = new Date(
    Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000,
  );
  const [row] = await getDb()
    .insert(schema.rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [schema.rateLimits.key, schema.rateLimits.windowStart],
      set: { count: sql`${schema.rateLimits.count} + 1` },
    })
    .returning({ count: schema.rateLimits.count });
  return (row?.count ?? 0) <= limit;
}

export async function assertRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
) {
  if (!(await rateLimit(key, limit, windowSeconds))) {
    throw new HTTPException(429, { message: "Too many requests" });
  }
}

export async function cleanupRateLimits() {
  await getDb()
    .delete(schema.rateLimits)
    .where(
      and(sql`${schema.rateLimits.windowStart} < now() - interval '1 day'`),
    );
}
