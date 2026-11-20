import { zValidator } from "@hono/zod-validator";
import {
  BriefGenerateQuerySchema,
  BriefPatchSchema,
  LayoutPatchSchema,
} from "@stepchange/shared";
import { desc, eq, max } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getDb, schema } from "../db/client.js";
import type { Placement } from "../db/schema.js";
import { track } from "../lib/audit.js";
import {
  assertNotKilled,
  assertRateLimit,
  KILL_SWITCHES,
} from "../lib/guards.js";
import { postCheckBrief } from "../lib/planning/brief-checks.js";
import {
  BRIEF_PROMPT_VERSION,
  draftBrief,
} from "../lib/planning/brief-service.js";
import {
  getOwnedBrief,
  getOwnedLayout,
  latestLayoutForBrief,
  loadRoomContext,
} from "../lib/planning/context.js";
import {
  expandUnits,
  LAYOUT_PROMPT_VERSION,
  proposePlacements,
  runValidation,
  toItems,
  toPlacements,
} from "../lib/planning/layout-service.js";
import { briefDto, layoutDto } from "../lib/planning/serialize.js";
import { type AuthEnv, requireAuth } from "../middleware/auth.js";

const RoomParam = z.object({ roomId: z.uuid() });
const BriefParam = z.object({ briefId: z.uuid() });
const LayoutParam = z.object({ layoutId: z.uuid() });

function stripValidation<T extends { zones: unknown }>(r: T) {
  const { zones: _zones, ...rest } = r;
  return rest;
}

