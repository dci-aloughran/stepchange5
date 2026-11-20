import {
  AccessibilityNeedInputSchema,
  CreatePersonSchema,
  CreatePossessionSchema,
  UpdateAccessibilityNeedSchema,
  UpdateHouseholdSchema,
  UpdatePersonSchema,
  UpdatePossessionSchema,
  UpdateUserProfileSchema,
} from "@stepchange/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getDb, schema } from "../db/client.js";
import { audit } from "../lib/audit.js";
import { deleteClerkUser, subjectHash } from "../lib/ops/clerk.js";
import { getOrCreateHousehold } from "../lib/ownership.js";
import {
  assertOwnedPerson,
  assertOwnedRoom,
  blobPathsForRooms,
  deleteBlobs,
  safeTrack,
} from "../lib/profile/db.js";
import {
  toAccessibilityNeed,
  toHousehold,
  toPerson,
  toPossession,
  toUserProfile,
} from "../lib/profile/dto.js";
import { buildExport, exportFilename } from "../lib/profile/export.js";
import {
  accessibilityValues,
  defaultPersonLabel,
  mergeAccessibilityUpdate,
  mergeJourneyState,
} from "../lib/profile/helpers.js";
import { uuidParam, validate } from "../lib/profile/validate.js";
import { type AuthEnv, requireAuth } from "../middleware/auth.js";

const notFound = () => new HTTPException(404, { message: "Not found" });

const personParam = z.object({ personId: uuidParam });
const needParam = z.object({ needId: uuidParam });
const possessionParam = z.object({ possessionId: uuidParam });

async function loadUser(userId: string) {
  const [user] = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!user) throw notFound();
  return user;
}

