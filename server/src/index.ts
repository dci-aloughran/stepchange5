import { HealthResponseSchema } from "@stepchange/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { audit } from "./lib/audit";
import { isAllowedOrigin } from "./lib/origins";
import { conceptRoutes } from "./routes/concepts";
import { homeRoutes } from "./routes/homes";
import { planRoutes } from "./routes/plans";
import { productRoutes } from "./routes/products";
import { profileRoutes } from "./routes/profile";
import { tasteRoutes } from "./routes/taste";
import { uploadRoutes } from "./routes/uploads";

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
  .route("/products", productRoutes);

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
