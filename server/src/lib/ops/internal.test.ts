import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkCronAuth } from "./cron-auth.js";
import { UCP_AGENT_PROFILE } from "./ucp-profile.js";

const mocks = vi.hoisted(() => ({
  runRetention: vi.fn(),
  cleanupRateLimits: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("./retention.js", () => ({ runRetention: mocks.runRetention }));
vi.mock("../guards.js", () => ({
  cleanupRateLimits: mocks.cleanupRateLimits,
}));
vi.mock("../audit.js", () => ({ audit: mocks.audit, track: vi.fn() }));

const { internalRoutes } = await import("../../routes/internal.js");
const { default: app } = await import("../../index.js");

describe("checkCronAuth", () => {
  it("is disabled when no secret is configured", () => {
    expect(checkCronAuth("Bearer x", undefined)).toBe("not_configured");
    expect(checkCronAuth("Bearer ", "")).toBe("not_configured");
  });
  it("requires the exact bearer secret", () => {
    expect(checkCronAuth(undefined, "s3cret")).toBe("unauthorized");
    expect(checkCronAuth("s3cret", "s3cret")).toBe("unauthorized");
    expect(checkCronAuth("Bearer s3cre", "s3cret")).toBe("unauthorized");
    expect(checkCronAuth("Bearer s3cret", "s3cret")).toBe("ok");
  });
});

describe("GET /internal/cron/retention", () => {
  const run = (auth?: string, query = "") =>
    app.request(`/internal/cron/retention${query}`, {
      headers: auth ? { Authorization: auth } : {},
    });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runRetention.mockResolvedValue({
      dryRun: false,
      homesDeleted: 2,
      blobsDeleted: 3,
      byState: { buyer_active: 1, purchase_not_proceeding: 1 },
      homeIds: ["h1", "h2"],
      truncated: false,
    });
    mocks.cleanupRateLimits.mockResolvedValue(undefined);
    mocks.audit.mockResolvedValue(undefined);
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("returns 503 when CRON_SECRET is unset", async () => {
    const res = await run("Bearer anything");
    expect(res.status).toBe(503);
    expect(mocks.runRetention).not.toHaveBeenCalled();
  });

  it("returns 401 without the right secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect((await run()).status).toBe(401);
    expect((await run("Bearer wrong")).status).toBe(401);
    expect(mocks.runRetention).not.toHaveBeenCalled();
  });

  it("runs retention, cleans rate limits and audits the counts", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await run("Bearer s3cret");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      dryRun: false,
      homesDeleted: 2,
      blobsDeleted: 3,
      rateLimitsCleaned: true,
    });
    expect(mocks.runRetention).toHaveBeenCalledWith(expect.any(Date), {
      dryRun: false,
    });
    expect(mocks.cleanupRateLimits).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith(
      "retention.homes_deleted",
      expect.objectContaining({
        payload: expect.objectContaining({
          homesDeleted: 2,
          homeIds: ["h1", "h2"],
        }),
      }),
    );
  });

  it("supports a dry run that deletes nothing", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await run("Bearer s3cret", "?dryRun=1");
    expect(res.status).toBe(200);
    expect(mocks.runRetention).toHaveBeenCalledWith(expect.any(Date), {
      dryRun: true,
    });
    expect(mocks.cleanupRateLimits).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(
      "retention.dry_run",
      expect.anything(),
    );
  });
});

describe("GET /internal/ucp/agent-profile.json", () => {
  type Entry = Record<string, unknown>;
  type Profile = {
    ucp: {
      version: string;
      services: Record<string, Entry[]>;
      capabilities: Record<string, Entry[]>;
      payment_handlers: Record<string, unknown>;
    };
  };
  const example: Profile = JSON.parse(
    readFileSync(
      new URL(
        "./__fixtures__/shopify-valid-with-capabilities.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const ours = UCP_AGENT_PROFILE as Profile;

  it("is public, cacheable and served without auth", async () => {
    const res = await internalRoutes.request("/ucp/agent-profile.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    const cc = res.headers.get("cache-control") ?? "";
    expect(cc).toMatch(/\bpublic\b/);
    expect(Number(/max-age=(\d+)/.exec(cc)?.[1])).toBeGreaterThanOrEqual(60);
    expect(cc).not.toMatch(/private|no-store|no-cache/);
    expect(res.headers.get("etag")).toBeTruthy();
    expect(await res.json()).toEqual(UCP_AGENT_PROFILE);
  });

  it("is mounted on the app and answers conditional requests", async () => {
    const first = await app.request("/internal/ucp/agent-profile.json");
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag") ?? "";
    const again = await app.request("/internal/ucp/agent-profile.json", {
      headers: { "If-None-Match": etag },
    });
    expect(again.status).toBe(304);
  });

  it("matches the structure of Shopify's valid example profile", () => {
    expect(Object.keys(ours)).toEqual(["ucp"]);
    expect(Object.keys(ours.ucp).sort()).toEqual(
      Object.keys(example.ucp).sort(),
    );
    expect(ours.ucp.version).toBe(example.ucp.version);
    expect(ours.ucp.payment_handlers).toEqual({});
    expect(ours.ucp.services["dev.ucp.shopping"]).toEqual(
      example.ucp.services["dev.ucp.shopping"],
    );
  });

  it("declares exactly the catalogue capabilities the connector uses", () => {
    const names = [
      "dev.ucp.shopping.catalog.search",
      "dev.ucp.shopping.catalog.lookup",
      "dev.shopify.catalog.global",
      "dev.shopify.catalog",
    ];
    expect(Object.keys(ours.ucp.capabilities).sort()).toEqual(names.sort());
    for (const name of names) {
      const entries = ours.ucp.capabilities[name] ?? [];
      // Each entry is identical to Shopify's example entry for that name.
      expect(entries).toEqual(example.ucp.capabilities[name]);
      for (const e of entries) {
        expect(e).toMatchObject({
          version: expect.any(String),
          spec: expect.stringMatching(/^https:\/\//),
          schema: expect.stringMatching(/^https:\/\//),
        });
      }
    }
    // Extensions only reference capabilities we also declare (otherwise
    // they would be pruned during negotiation).
    for (const entries of Object.values(ours.ucp.capabilities)) {
      for (const parent of (entries[0]?.extends as string[] | undefined) ??
        []) {
        expect(names).toContain(parent);
      }
    }
  });

  it("stays well under the profile size limits", () => {
    expect(JSON.stringify(ours).length).toBeLessThan(5 * 1024);
  });
});
