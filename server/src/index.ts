import { HealthResponseSchema } from "@stepchange/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { audit } from "./lib/audit.js";
import { isAllowedOrigin } from "./lib/origins.js";
import { conceptRoutes } from "./routes/concepts.js";
import { homeRoutes } from "./routes/homes.js";
import { internalRoutes } from "./routes/internal.js";
import { planRoutes } from "./routes/plans.js";
import { productRoutes } from "./routes/products.js";
import { profileRoutes } from "./routes/profile.js";
import { tasteRoutes } from "./routes/taste.js";
import { uploadRoutes } from "./routes/uploads.js";

const app = new Hono()
  .use("*", secureHeaders())
  .use(
    "*",
    cors({
      origin: (origin) => (isAllowedOrigin(origin) ? origin : null),
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  )
  .get("/", (c) => c.json({ service: "deloitful-home-server" }))
  .get("/health", (c) => {
    const body = HealthResponseSchema.parse({
      status: "ok",
      service: "stepchange-server",
      version: "0.1.0",
      time: new Date().toISOString(),
    });
    return c.json(body);
  })
  .route("/profile", profileRoutes)
  .route("/homes", homeRoutes)
  .route("/uploads", uploadRoutes)
  .route("/taste", tasteRoutes)
  .route("/plans", planRoutes)
  .route("/concepts", conceptRoutes)
  .route("/products", productRoutes)
  .route("/internal", internalRoutes);

app.onError(async (err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error(err);
  await audit("server.unhandled_error", {
    severity: "warn",
    payload: { path: c.req.path, message: String(err) },
  }).catch(() => {});
  return c.json({ error: "Something went wrong. Please try again." }, 500);
});

export type AppType = typeof app;
export default app;