export const planRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  // ---- Functional brief (FR-09..FR-11, D-002) ----
  .post(
    "/rooms/:roomId/brief",
    zValidator("param", RoomParam),
    zValidator("query", BriefGenerateQuerySchema),
    async (c) => {
      const userId = c.get("userId");
      const { roomId } = c.req.valid("param");
      const allowUnreviewed = c.req.valid("query").allowUnreviewed === "true";
      const ctx = await loadRoomContext(userId, roomId);
      if (!ctx.room.reviewedAt && !allowUnreviewed) {
        throw new HTTPException(409, {
          message:
            "Review this room's size, doors and windows before creating a brief (or pass allowUnreviewed=true).",
        });
      }
      await assertNotKilled(KILL_SWITCHES.ai);
      await assertRateLimit(`plans:brief:${userId}`, 20, 3600);
      const { checked, modelVersion } = await draftBrief(ctx, allowUnreviewed);
      const db = getDb();
      const [agg] = await db
        .select({ v: max(schema.functionalBriefs.version) })
        .from(schema.functionalBriefs)
        .where(eq(schema.functionalBriefs.roomId, roomId));
      const [row] = await db
        .insert(schema.functionalBriefs)
        .values({
          roomId,
          version: (agg?.v ?? 0) + 1,
          ...checked,
          status: "draft",
          modelVersion,
          promptVersion: BRIEF_PROMPT_VERSION,
        })
        .returning();
      if (!row) throw new Error("insert failed");
      return c.json({ brief: briefDto(row) }, 201);
    },
  )
  .get("/rooms/:roomId/briefs", zValidator("param", RoomParam), async (c) => {
    const { roomId } = c.req.valid("param");
    await loadRoomContext(c.get("userId"), roomId);
    const rows = await getDb()
      .select()
      .from(schema.functionalBriefs)
      .where(eq(schema.functionalBriefs.roomId, roomId))
      .orderBy(desc(schema.functionalBriefs.version));
    return c.json({ briefs: rows.map(briefDto) });
  })
  .get("/briefs/:briefId", zValidator("param", BriefParam), async (c) => {
    const { brief } = await getOwnedBrief(
      c.get("userId"),
      c.req.valid("param").briefId,
    );
    return c.json({ brief: briefDto(brief) });
  })
  .patch(
    "/briefs/:briefId",
    zValidator("param", BriefParam),
    zValidator("json", BriefPatchSchema),
    async (c) => {
      const userId = c.get("userId");
      const { briefId } = c.req.valid("param");
      const body = c.req.valid("json");
      const { brief, room } = await getOwnedBrief(userId, briefId);
      const materialEdit =
        body.requirements !== undefined ||
        (body.recommendedUse !== undefined &&
          body.recommendedUse !== brief.recommendedUse) ||
        (body.householdNeed !== undefined &&
          body.householdNeed !== brief.householdNeed);
      let update: Partial<typeof schema.functionalBriefs.$inferInsert> = {};
      if (body.requirements) {
        // Re-run the deterministic checks on user edits too.
        const ctx = await loadRoomContext(userId, room.id);
        const checked = postCheckBrief(
          {
            householdNeed: body.householdNeed ?? brief.householdNeed,
            recommendedUse: body.recommendedUse ?? brief.recommendedUse,
            roomConstraints: [],
            requirements: body.requirements,
            uncertainties: [],
          },
          {
            room: { ...ctx.room, reviewed: ctx.room.reviewedAt != null },
            features: ctx.features,
            possessions: ctx.possessions,
            needs: ctx.needs,
            roomBudgetPence: ctx.roomBudgetPence,
            allowUnreviewed: true,
          },
        );
        update = checked;
      } else {
        if (body.householdNeed) update.householdNeed = body.householdNeed;
        if (body.recommendedUse) update.recommendedUse = body.recommendedUse;
      }
      const status = body.status ?? (materialEdit ? "edited" : brief.status);
      const [row] = await getDb()
        .update(schema.functionalBriefs)
        .set({ ...update, status })
        .where(eq(schema.functionalBriefs.id, briefId))
        .returning();
      if (!row) throw new HTTPException(404, { message: "Not found" });
      await track("brief.reviewed", {
        userId,
        props: {
          status,
          materialEdit,
          version: row.version,
          modelVersion: row.modelVersion,
          promptVersion: row.promptVersion,
        },
      });
      return c.json({ brief: briefDto(row) });
    },
  )
  // ---- Layout (AC-003, AC-004, AC-005, VS-004) ----
  .post(
    "/briefs/:briefId/layout",
    zValidator("param", BriefParam),
    async (c) => {
      const userId = c.get("userId");
      const { brief, room } = await getOwnedBrief(
        userId,
        c.req.valid("param").briefId,
      );
      if (brief.status === "rejected") {
        throw new HTTPException(409, {
          message: "This brief was rejected; create a new one.",
        });
      }
      await assertNotKilled(KILL_SWITCHES.ai);
      await assertRateLimit(`plans:layout:${userId}`, 30, 3600);
      const ctx = await loadRoomContext(userId, room.id);
      const units = expandUnits(brief.requirements);
      const proposal = await proposePlacements({
        room: ctx.room,
        features: ctx.features,
        needs: ctx.needs,
        units,
      });
      const { items, result } = runValidation(
        {
          room: ctx.room,
          features: ctx.features,
          needs: ctx.needs,
          items: proposal.items,
        },
        true,
      );
      if (proposal.modelVersion == null && units.length > 0) {
        result.notes.push(
          "Placements were produced by the deterministic planner only.",
        );
      }
      result.notes.push(
        `Layout prompt ${LAYOUT_PROMPT_VERSION}; model ${proposal.modelVersion ?? "none"}.`,
      );
      const [row] = await getDb()
        .insert(schema.layouts)
        .values({
          roomId: room.id,
          briefId: brief.id,
          placements: toPlacements(items),
          zones: result.zones,
          validation: stripValidation(result),
          status: "draft",
        })
        .returning();
      if (!row) throw new Error("insert failed");
      return c.json({ layout: layoutDto(row, ctx.room) }, 201);
    },
  )
  .get(
    "/briefs/:briefId/layout",
    zValidator("param", BriefParam),
    async (c) => {
      const { brief, room } = await getOwnedBrief(
        c.get("userId"),
        c.req.valid("param").briefId,
      );
      const layout = await latestLayoutForBrief(brief.id);
      if (!layout) throw new HTTPException(404, { message: "No layout yet" });
      return c.json({ layout: layoutDto(layout, room) });
    },
  )
  .patch(
    "/layouts/:layoutId",
    zValidator("param", LayoutParam),
    zValidator("json", LayoutPatchSchema),
    async (c) => {
      const userId = c.get("userId");
      const body = c.req.valid("json");
      const { layout, room, brief } = await getOwnedLayout(
        userId,
        c.req.valid("param").layoutId,
      );
      let update: Partial<typeof schema.layouts.$inferInsert> = {};
      let verdict: { verifiedFit: boolean; conflictCount: number } | null =
        null;
      if (body.placements) {
        const reqIds = new Set(brief.requirements.map((r) => r.id));
        const unknown = body.placements.find(
          (p) => !reqIds.has(p.requirementId),
        );
        if (unknown) {
          throw new HTTPException(422, {
            message: `Unknown requirementId ${unknown.requirementId}`,
          });
        }
        const prevByReq = new Map(
          layout.placements.map((p) => [p.requirementId, p]),
        );
        const placements: Placement[] = body.placements.map((p) => {
          const prev = prevByReq.get(p.requirementId);
          const r = brief.requirements.find((x) => x.id === p.requirementId);
          return {
            requirementId: p.requirementId,
            label: p.label ?? prev?.label ?? r?.category ?? "Item",
            xCm: p.xCm,
            yCm: p.yCm,
            widthCm: p.widthCm ?? prev?.widthCm ?? 60,
            depthCm: p.depthCm ?? prev?.depthCm ?? 60,
            rotationDeg: p.rotationDeg,
          };
        });
        const ctx = await loadRoomContext(userId, room.id);
        const { items, result } = runValidation(
          {
            room: ctx.room,
            features: ctx.features,
            needs: ctx.needs,
            items: toItems(placements, brief.requirements),
          },
          body.repair === true,
        );
        update = {
          placements: toPlacements(items),
          zones: result.zones,
          validation: stripValidation(result),
        };
        verdict = {
          verifiedFit: result.verifiedFit,
          conflictCount: result.conflicts.length,
        };
      }
      const status =
        body.status ?? (body.placements ? "edited" : layout.status);
      const [row] = await getDb()
        .update(schema.layouts)
        .set({ ...update, status })
        .where(eq(schema.layouts.id, layout.id))
        .returning();
      if (!row) throw new HTTPException(404, { message: "Not found" });
      if (body.status) {
        await track("layout.reviewed", {
          userId,
          props: {
            status,
            moved: body.placements !== undefined,
            ...(verdict ?? {}),
            promptVersion: LAYOUT_PROMPT_VERSION,
          },
        });
      }
      return c.json({ layout: layoutDto(row, room) });
    },
  );
