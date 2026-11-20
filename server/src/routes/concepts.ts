import { zValidator } from "@hono/zod-validator";
import {
  ConceptCreateSchema,
  ConceptListQuerySchema,
  ConceptPatchSchema,
} from "@stepchange/shared";
import { del, issueSignedToken, presignUrl, put } from "@vercel/blob";
import { and, desc, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getDb, schema } from "../db/client.js";
import { track } from "../lib/audit.js";
import {
  assertNotKilled,
  assertRateLimit,
  KILL_SWITCHES,
} from "../lib/guards.js";
import { getOwnedRoom } from "../lib/ownership.js";
import {
  buildConceptPrompt,
  buildDisclosure,
  CONCEPT_PROMPT_VERSION,
  generateConceptImage,
} from "../lib/planning/concept-service.js";
import {
  getOwnedConcept,
  getUsableUpload,
  latestBriefForRoom,
  loadRoomContext,
  readUploadBytes,
} from "../lib/planning/context.js";
import { conceptDto } from "../lib/planning/serialize.js";
import { type AuthEnv, requireAuth } from "../middleware/auth.js";

const IdParam = z.object({ id: z.uuid() });
const URL_TTL_MS = 10 * 60 * 1000;

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const conceptRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  // FR-12, VS-001..VS-005
  .post("/", zValidator("json", ConceptCreateSchema), async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const ctx = await loadRoomContext(userId, body.roomId);
    const db = getDb();

    // D-002: functional brief and layout come before styling.
    const brief = await latestBriefForRoom(body.roomId, ["accepted", "edited"]);
    if (!brief) {
      throw new HTTPException(409, {
        message:
          "Accept or edit this room's brief before creating visual concepts.",
      });
    }
    const [layout] = await db
      .select()
      .from(schema.layouts)
      .where(
        and(
          eq(schema.layouts.briefId, brief.id),
          ne(schema.layouts.status, "rejected"),
        ),
      )
      .orderBy(desc(schema.layouts.createdAt))
      .limit(1);
    if (!layout) {
      throw new HTTPException(409, {
        message:
          "Create a layout for this room's brief before creating visual concepts.",
      });
    }

    let photo: { bytes: Uint8Array; mediaType: string } | null = null;
    if (body.sourceUploadId) {
      const upload = await getUsableUpload(
        userId,
        body.sourceUploadId,
        "room_photo",
      );
      if (upload.roomId !== body.roomId || upload.status !== "available") {
        throw new HTTPException(422, {
          message: "That photo is not an available photo of this room.",
        });
      }
      photo = await readUploadBytes(upload);
      if (!photo) {
        throw new HTTPException(422, {
          message: "That photo could not be read.",
        });
      }
    }

    await assertNotKilled(KILL_SWITCHES.ai);
    await assertRateLimit(`concepts:create:${userId}`, 10, 3600);

    const [taste] = await db
      .select()
      .from(schema.tasteProfiles)
      .where(eq(schema.tasteProfiles.userId, userId));
    const useTaste = taste && taste.status !== "rejected";
    const prompt = buildConceptPrompt({
      room: ctx.room,
      features: ctx.features,
      recommendedUse: brief.recommendedUse,
      requirements: brief.requirements,
      placements: layout.placements,
      taste: useTaste ? taste.attributes : [],
      tasteSummary: useTaste ? taste.summary : "",
      vibe: body.vibe,
      tier: body.tier,
      photoUsed: photo != null,
    });
    const image = await generateConceptImage(prompt, photo);

    const id = crypto.randomUUID();
    const pathname = `concepts/${userId}/${id}.${EXT[image.mediaType] ?? "png"}`;
    await put(pathname, Buffer.from(image.bytes), {
      access: "private",
      addRandomSuffix: false,
      contentType: image.mediaType,
    });
    try {
      const [row] = await db
        .insert(schema.concepts)
        .values({
          id,
          roomId: body.roomId,
          briefId: brief.id,
          layoutId: layout.id,
          vibe: body.vibe,
          tier: body.tier,
          sourceUploadId: body.sourceUploadId ?? null,
          imageBlobPathname: pathname,
          dimensionBasis: ctx.room.dimensionStatus,
          disclosure: buildDisclosure(ctx.room.dimensionStatus, photo != null),
          modelVersion: image.modelVersion,
          promptVersion: CONCEPT_PROMPT_VERSION,
        })
        .returning();
      if (!row) throw new Error("insert failed");
      return c.json({ concept: conceptDto(row) }, 201);
    } catch (err) {
      await del(pathname).catch(() => {});
      throw err;
    }
  })
  .get("/", zValidator("query", ConceptListQuerySchema), async (c) => {
    const userId = c.get("userId");
    const { roomId } = c.req.valid("query");
    if (roomId) await getOwnedRoom(userId, roomId);
    const rows = await getDb()
      .select({ concept: schema.concepts })
      .from(schema.concepts)
      .innerJoin(schema.rooms, eq(schema.concepts.roomId, schema.rooms.id))
      .innerJoin(schema.homes, eq(schema.rooms.homeId, schema.homes.id))
      .where(
        and(
          eq(schema.homes.userId, userId),
          roomId ? eq(schema.concepts.roomId, roomId) : undefined,
        ),
      )
      .orderBy(desc(schema.concepts.createdAt));
    return c.json({ concepts: rows.map((r) => conceptDto(r.concept)) });
  })
  .get("/:id", zValidator("param", IdParam), async (c) => {
    const concept = await getOwnedConcept(
      c.get("userId"),
      c.req.valid("param").id,
    );
    return c.json({ concept: conceptDto(concept) });
  })
  // Short-lived presigned URL for the private image.
  .get("/:id/url", zValidator("param", IdParam), async (c) => {
    const concept = await getOwnedConcept(
      c.get("userId"),
      c.req.valid("param").id,
    );
    if (!concept.imageBlobPathname)
      throw new HTTPException(404, { message: "No image" });
    const validUntil = Date.now() + URL_TTL_MS;
    const token = await issueSignedToken({
      pathname: concept.imageBlobPathname,
      operations: ["get"],
      validUntil,
    });
    const { presignedUrl } = await presignUrl(token, {
      operation: "get",
      pathname: concept.imageBlobPathname,
      access: "private",
      validUntil,
    });
    return c.json({
      url: presignedUrl,
      expiresAt: new Date(validUntil).toISOString(),
    });
  })
  .patch(
    "/:id",
    zValidator("param", IdParam),
    zValidator("json", ConceptPatchSchema),
    async (c) => {
      const userId = c.get("userId");
      const body = c.req.valid("json");
      const concept = await getOwnedConcept(userId, c.req.valid("param").id);
      const [row] = await getDb()
        .update(schema.concepts)
        .set({
          ...(body.looksLikeMyRoom !== undefined
            ? { looksLikeMyRoom: body.looksLikeMyRoom }
            : {}),
          ...(body.status ? { status: body.status } : {}),
        })
        .where(eq(schema.concepts.id, concept.id))
        .returning();
      if (!row) throw new HTTPException(404, { message: "Not found" });
      await track("concept.rated", {
        userId,
        props: {
          looksLikeMyRoom: row.looksLikeMyRoom,
          status: row.status,
          tier: row.tier,
          dimensionBasis: row.dimensionBasis,
          sourcePhotoUsed: row.sourceUploadId != null,
          modelVersion: row.modelVersion,
          promptVersion: row.promptVersion,
        },
      });
      return c.json({ concept: conceptDto(row) });
    },
  )
  .delete("/:id", zValidator("param", IdParam), async (c) => {
    const concept = await getOwnedConcept(
      c.get("userId"),
      c.req.valid("param").id,
    );
    if (concept.imageBlobPathname) await del(concept.imageBlobPathname);
    await getDb()
      .delete(schema.concepts)
      .where(eq(schema.concepts.id, concept.id));
    return c.json({ deleted: true });
  });
