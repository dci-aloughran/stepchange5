import { Hono } from "hono";
import { type AuthEnv, requireAuth } from "../middleware/auth";

export const productRoutes = new Hono<AuthEnv>().use("*", requireAuth);
