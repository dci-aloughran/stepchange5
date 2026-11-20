import { zValidator } from "@hono/zod-validator";
import {
  InspirationCreateSchema,
  InspirationUpdateSchema,
  TasteDeriveRequestSchema,
  TasteProfileUpdateSchema,
} from "@stepchange/shared";
import { and, desc, eq } from "drizzle-orm";
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
import { getUsableUpload, readUploadBytes } from "../lib/planning/context.js";
import { inspirationDto, tasteDto } from "../lib/planning/serialize.js";
import {
  applyAttributeCorrections,
  deriveTaste,
  MAX_DERIVE_IMAGES,
  preferenceAttributes,
  TASTE_PROMPT_VERSION,
} from "../lib/planning/taste-service.js";
import { type AuthEnv, requireAuth } from "../middleware/auth.js";

const MAX_INSPIRATION_ITEMS = 100;
const IdParam = z.object({ id: z.uuid() });

function linkKind(url: string) {
  const host = new URL(url).hostname.toLowerCase();
  if (/(^|\.)pinterest\.[a-z.]+$/.test(host) || host === "pin.it")
    return "pinterest";
  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  return "link";
}

async function loadProfile(userId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.tasteProfiles)
    .where(eq(schema.tasteProfiles.userId, userId));
  return row;
}

