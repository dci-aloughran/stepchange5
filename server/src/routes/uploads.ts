// Secure upload gateway + floor-plan extraction.
//
// PRD coverage (see lib/uploads/* for details):
//   SE-001  auth (requireAuth), per-user rate limit, per-purpose allowlist,
//           4 MiB size cap, 40 MP pixel cap, 20-page PDF cap.
//   SE-002  filename / double-extension checks, declared MIME vs extension vs
//           magic bytes vs parser-detected type (libvips / PDF inspector),
//           PDF active-content markers, polyglot markers.
//   SE-003  bytes land in private quarantine first; images get CDR (decode +
//           re-encode, all metadata incl. EXIF GPS stripped) before release.
//           GAPS: no malware scanner yet (scanStatus "not_configured",
//           pluggable scanFile(); UPLOAD_REQUIRE_AV_SCAN=1 fails closed) and
//           no PDF CDR (PDFs are structurally validated, not rebuilt).
//   SE-004  GAP: decoding is bounded (size, pixels, pages, inflate budget,
//           timeouts, single frame) but runs in-process, not in an isolated
//           least-privilege sandbox. Recommended follow-up: move validation +
//           CDR (incl. PDF rasterisation) into Vercel Sandbox with no secrets
//           and no network.
//   SE-005  every failure fails closed: row "rejected", blobs deleted, audit
//           warn event, 422 with a generic retryable message. Only "available"
//           uploads can be viewed or sent to AI.
//   SE-006  >= 10 rejections/hour throttles uploads (429) and raises a critical
//           audit event; kill switches "uploads", "parser", "ai".
//   SE-009  every query is scoped to the authenticated user.
import { zValidator } from "@hono/zod-validator";
import {
  FloorplanExtractRequestSchema,
  UPLOAD_MAX_BYTES,
  UPLOAD_VIEW_URL_TTL_SECONDS,
  UploadCreateFormSchema,
  UploadIdParamSchema,
  UploadListQuerySchema,
  type UploadRejectionReason,
} from "@stepchange/shared";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { ZodType } from "zod";
import { getDb, schema } from "../db/client.js";
import { audit, track } from "../lib/audit.js";
import {
  assertNotKilled,
  assertRateLimit,
  KILL_SWITCHES,
} from "../lib/guards.js";
import { getOwnedHome, getOwnedRoom } from "../lib/ownership.js";
import { isThrottledForAbuse } from "../lib/uploads/abuse.js";
import { toUploadDto } from "../lib/uploads/dto.js";
import {
  callFloorplanModel,
  ExtractionConflictError,
  FLOORPLAN_PROMPT_VERSION,
  persistExtraction,
} from "../lib/uploads/floorplan.js";
import {
  NotAFloorPlanError,
  normaliseExtraction,
} from "../lib/uploads/floorplan-normalise.js";
import { processUpload } from "../lib/uploads/pipeline.js";
import {
  deleteBlobs,
  presignedGetUrl,
  quarantinePath,
  readPrivate,
} from "../lib/uploads/storage.js";
import { detectMime } from "../lib/uploads/validate.js";
import { type AuthEnv, requireAuth } from "../middleware/auth.js";

const UPLOADS_PER_HOUR = 30;
const EXTRACTIONS_PER_HOUR = 10;

const REJECTION_MESSAGES: Record<UploadRejectionReason, string> = {
  too_large: "This file is too large. Please upload a file under 4 MB.",
  unsupported_type:
    "This file type or size isn't supported. Floor plans can be PDF, PNG or JPEG; photos can be PNG, JPEG or WebP.",
  invalid_file:
    "We couldn't accept this file. Please try again, or export a fresh copy of the file and upload that.",
  processing_error:
    "We couldn't process this file right now. Please try again.",
};

const EXTRACTION_FAILED =
  "We couldn't read this floor plan automatically. You can add your rooms manually instead.";

function validator<
  Target extends "form" | "query" | "param" | "json",
  T extends ZodType,
>(target: Target, schemaDef: T) {
  return zValidator(target, schemaDef, (result) => {
    if (!result.success) {
      throw new HTTPException(400, { message: "Invalid request" });
    }
  });
}

