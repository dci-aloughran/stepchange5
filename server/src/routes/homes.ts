import { randomUUID } from "node:crypto";
import {
  CreateFeatureSchema,
  CreateFloorSchema,
  CreateHomeSchema,
  CreateRoomSchema,
  type HomeListItem,
  type RoomDetail,
  UpdateFeatureSchema,
  UpdateFloorSchema,
  UpdateHomeSchema,
  UpdateRoomSchema,
} from "@stepchange/shared";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getDb, schema } from "../db/client.js";
import { audit } from "../lib/audit.js";
import { getOrCreateHousehold, getOwnedHome } from "../lib/ownership.js";
import {
  assertFloorInHome,
  blobPathsForHome,
  blobPathsForRooms,
  deleteBlobs,
  getOwnedRoomInHome,
  safeTrack,
} from "../lib/profile/db.js";
import {
  latestByKind,
  type RoomRow,
  toFeature,
  toFloor,
  toHome,
  toMeasurement,
  toRoom,
} from "../lib/profile/dto.js";
import { loadHomeDetail, loadHomeParts } from "../lib/profile/model.js";
import { buildHomeOverview } from "../lib/profile/overview.js";
import {
  initialRetention,
  resolveRetention,
} from "../lib/profile/retention.js";
import {
  featureInsertValues,
  featureUpdateValues,
  planRoomCreate,
  planRoomUpdate,
} from "../lib/profile/rooms.js";
import { uuidParam, validate } from "../lib/profile/validate.js";
import { type AuthEnv, requireAuth } from "../middleware/auth.js";

const notFound = () => new HTTPException(404, { message: "Not found" });

const homeParam = z.object({ homeId: uuidParam });
const floorParam = homeParam.extend({ floorId: uuidParam });
const roomParam = homeParam.extend({ roomId: uuidParam });
const featureParam = roomParam.extend({ featureId: uuidParam });

async function loadRoomDetail(room: RoomRow): Promise<RoomDetail> {
  const db = getDb();
  const [features, measurements] = await Promise.all([
    db
      .select()
      .from(schema.architecturalFeatures)
      .where(eq(schema.architecturalFeatures.roomId, room.id))
      .orderBy(asc(schema.architecturalFeatures.createdAt)),
    db
      .select()
      .from(schema.measurements)
      .where(eq(schema.measurements.roomId, room.id)),
  ]);
  return {
    ...toRoom(room),
    features: features.map(toFeature),
    measurements: latestByKind(measurements),
  };
}

// FP-004: any change to a room's features invalidates the user's review.
function clearReview(roomId: string) {
  return getDb()
    .update(schema.rooms)
    .set({ reviewedAt: null })
    .where(eq(schema.rooms.id, roomId));
}

