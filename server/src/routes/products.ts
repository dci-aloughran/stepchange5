import { Hono } from "hono";
import { type AuthEnv, requireAuth } from "../middleware/auth.js";

export const productRoutes = new Hono<AuthEnv>().use("*", requireAuth);