// SE-001 / SE-006 gates that run before the request body is read.
const uploadGate = createMiddleware<AuthEnv>(async (c, next) => {
  const userId = c.get("userId");
  await assertNotKilled(KILL_SWITCHES.uploads);
  if (await isThrottledForAbuse(userId)) {
    throw new HTTPException(429, {
      message:
        "Too many uploads could not be accepted. Please wait a while before trying again.",
    });
  }
  await assertRateLimit(`uploads:${userId}`, UPLOADS_PER_HOUR, 3600);
  await next();
});

async function getOwnedUpload(userId: string, id: string) {
  const [row] = await getDb()
    .select()
    .from(schema.uploads)
    .where(and(eq(schema.uploads.id, id), eq(schema.uploads.userId, userId)));
  if (!row) throw new HTTPException(404, { message: "Not found" });
  return row;
}

export const uploadRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .use("*", async (c, next) => {
    await next();
    // Upload metadata and presigned URLs are user-private.
    c.header("Cache-Control", "no-store");
  })
  .post(
    "/",
    uploadGate,
    bodyLimit({
      // File cap + multipart overhead; the file itself is checked exactly.
      maxSize: UPLOAD_MAX_BYTES + 256 * 1024,
      onError: () => {
        throw new HTTPException(413, {
          message: REJECTION_MESSAGES.too_large,
        });
      },
    }),
    validator("form", UploadCreateFormSchema),
    async (c) => {
      const userId = c.get("userId");
      const { file, purpose, homeId, roomId } = c.req.valid("form");

      let resolvedHomeId = homeId ?? null;
      if (roomId) {
        const { room } = await getOwnedRoom(userId, roomId);
        if (homeId && room.homeId !== homeId) {
          throw new HTTPException(400, { message: "Invalid request" });
        }
        resolvedHomeId = room.homeId;
      } else if (homeId) {
        await getOwnedHome(userId, homeId);
      }

      const bytes = Buffer.from(await file.arrayBuffer());
      const result = await processUpload({
        userId,
        bytes,
        filename: file.name,
        declaredMime: file.type || null,
        purpose,
        homeId: resolvedHomeId,
        roomId: roomId ?? null,
      });
      if (!result.ok) {
        return c.json(
          {
            error: REJECTION_MESSAGES[result.reason],
            uploadId: result.uploadId,
            reason: result.reason,
            retryable: true as const,
          },
          422,
        );
      }
      return c.json({ upload: toUploadDto(result.upload) }, 201);
    },
  )
  .get("/", validator("query", UploadListQuerySchema), async (c) => {
    const userId = c.get("userId");
    const q = c.req.valid("query");
    const filters: SQL[] = [eq(schema.uploads.userId, userId)];
    if (q.homeId) filters.push(eq(schema.uploads.homeId, q.homeId));
    if (q.roomId) filters.push(eq(schema.uploads.roomId, q.roomId));
    if (q.purpose) filters.push(eq(schema.uploads.purpose, q.purpose));
    if (q.status) filters.push(eq(schema.uploads.status, q.status));
    const rows = await getDb()
      .select()
      .from(schema.uploads)
      .where(and(...filters))
      .orderBy(desc(schema.uploads.createdAt))
      .limit(200);
    return c.json({ uploads: rows.map(toUploadDto) });
  })
  .get("/:id", validator("param", UploadIdParamSchema), async (c) => {
    const row = await getOwnedUpload(c.get("userId"), c.req.valid("param").id);
    return c.json({ upload: toUploadDto(row) });
  })
  .get("/:id/url", validator("param", UploadIdParamSchema), async (c) => {
    const row = await getOwnedUpload(c.get("userId"), c.req.valid("param").id);
    if (row.status !== "available" || !row.blobPathname || !row.detectedMime) {
      throw new HTTPException(409, {
        message: "This file isn't available to view.",
      });
    }
    const { url, expiresAt } = await presignedGetUrl(
      row.blobPathname,
      UPLOAD_VIEW_URL_TTL_SECONDS,
    );
    return c.json({
      url,
      expiresAt: expiresAt.toISOString(),
      mimeType: row.detectedMime,
    });
  })
  .delete("/:id", validator("param", UploadIdParamSchema), async (c) => {
    const userId = c.get("userId");
    const row = await getOwnedUpload(userId, c.req.valid("param").id);
    // SE-008: remove stored bytes before the metadata row. Throws (500) if the
    // blob store refuses, so the row is kept and the user can retry.
    await deleteBlobs([row.blobPathname, quarantinePath(userId, row.id)]);
    await getDb()
      .delete(schema.uploads)
      .where(
        and(eq(schema.uploads.id, row.id), eq(schema.uploads.userId, userId)),
      );
    await audit("upload.deleted", {
      userId,
      payload: { uploadId: row.id, purpose: row.purpose },
    }).catch(() => {});
    return c.json({ deleted: true as const, id: row.id });
  })
  .post(
    "/:id/extract-floorplan",
    validator("param", UploadIdParamSchema),
    validator("json", FloorplanExtractRequestSchema),
    async (c) => {
      const userId = c.get("userId");
      await assertNotKilled(KILL_SWITCHES.parser);
      await assertNotKilled(KILL_SWITCHES.ai);
      const row = await getOwnedUpload(userId, c.req.valid("param").id);
      const body = c.req.valid("json");

      if (row.purpose !== "floor_plan") {
        throw new HTTPException(400, {
          message: "Only floor-plan uploads can be extracted.",
        });
      }
      // SE-005: downstream AI only ever sees released (available) files.
      if (row.status !== "available" || !row.blobPathname) {
        throw new HTTPException(409, {
          message: "This file isn't available for processing.",
        });
      }
      if (!row.homeId) {
        throw new HTTPException(400, {
          message: "Attach this floor plan to a home before extracting rooms.",
        });
      }
      await getOwnedHome(userId, row.homeId);
      await assertRateLimit(
        `floorplan:extract:${userId}`,
        EXTRACTIONS_PER_HOUR,
        3600,
      );

      const bytes = await readPrivate(row.blobPathname, 3 * UPLOAD_MAX_BYTES);
      const mime = bytes ? detectMime(bytes) : null;
      if (
        !bytes ||
        !mime ||
        mime !== row.detectedMime ||
        mime === "image/webp"
      ) {
        await audit("floorplan.integrity_failed", {
          userId,
          severity: "warn",
          payload: { uploadId: row.id },
        });
        throw new HTTPException(409, {
          message: "This file isn't available for processing.",
        });
      }

      const fail = async (code: string, message = EXTRACTION_FAILED) => {
        await audit("floorplan.extraction_failed", {
          userId,
          severity: "warn",
          payload: { uploadId: row.id, code },
        }).catch(() => {});
        await track("floorplan.extraction_failed", {
          userId,
          props: { code, promptVersion: FLOORPLAN_PROMPT_VERSION },
        }).catch(() => {});
        return c.json(
          { error: message, fallback: "manual_room_entry" as const },
          422,
        );
      };

      let call: Awaited<ReturnType<typeof callFloorplanModel>>;
      try {
        call = await callFloorplanModel(bytes, mime);
      } catch (err) {
        console.error("floorplan model call failed", String(err));
        return fail("model_error");
      }

      let extraction: ReturnType<typeof normaliseExtraction>;
      try {
        extraction = normaliseExtraction(call.raw);
      } catch (err) {
        if (err instanceof NotAFloorPlanError) {
          return fail(
            "not_a_floor_plan",
            "This doesn't look like a floor plan. Try another file, or add your rooms manually.",
          );
        }
        return fail("normalise_error");
      }
      if (extraction.rooms.length === 0) return fail("no_rooms");

      let response: Awaited<ReturnType<typeof persistExtraction>>;
      try {
        response = await persistExtraction({
          homeId: row.homeId,
          uploadId: row.id,
          extraction,
          replaceExisting: body.replaceExisting ?? false,
          modelVersion: call.modelVersion,
        });
      } catch (err) {
        if (err instanceof ExtractionConflictError) {
          throw new HTTPException(409, {
            message:
              err.reason === "already_extracted"
                ? "Rooms were already created from this floor plan. Send replaceExisting to re-run extraction."
                : "Rooms from this floor plan have already been reviewed. Edit them directly instead.",
          });
        }
        throw err;
      }

      await track("floorplan.extracted", {
        userId,
        props: {
          roomCount: response.rooms.length,
          floorCount: response.floors.length,
          needsKnownMeasurement: response.needsKnownMeasurement,
          mime,
          modelVersion: response.modelVersion,
          promptVersion: response.promptVersion,
        },
      }).catch(() => {});
      return c.json(response, 201);
    },
  );
