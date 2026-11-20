import { Hono } from "hono";
import { audit } from "../lib/audit.js";
import { cleanupRateLimits } from "../lib/guards.js";
import { checkCronAuth } from "../lib/ops/cron-auth.js";
import { runRetention } from "../lib/ops/retention.js";
import {
  UCP_AGENT_PROFILE_BODY,
  UCP_AGENT_PROFILE_CACHE_CONTROL,
  UCP_AGENT_PROFILE_ETAG,
} from "../lib/ops/ucp-profile.js";

// Operational endpoints that are not called by signed-in users, so there is
// no requireAuth here: the cron route checks CRON_SECRET itself and the UCP
// profile is a public document.
export const internalRoutes = new Hono()
  // ---- Retention job (SE-011, SE-012), scheduled in vercel.json -------------
  .get("/cron/retention", async (c) => {
    const auth = checkCronAuth(
      c.req.header("authorization"),
      process.env.CRON_SECRET,
    );
    if (auth === "not_configured") {
      return c.json({ error: "Cron is not configured" }, 503);
    }
    if (auth === "unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // ?dryRun=1 reports what would be deleted without deleting anything.
    const dryRun = c.req.query("dryRun") === "1";
    const startedAt = Date.now();
    const retention = await runRetention(new Date(), { dryRun });
    let rateLimitsCleaned = false;
    if (!dryRun) {
      await cleanupRateLimits();
      rateLimitsCleaned = true;
    }
    const summary = {
      dryRun,
      homesDeleted: retention.homesDeleted,
      blobsDeleted: retention.blobsDeleted,
      byState: retention.byState,
      truncated: retention.truncated,
      rateLimitsCleaned,
      durationMs: Date.now() - startedAt,
    };
    // Home ids are not personal data; they let support trace a deletion.
    await audit(dryRun ? "retention.dry_run" : "retention.homes_deleted", {
      severity: retention.truncated ? "warn" : "info",
      payload: { ...summary, homeIds: retention.homeIds.slice(0, 500) },
    });
    c.header("Cache-Control", "no-store");
    return c.json({ ok: true, ...summary });
  })

  // ---- Shopify UCP agent profile (FR-20) ------------------------------------
  .get("/ucp/agent-profile.json", (c) => {
    c.header("Cache-Control", UCP_AGENT_PROFILE_CACHE_CONTROL);
    c.header("ETag", UCP_AGENT_PROFILE_ETAG);
    if (c.req.header("if-none-match") === UCP_AGENT_PROFILE_ETAG) {
      return c.body(null, 304);
    }
    c.header("Content-Type", "application/json; charset=utf-8");
    return c.body(UCP_AGENT_PROFILE_BODY, 200);
  });
