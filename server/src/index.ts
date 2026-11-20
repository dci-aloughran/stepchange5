import { HealthResponseSchema } from "@stepchange/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";

const APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3000";

const app = new Hono()
  .use("*", cors({ origin: APP_ORIGIN }))
  .get("/health", (c) => {
    const body = HealthResponseSchema.parse({
      status: "ok",
      service: "stepchange-server",
      version: "0.0.0",
      time: new Date().toISOString(),
    });
    return c.json(body);
  });

export type AppType = typeof app;
export default app;
