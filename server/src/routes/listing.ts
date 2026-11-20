import { zValidator } from "@hono/zod-validator";
import {
  ListingExtractRequestSchema,
  UPLOAD_MAX_BYTES,
} from "@stepchange/shared";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getDb, schema } from "../db/client.js";
import { audit, track } from "../lib/audit.js";
import {
  assertNotKilled,
  assertRateLimit,
  KILL_SWITCHES,
} from "../lib/guards.js";
import {
  callListingModel,
  LISTING_PROMPT_VERSION,
  type ListingSourceFile,
  normaliseListing,
} from "../lib/listing/extract.js";
import { readPrivate } from "../lib/uploads/storage.js";
import { detectMime } from "../lib/uploads/validate.js";
import { type AuthEnv, requireAuth } from "../middleware/auth.js";

const EXTRACTIONS_PER_HOUR = 10;

// Listing preview from content the user shares: screenshots / saved PDFs
// (uploaded with purpose "listing") and pasted listing text. We never fetch
// the portal page itself (PRD D-003); a URL is stored as a reference only.
export const listingRoutes = new Hono<AuthEnv>().use("*", requireAuth).post(
  "/extract",
  zValidator("json", ListingExtractRequestSchema, (result) => {
    if (!result.success) {
      throw new HTTPException(400, {
        message:
          result.error.issues[0]?.message ?? "Add a screenshot or listing text",
      });
    }
  }),
  async (c) => {
    const userId = c.get("userId");
    await assertNotKilled(KILL_SWITCHES.ai);
    const body = c.req.valid("json");
    if (body.uploadIds.length) await assertNotKilled(KILL_SWITCHES.parser);
    await assertRateLimit(
      `listing:extract:${userId}`,
      EXTRACTIONS_PER_HOUR,
      3600,
    );

    const rows = body.uploadIds.length
      ? await getDb()
          .select()
          .from(schema.uploads)
          .where(
            and(
              eq(schema.uploads.userId, userId),
              inArray(schema.uploads.id, body.uploadIds),
            ),
          )
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));

    const files: ListingSourceFile[] = [];
    for (const id of body.uploadIds) {
      const row = byId.get(id);
      if (!row) throw new HTTPException(404, { message: "Not found" });
      if (row.purpose !== "listing") {
        throw new HTTPException(400, {
          message: "Only listing screenshots can be read here.",
        });
      }
      // SE-005: AI only ever sees released files whose type still matches.
      if (row.status !== "available" || !row.blobPathname) {
        throw new HTTPException(409, {
          message: "One of these files isn't available for processing.",
        });
      }
      const bytes = await readPrivate(row.blobPathname, 3 * UPLOAD_MAX_BYTES);
      const mime = bytes ? detectMime(bytes) : null;
      if (!bytes || !mime || mime !== row.detectedMime) {
        await audit("listing.integrity_failed", {
          userId,
          severity: "warn",
          payload: { uploadId: row.id },
        });
        throw new HTTPException(409, {
          message: "One of these files isn't available for processing.",
        });
      }
      files.push({ uploadId: row.id, bytes, mime });
    }

    let extracted: Awaited<ReturnType<typeof callListingModel>>;
    try {
      extracted = await callListingModel(files, body.text);
    } catch (err) {
      await audit("listing.extraction_failed", {
        userId,
        severity: "warn",
        payload: { files: files.length, message: String(err).slice(0, 200) },
      }).catch(() => {});
      return c.json(
        {
          error:
            "We couldn't read this listing automatically. You can enter the details yourself.",
        },
        422,
      );
    }

    const response = normaliseListing(extracted.raw, body.uploadIds, {
      sourceUrl: body.url ?? null,
      modelVersion: extracted.modelVersion,
    });
    await track("listing.extracted", {
      userId,
      props: {
        files: files.length,
        hasText: Boolean(body.text),
        missing: response.missing.length,
        rooms: response.rooms.length,
        modelVersion: response.modelVersion,
        promptVersion: LISTING_PROMPT_VERSION,
      },
    }).catch(() => {});
    return c.json(response);
  },
);
