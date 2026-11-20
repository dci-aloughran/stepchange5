import { Hono } from "hono";
import { type AuthEnv, requireAuth } from "../middleware/auth";

export const profileRoutes = new Hono<AuthEnv>().use("*", requireAuth);