export const homeRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)

  // ---- Homes (FR-03, SE-011) -------------------------------------------------
  .get("/", async (c) => {
    const userId = c.get("userId");
    const db = getDb();
    const homes = await db
      .select()
      .from(schema.homes)
      .where(eq(schema.homes.userId, userId))
      .orderBy(desc(schema.homes.updatedAt));
    const ids = homes.map((h) => h.id);
    const counts =
      ids.length === 0
        ? []
        : await db
            .select({ homeId: schema.rooms.homeId, n: count() })
            .from(schema.rooms)
            .where(inArray(schema.rooms.homeId, ids))
            .groupBy(schema.rooms.homeId);
    const byHome = new Map(counts.map((r) => [r.homeId, r.n]));
    const body: HomeListItem[] = homes.map((h) => ({
      ...toHome(h),
      roomCount: byHome.get(h.id) ?? 0,
    }));
    return c.json(body);
  })
  .post("/", validate("json", CreateHomeSchema), async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const household = await getOrCreateHousehold(userId);
    const retention = initialRetention(body.journeyType, new Date());
    const [home] = await getDb()
      .insert(schema.homes)
      .values({
        userId,
        householdId: household.id,
        name: body.name,
        source: "manual",
        address: body.address ?? null,
        listing: body.listing ?? {},
        ...retention,
      })
      .returning();
    if (!home) throw new Error("home insert failed");
    await safeTrack("home_created", {
      userId,
      journeyType: home.journeyType,
      props: {
        hasAddress: home.address !== null,
        hasListing: Object.keys(body.listing ?? {}).length > 0,
      },
    });
    return c.json(toHome(home), 201);
  })
  .get("/:homeId", validate("param", homeParam), async (c) => {
    const home = await getOwnedHome(
      c.get("userId"),
      c.req.valid("param").homeId,
    );
    return c.json(await loadHomeDetail(home));
  })
  .patch(
    "/:homeId",
    validate("param", homeParam),
    validate("json", UpdateHomeSchema),
    async (c) => {
      const userId = c.get("userId");
      const body = c.req.valid("json");
      const current = await getOwnedHome(userId, c.req.valid("param").homeId);
      const set: Partial<typeof schema.homes.$inferInsert> = {};
      if (body.name !== undefined) set.name = body.name;
      if (body.address !== undefined) set.address = body.address;
      if (body.listing !== undefined) set.listing = body.listing;
      const retention = resolveRetention(
        {
          journeyType: current.journeyType,
          retentionState: current.retentionState as
            | "active"
            | "buyer_active"
            | "purchase_not_proceeding",
          retainUntil: current.retainUntil,
        },
        body,
        new Date(),
      );
      if (retention) Object.assign(set, retention);
      if (Object.keys(set).length === 0) return c.json(toHome(current));
      const [home] = await getDb()
        .update(schema.homes)
        .set(set)
        .where(
          and(eq(schema.homes.id, current.id), eq(schema.homes.userId, userId)),
        )
        .returning();
      if (!home) throw notFound();
      if (retention && retention.retentionState !== current.retentionState) {
        await safeTrack("home_retention_changed", {
          userId,
          journeyType: home.journeyType,
          props: { retentionState: home.retentionState },
        });
      }
      return c.json(toHome(home));
    },
  )
  .delete("/:homeId", validate("param", homeParam), async (c) => {
    const userId = c.get("userId");
    const home = await getOwnedHome(userId, c.req.valid("param").homeId);
    const blobsDeleted = await deleteBlobs(
      await blobPathsForHome(userId, home.id),
    );
    await getDb()
      .delete(schema.homes)
      .where(
        and(eq(schema.homes.id, home.id), eq(schema.homes.userId, userId)),
      );
    await audit("home.deleted", {
      userId,
      payload: { homeId: home.id, blobsDeleted },
    });
    await safeTrack("home_deleted", { userId, journeyType: home.journeyType });
    return c.body(null, 204);
  })
  .get("/:homeId/overview", validate("param", homeParam), async (c) => {
    const home = await getOwnedHome(
      c.get("userId"),
      c.req.valid("param").homeId,
    );
    const { floors, rooms, features } = await loadHomeParts(home.id);
    return c.json(buildHomeOverview(home, floors, rooms, features));
  })

  // ---- Floors --------------------------------------------------------------
  .get("/:homeId/floors", validate("param", homeParam), async (c) => {
    const home = await getOwnedHome(
      c.get("userId"),
      c.req.valid("param").homeId,
    );
    const rows = await getDb()
      .select()
      .from(schema.floors)
      .where(eq(schema.floors.homeId, home.id))
      .orderBy(asc(schema.floors.level), asc(schema.floors.createdAt));
    return c.json(rows.map(toFloor));
  })
  .post(
    "/:homeId/floors",
    validate("param", homeParam),
    validate("json", CreateFloorSchema),
    async (c) => {
      const home = await getOwnedHome(
        c.get("userId"),
        c.req.valid("param").homeId,
      );
      const body = c.req.valid("json");
      const [floor] = await getDb()
        .insert(schema.floors)
        .values({ homeId: home.id, name: body.name, level: body.level ?? 0 })
        .returning();
      if (!floor) throw new Error("floor insert failed");
      return c.json(toFloor(floor), 201);
    },
  )
  .patch(
    "/:homeId/floors/:floorId",
    validate("param", floorParam),
    validate("json", UpdateFloorSchema),
    async (c) => {
      const { homeId, floorId } = c.req.valid("param");
      const home = await getOwnedHome(c.get("userId"), homeId);
      const body = c.req.valid("json");
      const where = and(
        eq(schema.floors.id, floorId),
        eq(schema.floors.homeId, home.id),
      );
      const db = getDb();
      const [floor] =
        Object.keys(body).length === 0
          ? await db.select().from(schema.floors).where(where)
          : await db.update(schema.floors).set(body).where(where).returning();
      if (!floor) throw notFound();
      return c.json(toFloor(floor));
    },
  )
  .delete(
    "/:homeId/floors/:floorId",
    validate("param", floorParam),
    async (c) => {
      const { homeId, floorId } = c.req.valid("param");
      const home = await getOwnedHome(c.get("userId"), homeId);
      // Rooms on the floor are kept (floorId is set to null).
      const [deleted] = await getDb()
        .delete(schema.floors)
        .where(
          and(eq(schema.floors.id, floorId), eq(schema.floors.homeId, home.id)),
        )
        .returning({ id: schema.floors.id });
      if (!deleted) throw notFound();
      return c.body(null, 204);
    },
  )

  // ---- Rooms (FP-003, FP-004, FP-006) ------------------------------------------
  .get("/:homeId/rooms", validate("param", homeParam), async (c) => {
    const home = await getOwnedHome(
      c.get("userId"),
      c.req.valid("param").homeId,
    );
    const rows = await getDb()
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.homeId, home.id))
      .orderBy(asc(schema.rooms.createdAt));
    return c.json(rows.map(toRoom));
  })
  .post(
    "/:homeId/rooms",
    validate("param", homeParam),
    validate("json", CreateRoomSchema),
    async (c) => {
      const userId = c.get("userId");
      const home = await getOwnedHome(userId, c.req.valid("param").homeId);
      const body = c.req.valid("json");
      await assertFloorInHome(home.id, body.floorId);
      const roomId = randomUUID();
      const plan = planRoomCreate(roomId, body);
      const db = getDb();
      const insertRoom = db
        .insert(schema.rooms)
        .values({ id: roomId, homeId: home.id, ...plan.values })
        .returning();
      const [room] =
        plan.measurements.length === 0
          ? await insertRoom
          : (
              await db.batch([
                insertRoom,
                db.insert(schema.measurements).values(plan.measurements),
              ])
            )[0];
      if (!room) throw new Error("room insert failed");
      await safeTrack("room_created", {
        userId,
        journeyType: home.journeyType,
        props: {
          source: plan.measurements[0]?.source ?? "user",
          roomType: room.roomType,
          dimensionStatus: room.dimensionStatus,
        },
      });
      return c.json(await loadRoomDetail(room), 201);
    },
  )
  .get("/:homeId/rooms/:roomId", validate("param", roomParam), async (c) => {
    const { homeId, roomId } = c.req.valid("param");
    const { room } = await getOwnedRoomInHome(c.get("userId"), homeId, roomId);
    return c.json(await loadRoomDetail(room));
  })
  .patch(
    "/:homeId/rooms/:roomId",
    validate("param", roomParam),
    validate("json", UpdateRoomSchema),
    async (c) => {
      const { homeId, roomId } = c.req.valid("param");
      const body = c.req.valid("json");
      const { room: current } = await getOwnedRoomInHome(
        c.get("userId"),
        homeId,
        roomId,
      );
      if (body.floorId !== undefined) {
        await assertFloorInHome(homeId, body.floorId);
      }
      const plan = planRoomUpdate(current, body);
      if (Object.keys(plan.set).length === 0) {
        return c.json(await loadRoomDetail(current));
      }
      const db = getDb();
      const update = db
        .update(schema.rooms)
        .set(plan.set)
        .where(
          and(eq(schema.rooms.id, current.id), eq(schema.rooms.homeId, homeId)),
        )
        .returning();
      const [room] =
        plan.measurements.length === 0
          ? await update
          : (
              await db.batch([
                update,
                db.insert(schema.measurements).values(plan.measurements),
              ])
            )[0];
      if (!room) throw notFound();
      return c.json(await loadRoomDetail(room));
    },
  )
  .delete("/:homeId/rooms/:roomId", validate("param", roomParam), async (c) => {
    const { homeId, roomId } = c.req.valid("param");
    const { room } = await getOwnedRoomInHome(c.get("userId"), homeId, roomId);
    // Generated concepts are deleted with the room, so remove their images.
    await deleteBlobs(await blobPathsForRooms([room.id]));
    await getDb()
      .delete(schema.rooms)
      .where(
        and(eq(schema.rooms.id, room.id), eq(schema.rooms.homeId, homeId)),
      );
    return c.body(null, 204);
  })
  .post(
    "/:homeId/rooms/:roomId/review",
    validate("param", roomParam),
    async (c) => {
      const userId = c.get("userId");
      const { homeId, roomId } = c.req.valid("param");
      const { room: current, home } = await getOwnedRoomInHome(
        userId,
        homeId,
        roomId,
      );
      const [room] = await getDb()
        .update(schema.rooms)
        .set({ reviewedAt: new Date() })
        .where(
          and(eq(schema.rooms.id, current.id), eq(schema.rooms.homeId, homeId)),
        )
        .returning();
      if (!room) throw notFound();
      await safeTrack("room_reviewed", {
        userId,
        journeyType: home.journeyType,
        props: { dimensionStatus: room.dimensionStatus },
      });
      return c.json(await loadRoomDetail(room));
    },
  )
  .get(
    "/:homeId/rooms/:roomId/measurements",
    validate("param", roomParam),
    async (c) => {
      const { homeId, roomId } = c.req.valid("param");
      const { room } = await getOwnedRoomInHome(
        c.get("userId"),
        homeId,
        roomId,
      );
      const rows = await getDb()
        .select()
        .from(schema.measurements)
        .where(eq(schema.measurements.roomId, room.id))
        .orderBy(desc(schema.measurements.recordedAt));
      return c.json(rows.map(toMeasurement));
    },
  )

  // ---- Architectural features ---------------------------------------------------
  .get(
    "/:homeId/rooms/:roomId/features",
    validate("param", roomParam),
    async (c) => {
      const { homeId, roomId } = c.req.valid("param");
      const { room } = await getOwnedRoomInHome(
        c.get("userId"),
        homeId,
        roomId,
      );
      const rows = await getDb()
        .select()
        .from(schema.architecturalFeatures)
        .where(eq(schema.architecturalFeatures.roomId, room.id))
        .orderBy(asc(schema.architecturalFeatures.createdAt));
      return c.json(rows.map(toFeature));
    },
  )
  .post(
    "/:homeId/rooms/:roomId/features",
    validate("param", roomParam),
    validate("json", CreateFeatureSchema),
    async (c) => {
      const { homeId, roomId } = c.req.valid("param");
      const { room } = await getOwnedRoomInHome(
        c.get("userId"),
        homeId,
        roomId,
      );
      const db = getDb();
      const [[feature]] = await db.batch([
        db
          .insert(schema.architecturalFeatures)
          .values(featureInsertValues(room.id, c.req.valid("json")))
          .returning(),
        clearReview(room.id),
      ]);
      if (!feature) throw new Error("feature insert failed");
      return c.json(toFeature(feature), 201);
    },
  )
  .patch(
    "/:homeId/rooms/:roomId/features/:featureId",
    validate("param", featureParam),
    validate("json", UpdateFeatureSchema),
    async (c) => {
      const { homeId, roomId, featureId } = c.req.valid("param");
      const body = c.req.valid("json");
      const { room } = await getOwnedRoomInHome(
        c.get("userId"),
        homeId,
        roomId,
      );
      const db = getDb();
      const where = and(
        eq(schema.architecturalFeatures.id, featureId),
        eq(schema.architecturalFeatures.roomId, room.id),
      );
      const [current] = await db
        .select()
        .from(schema.architecturalFeatures)
        .where(where);
      if (!current) throw notFound();
      const set = featureUpdateValues(current, body);
      if (Object.keys(set).length === 0) return c.json(toFeature(current));
      const update = db
        .update(schema.architecturalFeatures)
        .set(set)
        .where(where)
        .returning();
      // Notes-only edits don't change the model the user reviewed.
      const affectsModel = Object.keys(set).some((k) => k !== "notes");
      const [feature] = affectsModel
        ? (await db.batch([update, clearReview(room.id)]))[0]
        : await update;
      if (!feature) throw notFound();
      return c.json(toFeature(feature));
    },
  )
  .delete(
    "/:homeId/rooms/:roomId/features/:featureId",
    validate("param", featureParam),
    async (c) => {
      const { homeId, roomId, featureId } = c.req.valid("param");
      const { room } = await getOwnedRoomInHome(
        c.get("userId"),
        homeId,
        roomId,
      );
      const db = getDb();
      const [deleted] = await db
        .delete(schema.architecturalFeatures)
        .where(
          and(
            eq(schema.architecturalFeatures.id, featureId),
            eq(schema.architecturalFeatures.roomId, room.id),
          ),
        )
        .returning({ id: schema.architecturalFeatures.id });
      if (!deleted) throw notFound();
      await clearReview(room.id);
      return c.body(null, 204);
    },
  );
