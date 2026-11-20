import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowedOrigin } from "./origins.js";

describe("isAllowedOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts configured, preview and (dev instance) localhost origins", () => {
    vi.stubEnv("APP_ORIGIN", "https://stepchange5.vercel.app");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_x");
    expect(isAllowedOrigin("https://stepchange5.vercel.app")).toBe(true);
    expect(
      isAllowedOrigin(
        "https://stepchange5-abc123-step-change-team-5.vercel.app",
      ),
    ).toBe(true);
    expect(isAllowedOrigin("http://localhost:3002")).toBe(true);
  });

  it("rejects other origins, and localhost on a production Clerk instance", () => {
    vi.stubEnv("APP_ORIGIN", "https://stepchange5.vercel.app");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_live_x");
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
    expect(isAllowedOrigin("https://stepchange5.vercel.app.evil.com")).toBe(
      false,
    );
    expect(isAllowedOrigin("http://localhost:3002")).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(false);
  });
});