export const profileRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)

  // ---- User: journey + resume state (MB-005), AI consent (SE-010) ----------
  .get("/me", async (c) => {
    const user = await loadUser(c.get("userId"));
    return c.json(toUserProfile(user));
  })
  .patch("/me", validate("json", UpdateUserProfileSchema), async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const current = await loadUser(userId);
    const set: Partial<typeof schema.users.$inferInsert> = {};
    if (body.journeyType !== undefined) set.journeyType = body.journeyType;
    if (body.aiTrainingConsent !== undefined) {
      set.aiTrainingConsent = body.aiTrainingConsent;
    }
    if (body.journeyState !== undefined) {
      set.journeyState = mergeJourneyState(
        current.journeyState,
        body.journeyState,
      );
    }
    const [user] = await getDb()
      .update(schema.users)
      .set(set)
      .where(eq(schema.users.id, userId))
      .returning();
    if (!user) throw notFound();

    if (
      body.aiTrainingConsent !== undefined &&
      body.aiTrainingConsent !== current.aiTrainingConsent
    ) {
      await audit("consent.ai_training_changed", {
        userId,
        payload: { granted: body.aiTrainingConsent },
      });
    }
    if (body.journeyType && body.journeyType !== current.journeyType) {
      await safeTrack("journey_type_selected", {
        userId,
        journeyType: body.journeyType,
      });
    }
    return c.json(toUserProfile(user));
  })

  // ---- Household (FR-01, FR-02) ---------------------------------------------
  .get("/household", async (c) => {
    const household = await getOrCreateHousehold(c.get("userId"));
    return c.json(toHousehold(household));
  })
  .put("/household", validate("json", UpdateHouseholdSchema), async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const household = await getOrCreateHousehold(userId);
    const set: Partial<typeof schema.households.$inferInsert> = {};
    if (body.name !== undefined) set.name = body.name;
    if (body.lifestyle !== undefined) set.lifestyle = body.lifestyle;
    if (body.practicalNeeds !== undefined) {
      set.practicalNeeds = body.practicalNeeds;
    }
    if (body.budgetTotalPence !== undefined) {
      set.budgetTotalPence = body.budgetTotalPence;
    }
    if (Object.keys(set).length === 0) return c.json(toHousehold(household));
    const [updated] = await getDb()
      .update(schema.households)
      .set(set)
      .where(
        and(
          eq(schema.households.id, household.id),
          eq(schema.households.userId, userId),
        ),
      )
      .returning();
    if (!updated) throw notFound();
    await safeTrack("household_saved", {
      userId,
      props: {
        hasBudget: updated.budgetTotalPence !== null,
        budgetChanged: body.budgetTotalPence !== undefined,
        lifestyleChanged: body.lifestyle !== undefined,
      },
    });
    return c.json(toHousehold(updated));
  })

  // ---- Persons (SE-007: role + age only) -------------------------------------
  .get("/persons", async (c) => {
    const household = await getOrCreateHousehold(c.get("userId"));
    const rows = await getDb()
      .select()
      .from(schema.persons)
      .where(eq(schema.persons.householdId, household.id))
      .orderBy(asc(schema.persons.createdAt));
    return c.json(rows.map(toPerson));
  })
  .post("/persons", validate("json", CreatePersonSchema), async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const household = await getOrCreateHousehold(userId);
    let label = body.label;
    if (!label) {
      const existing = await getDb()
        .select({ label: schema.persons.label })
        .from(schema.persons)
        .where(eq(schema.persons.householdId, household.id));
      label = defaultPersonLabel(
        body.role,
        existing.map((p) => p.label),
      );
    }
    const [person] = await getDb()
      .insert(schema.persons)
      .values({
        householdId: household.id,
        role: body.role,
        label,
        ageYears: body.ageYears ?? null,
        routines: body.routines ?? {},
      })
      .returning();
    if (!person) throw new Error("person insert failed");
    await safeTrack("household_member_added", {
      userId,
      props: { role: body.role },
    });
    return c.json(toPerson(person), 201);
  })
  .patch(
    "/persons/:personId",
    validate("param", personParam),
    validate("json", UpdatePersonSchema),
    async (c) => {
      const { personId } = c.req.valid("param");
      const body = c.req.valid("json");
      const household = await getOrCreateHousehold(c.get("userId"));
      const where = and(
        eq(schema.persons.id, personId),
        eq(schema.persons.householdId, household.id),
      );
      const db = getDb();
      const [person] =
        Object.keys(body).length === 0
          ? await db.select().from(schema.persons).where(where)
          : await db.update(schema.persons).set(body).where(where).returning();
      if (!person) throw notFound();
      return c.json(toPerson(person));
    },
  )
  .delete("/persons/:personId", validate("param", personParam), async (c) => {
    const { personId } = c.req.valid("param");
    const household = await getOrCreateHousehold(c.get("userId"));
    const [deleted] = await getDb()
      .delete(schema.persons)
      .where(
        and(
          eq(schema.persons.id, personId),
          eq(schema.persons.householdId, household.id),
        ),
      )
      .returning({ id: schema.persons.id });
    if (!deleted) throw notFound();
    return c.body(null, 204);
  })

  // ---- Accessibility needs (AC-001..AC-003) -----------------------------------
  .get("/accessibility", async (c) => {
    const household = await getOrCreateHousehold(c.get("userId"));
    const rows = await getDb()
      .select()
      .from(schema.accessibilityNeeds)
      .where(eq(schema.accessibilityNeeds.householdId, household.id))
      .orderBy(asc(schema.accessibilityNeeds.createdAt));
    return c.json(rows.map(toAccessibilityNeed));
  })
  .post(
    "/accessibility",
    validate("json", AccessibilityNeedInputSchema),
    async (c) => {
      const userId = c.get("userId");
      const values = accessibilityValues(c.req.valid("json"));
      const household = await getOrCreateHousehold(userId);
      await assertOwnedRoom(userId, values.roomId);
      await assertOwnedPerson(household.id, values.personId);
      const [need] = await getDb()
        .insert(schema.accessibilityNeeds)
        .values({ ...values, householdId: household.id })
        .returning();
      if (!need) throw new Error("accessibility insert failed");
      // Need type is health-adjacent: only scope + confirmation are tracked.
      await safeTrack("accessibility_need_added", {
        userId,
        props: { scope: need.scope, confirmed: need.confirmed },
      });
      return c.json(toAccessibilityNeed(need), 201);
    },
  )
  .patch(
    "/accessibility/:needId",
    validate("param", needParam),
    validate("json", UpdateAccessibilityNeedSchema),
    async (c) => {
      const userId = c.get("userId");
      const { needId } = c.req.valid("param");
      const household = await getOrCreateHousehold(userId);
      const where = and(
        eq(schema.accessibilityNeeds.id, needId),
        eq(schema.accessibilityNeeds.householdId, household.id),
      );
      const db = getDb();
      const [current] = await db
        .select()
        .from(schema.accessibilityNeeds)
        .where(where);
      if (!current) throw notFound();
      const values = accessibilityValues(
        mergeAccessibilityUpdate(current, c.req.valid("json")),
      );
      await assertOwnedRoom(userId, values.roomId);
      await assertOwnedPerson(household.id, values.personId);
      const [need] = await db
        .update(schema.accessibilityNeeds)
        .set(values)
        .where(where)
        .returning();
      if (!need) throw notFound();
      if (need.confirmed && !current.confirmed) {
        await safeTrack("accessibility_need_confirmed", {
          userId,
          props: { scope: need.scope },
        });
      }
      return c.json(toAccessibilityNeed(need));
    },
  )
  .delete("/accessibility/:needId", validate("param", needParam), async (c) => {
    const { needId } = c.req.valid("param");
    const household = await getOrCreateHousehold(c.get("userId"));
    const [deleted] = await getDb()
      .delete(schema.accessibilityNeeds)
      .where(
        and(
          eq(schema.accessibilityNeeds.id, needId),
          eq(schema.accessibilityNeeds.householdId, household.id),
        ),
      )
      .returning({ id: schema.accessibilityNeeds.id });
    if (!deleted) throw notFound();
    return c.body(null, 204);
  })

  // ---- Existing possessions (FR-11) -------------------------------------------
  .get("/possessions", async (c) => {
    const household = await getOrCreateHousehold(c.get("userId"));
    const rows = await getDb()
      .select()
      .from(schema.existingPossessions)
      .where(eq(schema.existingPossessions.householdId, household.id))
      .orderBy(asc(schema.existingPossessions.createdAt));
    return c.json(rows.map(toPossession));
  })
  .post("/possessions", validate("json", CreatePossessionSchema), async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const household = await getOrCreateHousehold(userId);
    await assertOwnedRoom(userId, body.roomId ?? null);
    const [possession] = await getDb()
      .insert(schema.existingPossessions)
      .values({
        householdId: household.id,
        roomId: body.roomId ?? null,
        name: body.name,
        category: body.category,
        widthCm: body.widthCm ?? null,
        depthCm: body.depthCm ?? null,
        heightCm: body.heightCm ?? null,
        keep: body.keep ?? true,
        notes: body.notes ?? null,
      })
      .returning();
    if (!possession) throw new Error("possession insert failed");
    await safeTrack("possession_added", {
      userId,
      props: { keep: possession.keep, hasRoom: possession.roomId !== null },
    });
    return c.json(toPossession(possession), 201);
  })
  .patch(
    "/possessions/:possessionId",
    validate("param", possessionParam),
    validate("json", UpdatePossessionSchema),
    async (c) => {
      const userId = c.get("userId");
      const { possessionId } = c.req.valid("param");
      const body = c.req.valid("json");
      const household = await getOrCreateHousehold(userId);
      if (body.roomId !== undefined) {
        await assertOwnedRoom(userId, body.roomId);
      }
      const where = and(
        eq(schema.existingPossessions.id, possessionId),
        eq(schema.existingPossessions.householdId, household.id),
      );
      const db = getDb();
      const [possession] =
        Object.keys(body).length === 0
          ? await db.select().from(schema.existingPossessions).where(where)
          : await db
              .update(schema.existingPossessions)
              .set(body)
              .where(where)
              .returning();
      if (!possession) throw notFound();
      return c.json(toPossession(possession));
    },
  )
  .delete(
    "/possessions/:possessionId",
    validate("param", possessionParam),
    async (c) => {
      const { possessionId } = c.req.valid("param");
      const household = await getOrCreateHousehold(c.get("userId"));
      const [deleted] = await getDb()
        .delete(schema.existingPossessions)
        .where(
          and(
            eq(schema.existingPossessions.id, possessionId),
            eq(schema.existingPossessions.householdId, household.id),
          ),
        )
        .returning({ id: schema.existingPossessions.id });
      if (!deleted) throw notFound();
      return c.body(null, 204);
    },
  )

  // ---- Export (SE-008) ----------------------------------------------------------
  .get("/export", async (c) => {
    const userId = c.get("userId");
    const now = new Date();
    const data = await buildExport(userId, now);
    await audit("account.data_exported", { userId });
    await safeTrack("data_exported", { userId });
    c.header(
      "Content-Disposition",
      `attachment; filename="${exportFilename(now)}"`,
    );
    c.header("Cache-Control", "no-store");
    return c.json(data);
  })

  // ---- Delete everything (SE-008) ------------------------------------------------
  .delete("/", async (c) => {
    const userId = c.get("userId");
    const db = getDb();
    const [uploads, homes] = await Promise.all([
      db
        .select({ p: schema.uploads.blobPathname })
        .from(schema.uploads)
        .where(eq(schema.uploads.userId, userId)),
      db
        .select({ id: schema.homes.id })
        .from(schema.homes)
        .where(eq(schema.homes.userId, userId)),
    ]);
    const homeIds = homes.map((h) => h.id);
    const rooms =
      homeIds.length === 0
        ? []
        : await db
            .select({ id: schema.rooms.id })
            .from(schema.rooms)
            .where(inArray(schema.rooms.homeId, homeIds));
    const conceptPaths = await blobPathsForRooms(rooms.map((r) => r.id));

    // Blobs first: fail closed so no stored file is left without an owner.
    const blobsDeleted = await deleteBlobs([
      ...uploads.map((u) => u.p),
      ...conceptPaths,
    ]);

    // FKs cascade from users to every user-owned table. Analytics rows have
    // no FK, so they are anonymised rather than kept linked to the account.
    await db.batch([
      db
        .update(schema.analyticsEvents)
        .set({ userId: null })
        .where(eq(schema.analyticsEvents.userId, userId)),
      db.delete(schema.users).where(eq(schema.users.id, userId)),
    ]);

    // The data is gone; now remove the sign-in identity so signing in again
    // doesn't silently recreate an empty account. Failures are audited (warn)
    // inside deleteClerkUser and don't undo the successful data deletion.
    const identity = await deleteClerkUser(userId);

    // No personal data: a one-way hash lets support correlate a request.
    await audit("account.data_deleted", {
      userId: null,
      payload: {
        subjectHash: subjectHash(userId),
        homes: homeIds.length,
        blobsDeleted,
        identityDeleted: identity.deleted,
      },
    });
    return c.body(null, 204);
  });
