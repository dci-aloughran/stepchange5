import { HealthResponseSchema } from "@stepchange/shared";
import { describe, expect, it } from "vitest";
import app from "./index.js";

describe("GET /health", () => {
  it("returns a valid health response", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(HealthResponseSchema.parse(body).status).toBe("ok");
  });
});
