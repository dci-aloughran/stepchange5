import { createHash, randomUUID } from "node:crypto";
import type { UploadPurpose, UploadRejectionReason } from "@stepchange/shared";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../db/client.js";
import { audit } from "../audit.js";
import { recordRejection } from "./abuse.js";
import type { UploadRow } from "./dto.js";
import { sanitizeImage } from "./sanitize.js";
import { scanFile, scanRequired } from "./scan.js";
import {
  deleteQuietly,
  filePath,
  putPrivate,
  quarantinePath,
} from "./storage.js";
import {
  checkFilename,
  countsTowardAbuse,
  type RejectionCode,
  rejectionReason,
  storedExtension,
  UPLOAD_LIMITS,
  validateUpload,
} from "./validate.js";

// SE-003 / SE-005 upload pipeline:
//   1. record a "quarantined" row and write raw bytes to a private quarantine
//      path (never served, octet-stream content type);
//   2. validate extension / declared MIME / magic bytes / structure;
//   3. malware scan hook (currently not_configured, see scan.ts);
//   4. CDR for images (decode + re-encode, metadata stripped);
//   5. write the sanitised file to files/<userId>/<uploadId>.<ext>, delete the
//      quarantine object, mark "available".
// Any failure fails closed: row "rejected" with a code, blobs deleted, audit
// warn event (no file contents), abuse counter incremented.

export type ProcessUploadInput = {
  userId: string;
  bytes: Buffer;
  filename: string;
  declaredMime: string | null;
  purpose: UploadPurpose;
  homeId: string | null;
  roomId: string | null;
};

export type ProcessUploadResult =
  | { ok: true; upload: UploadRow }
  | {
      ok: false;
      uploadId: string;
      code: RejectionCode;
      reason: UploadRejectionReason;
    };

export function sha256Hex(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function processUpload(
  input: ProcessUploadInput,
): Promise<ProcessUploadResult> {
  const db = getDb();
  const id = randomUUID();
  const sha256 = sha256Hex(input.bytes);
  const fn = checkFilename(input.filename);
  const originalName = fn.ok ? fn.name : "upload";
  const qPath = quarantinePath(input.userId, id);
  let finalPath: string | null = null;

  await db.insert(schema.uploads).values({
    id,
    userId: input.userId,
    homeId: input.homeId,
    roomId: input.roomId,
    purpose: input.purpose,
    originalName,
    declaredMime: input.declaredMime?.slice(0, 100) ?? null,
    sizeBytes: input.bytes.length,
    sha256,
    status: "quarantined",
    scanStatus: "not_configured",
    blobPathname: null,
  });

  const reject = async (
    code: RejectionCode,
    extra: Record<string, unknown> = {},
  ): Promise<ProcessUploadResult> => {
    await deleteQuietly([qPath, finalPath]);
    try {
      await db
        .update(schema.uploads)
        .set({ status: "rejected", rejectionCode: code, blobPathname: null })
        .where(eq(schema.uploads.id, id));
      await audit("upload.rejected", {
        userId: input.userId,
        severity: "warn",
        payload: {
          uploadId: id,
          code,
          purpose: input.purpose,
          sizeBytes: input.bytes.length,
          sha256,
          ...extra,
        },
      });
      if (countsTowardAbuse(code)) await recordRejection(input.userId, code);
    } catch (err) {
      console.error("upload rejection bookkeeping failed", String(err));
    }
    return { ok: false, uploadId: id, code, reason: rejectionReason(code) };
  };

  try {
    // Oversize / empty files are rejected before anything is stored.
    if (input.bytes.length === 0) return await reject("empty_file");
    if (input.bytes.length > UPLOAD_LIMITS.maxBytes) {
      return await reject("size_exceeded");
    }

    await putPrivate(qPath, input.bytes, "application/octet-stream");
    await db
      .update(schema.uploads)
      .set({ blobPathname: qPath })
      .where(eq(schema.uploads.id, id));

    const v = validateUpload({
      bytes: input.bytes,
      filename: input.filename,
      declaredMime: input.declaredMime,
      purpose: input.purpose,
    });
    if (!v.ok) return await reject(v.code);

    const verdict = await scanFile({
      bytes: input.bytes,
      mime: v.mime,
      sha256,
    });
    if (verdict === "infected") return await reject("scan_infected");
    if (verdict === "error") return await reject("scan_error");
    if (verdict === "not_configured" && scanRequired()) {
      return await reject("scan_required");
    }

    let stored = input.bytes;
    let widthPx = v.widthPx;
    let heightPx = v.heightPx;
    if (v.mime !== "application/pdf") {
      const clean = await sanitizeImage(input.bytes, v.mime);
      if (!clean.ok) return await reject(clean.code, { mime: v.mime });
      stored = clean.bytes;
      widthPx = clean.widthPx;
      heightPx = clean.heightPx;
    }
    // PDFs: structural validation only. CDR (rasterising pages into a new
    // file) is a documented gap; see the route header.

    finalPath = filePath(input.userId, id, storedExtension(v.mime));
    await putPrivate(finalPath, stored, v.mime);

    const [row] = await db
      .update(schema.uploads)
      .set({
        status: "available",
        scanStatus: verdict,
        detectedMime: v.mime,
        widthPx,
        heightPx,
        pageCount: v.pageCount,
        blobPathname: finalPath,
      })
      .where(eq(schema.uploads.id, id))
      .returning();
    await deleteQuietly([qPath]);
    if (!row) throw new Error("upload row vanished");

    await audit("upload.accepted", {
      userId: input.userId,
      payload: {
        uploadId: id,
        purpose: input.purpose,
        mime: v.mime,
        sizeBytes: input.bytes.length,
        storedBytes: stored.length,
        scanStatus: verdict,
      },
    }).catch(() => {});
    return { ok: true, upload: row };
  } catch (err) {
    console.error("upload processing failed", String(err));
    return await reject("processing_error");
  }
}
