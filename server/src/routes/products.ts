import { zValidator } from "@hono/zod-validator";
import {
  RecommendRoomRequestSchema,
  RefreshRecommendationRequestSchema,
  SwapRecommendationRequestSchema,
  UpdateRecommendationRequestSchema,
} from "@stepchange/shared";
import { Hono } from "hono";
import { z } from "zod";
import {
  homeBudget,
  recommendRoom,
  refreshRecommendation,
  roomRecommendations,
  swapRecommendation,
  updateRecommendation,
} from "../lib/catalogue/service.js";
import { assertRateLimit } from "../lib/guards.js";
import { type AuthEnv, requireAuth } from "../middleware/auth.js";

const RoomParam = z.object({ roomId: z.string().uuid() });
const IdParam = z.object({ id: z.string().uuid() });
const HomeParam = z.object({ homeId: z.string().uuid() });

export const productRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  // FR-13: recommend products for each open requirement of the room brief.
  .post(
    "/rooms/:roomId/recommend",
    zValidator("param", RoomParam),
    zValidator("json", RecommendRoomRequestSchema),
    async (c) => {
      const userId = c.get("userId");
      await assertRateLimit(`products:recommend:${userId}`, 30, 3600);
      const { roomId } = c.req.valid("param");
      const body = c.req.valid("json");
      return c.json(await recommendRoom(userId, roomId, body));
    },
  )
  // Current active recommendations grouped by requirement (FR-22 labels).
  .get("/rooms/:roomId", zValidator("param", RoomParam), async (c) => {
    const { roomId } = c.req.valid("param");
    return c.json(await roomRecommendations(c.get("userId"), roomId));
  })
  // FR-14: replace a single recommendation.
  .post(
    "/recommendations/:id/swap",
    zValidator("param", IdParam),
    zValidator("json", SwapRecommendationRequestSchema),
    async (c) => {
      const userId = c.get("userId");
      await assertRateLimit(`products:swap:${userId}`, 120, 3600);
      const { id } = c.req.valid("param");
      const { intent } = c.req.valid("json");
      return c.json(await swapRecommendation(userId, id, intent));
    },
  )
  // FR-22: refresh price/availability before purchase; OP-003 hand-off.
  .post(
    "/recommendations/:id/refresh",
    zValidator("param", IdParam),
    zValidator("json", RefreshRecommendationRequestSchema),
    async (c) => {
      const userId = c.get("userId");
      await assertRateLimit(`products:refresh:${userId}`, 240, 3600);
      const { id } = c.req.valid("param");
      const { handoff } = c.req.valid("json");
      return c.json(await refreshRecommendation(userId, id, handoff));
    },
  )
  // FR-22: retain/exclude a product in budget totals.
  .patch(
    "/recommendations/:id",
    zValidator("param", IdParam),
    zValidator("json", UpdateRecommendationRequestSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { includeInBudget } = c.req.valid("json");
      return c.json(
        await updateRecommendation(c.get("userId"), id, includeInBudget),
      );
    },
  )
  // FR-15: per-room and whole-home totals vs household budget.
  .get("/budget/homes/:homeId", zValidator("param", HomeParam), async (c) => {
    const { homeId } = c.req.valid("param");
    return c.json(await homeBudget(c.get("userId"), homeId));
  });
