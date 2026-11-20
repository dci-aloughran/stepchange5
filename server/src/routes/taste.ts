import { Hono } from "hono";
import { type AuthEnv, requireAuth } from "../middleware/auth.js";

export const tasteRoutes = new Hono<AuthEnv>().use("*", requireAuth);
