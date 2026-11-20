import { Hono } from "hono";
import { type AuthEnv, requireAuth } from "../middleware/auth";

export const homeRoutes = new Hono<AuthEnv>().use("*", requireAuth);