export const tasteRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  // ---- Inspiration (FR-07, D-003) ----
  .get("/inspiration", async (c) => {
    const userId = c.get("userId");
    const rows = await getDb()
      .select({
        item: schema.inspirationItems,
        uploadStatus: schema.uploads.status,
      })
      .from(schema.inspirationItems)
      .leftJoin(
        schema.uploads,
        eq(schema.inspirationItems.uploadId, schema.uploads.id),
      )
      .where(eq(schema.inspirationItems.userId, userId))
      .orderBy(desc(schema.inspirationItems.createdAt));
    return c.json({
      items: rows.map((r) => inspirationDto(r.item, r.uploadStatus)),
    });
  })
  .post(
    "/inspiration",
    zValidator("json", InspirationCreateSchema),
    async (c) => {
      const userId = c.get("userId");
      const body = c.req.valid("json");
      const db = getDb();
      const existing = await db
        .select({ id: schema.inspirationItems.id })
        .from(schema.inspirationItems)
        .where(eq(schema.inspirationItems.userId, userId));
      if (existing.length >= MAX_INSPIRATION_ITEMS) {
        throw new HTTPException(409, { message: "Inspiration limit reached" });
      }
      let uploadStatus: string | null = null;
      if (body.uploadId) {
        const upload = await getUsableUpload(
          userId,
          body.uploadId,
          "inspiration",
        );
        if (upload.status === "rejected") {
          throw new HTTPException(422, { message: "That upload was rejected" });
        }
        uploadStatus = upload.status;
      }
      const [row] = await db
        .insert(schema.inspirationItems)
        .values({
          userId,
          uploadId: body.uploadId ?? null,
          // Stored as a reference only; never fetched or scraped (D-003).
          sourceUrl: body.sourceUrl ?? null,
          kind: body.sourceUrl ? linkKind(body.sourceUrl) : "image",
          reaction: body.reaction,
          note: body.note ?? null,
        })
        .returning();
      if (!row) throw new Error("insert failed");
      return c.json({ item: inspirationDto(row, uploadStatus) }, 201);
    },
  )
  .patch(
    "/inspiration/:id",
    zValidator("param", IdParam),
    zValidator("json", InspirationUpdateSchema),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const [row] = await getDb()
        .update(schema.inspirationItems)
        .set({
          ...(body.reaction ? { reaction: body.reaction } : {}),
          ...(body.note !== undefined ? { note: body.note } : {}),
        })
        .where(
          and(
            eq(schema.inspirationItems.id, id),
            eq(schema.inspirationItems.userId, userId),
          ),
        )
        .returning();
      if (!row) throw new HTTPException(404, { message: "Not found" });
      return c.json({ item: inspirationDto(row, null) });
    },
  )
  .delete("/inspiration/:id", zValidator("param", IdParam), async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.valid("param");
    const [row] = await getDb()
      .delete(schema.inspirationItems)
      .where(
        and(
          eq(schema.inspirationItems.id, id),
          eq(schema.inspirationItems.userId, userId),
        ),
      )
      .returning({ id: schema.inspirationItems.id });
    if (!row) throw new HTTPException(404, { message: "Not found" });
    return c.json({ deleted: true });
  })
  // ---- Profile (FR-08) ----
  .get("/", async (c) => {
    const row = await loadProfile(c.get("userId"));
    return c.json({ profile: row ? tasteDto(row) : null });
  })
  .post("/derive", zValidator("json", TasteDeriveRequestSchema), async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");
    await assertNotKilled(KILL_SWITCHES.ai);
    await assertRateLimit(`taste:derive:${userId}`, 10, 3600);
    const db = getDb();
    const items = await db
      .select({ item: schema.inspirationItems, upload: schema.uploads })
      .from(schema.inspirationItems)
      .leftJoin(
        schema.uploads,
        eq(schema.inspirationItems.uploadId, schema.uploads.id),
      )
      .where(eq(schema.inspirationItems.userId, userId))
      .orderBy(desc(schema.inspirationItems.createdAt));
    const existing = await loadProfile(userId);

    // Prefer images with a clear reaction.
    const rank = { love: 0, dislike: 1, neutral: 2 } as Record<string, number>;
    const imageCandidates = items
      .filter(
        (r) =>
          r.upload &&
          r.upload.userId === userId &&
          r.upload.status === "available",
      )
      .sort(
        (a, b) => (rank[a.item.reaction] ?? 3) - (rank[b.item.reaction] ?? 3),
      );
    const images: Array<{
      bytes: Uint8Array;
      mediaType: string;
      reaction: string;
      note: string | null;
    }> = [];
    let skipped = 0;
    for (const r of imageCandidates) {
      if (images.length >= MAX_DERIVE_IMAGES || !r.upload) {
        skipped++;
        continue;
      }
      const data = await readUploadBytes(r.upload).catch(() => null);
      if (!data) {
        skipped++;
        continue;
      }
      images.push({ ...data, reaction: r.item.reaction, note: r.item.note });
    }
    const links = items
      .filter((r) => r.item.sourceUrl)
      .map((r) => ({
        kind: r.item.kind,
        reaction: r.item.reaction,
        note: r.item.note,
      }));
    const unusableUploads = items.filter(
      (r) => r.item.uploadId && (!r.upload || r.upload.status !== "available"),
    );
    skipped += unusableUploads.length;

    const prevAttrs = existing?.attributes ?? [];
    const brands =
      body.preferredBrands ??
      prevAttrs.filter((a) => a.key.startsWith("brand.")).map((a) => a.value);
    const colours =
      body.preferredColours ??
      prevAttrs.filter((a) => a.key.startsWith("colour.")).map((a) => a.value);
    const kept = prevAttrs.filter(
      (a) =>
        a.userEdited &&
        !a.key.startsWith("brand.") &&
        !a.key.startsWith("colour."),
    );

    if (
      images.length === 0 &&
      links.length === 0 &&
      !body.description &&
      !brands.length &&
      !colours.length &&
      !items.some((r) => r.item.note)
    ) {
      throw new HTTPException(422, {
        message:
          "Add some inspiration images, links with notes, or a description first.",
      });
    }

    const derived = await deriveTaste({
      images,
      links,
      textOnlyItems: unusableUploads.map((r) => ({
        reaction: r.item.reaction,
        note: r.item.note,
      })),
      description: body.description,
      brands,
      colours,
      keptAttributes: kept,
    });
    const textOnly = images.length === 0;
    const summary = textOnly
      ? `${derived.summary} (Based on your notes and preferences only — no images were available.)`
      : derived.summary;
    const attributes = [
      ...kept,
      ...derived.attributes,
      ...preferenceAttributes(brands, colours),
    ];

    const [row] = await db
      .insert(schema.tasteProfiles)
      .values({
        userId,
        summary,
        attributes,
        status: "draft",
        modelVersion: derived.modelVersion,
        promptVersion: TASTE_PROMPT_VERSION,
      })
      .onConflictDoUpdate({
        target: schema.tasteProfiles.userId,
        set: {
          summary,
          attributes,
          status: "draft",
          modelVersion: derived.modelVersion,
          promptVersion: TASTE_PROMPT_VERSION,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error("upsert failed");
    return c.json({
      profile: tasteDto(row),
      basis: {
        imageCount: images.length,
        skippedImageCount: skipped,
        linkCount: links.length,
        textOnly,
        message: textOnly
          ? "No usable images were available, so this profile was derived from your text inputs only."
          : `Derived from ${images.length} image(s)${links.length ? ` and ${links.length} saved link note(s)` : ""}. Links are kept as references and are not opened.`,
      },
    });
  })
  .put("/", zValidator("json", TasteProfileUpdateSchema), async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const existing = await loadProfile(userId);
    const prev = existing?.attributes ?? [];
    const prevCore = prev.filter(
      (a) => !a.key.startsWith("brand.") && !a.key.startsWith("colour."),
    );
    let attributes = prevCore;
    let changedCount = 0;
    if (body.attributes) {
      const input = body.attributes.filter(
        (a) => !a.key?.startsWith("brand.") && !a.key?.startsWith("colour."),
      );
      const applied = applyAttributeCorrections(prevCore, input);
      attributes = applied.attributes;
      changedCount += applied.changedCount;
    }
    const prevBrands = prev
      .filter((a) => a.key.startsWith("brand."))
      .map((a) => a.value);
    const prevColours = prev
      .filter((a) => a.key.startsWith("colour."))
      .map((a) => a.value);
    const brands = body.preferredBrands ?? prevBrands;
    const colours = body.preferredColours ?? prevColours;
    if (
      body.preferredBrands &&
      body.preferredBrands.join("|") !== prevBrands.join("|")
    ) {
      changedCount++;
    }
    if (
      body.preferredColours &&
      body.preferredColours.join("|") !== prevColours.join("|")
    ) {
      changedCount++;
    }
    const summary = body.summary ?? existing?.summary ?? "";
    if (body.summary !== undefined && body.summary !== existing?.summary)
      changedCount++;
    const status = body.status ?? (changedCount > 0 ? "edited" : "accepted");
    const all = [...attributes, ...preferenceAttributes(brands, colours)];

    const [row] = await getDb()
      .insert(schema.tasteProfiles)
      .values({ userId, summary, attributes: all, status })
      .onConflictDoUpdate({
        target: schema.tasteProfiles.userId,
        set: { summary, attributes: all, status, updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error("upsert failed");
    await track("taste.corrected", {
      userId,
      props: {
        changedCount,
        attributeCount: all.length,
        status,
        modelVersion: row.modelVersion,
        promptVersion: row.promptVersion,
      },
    });
    return c.json({ profile: tasteDto(row) });
  });
