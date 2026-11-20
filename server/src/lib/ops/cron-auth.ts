import { createHash, timingSafeEqual } from "node:crypto";

export type CronAuthResult = "ok" | "unauthorized" | "not_configured";

const digest = (v: string) => createHash("sha256").update(v).digest();

// Vercel Cron calls the path with `Authorization: Bearer ${CRON_SECRET}`.
// Without a configured secret the job is disabled rather than left open.
export function checkCronAuth(
  header: string | undefined,
  secret: string | undefined,
): CronAuthResult {
  if (!secret) return "not_configured";
  if (!header) return "unauthorized";
  // Compare fixed-length digests so timing doesn't leak the secret length.
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`))
    ? "ok"
    : "unauthorized";
}
