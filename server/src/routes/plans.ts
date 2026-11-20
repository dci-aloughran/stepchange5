import { Hono } from "hono";
import { type AuthEnv, requireAuth } from "../middleware/auth";

export const planRoutes = new Hono<AuthEnv>().use("*", requireAuth);
