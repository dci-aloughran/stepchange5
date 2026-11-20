import type { UploadDto } from "@stepchange/shared";
import type { schema } from "../../db/client.js";
import { type RejectionCode, rejectionReason } from "./validate.js";

export type UploadRow = typeof schema.uploads.$inferSelect;

/** Metadata-only view of an upload. Never includes blob paths or codes. */
export function toUploadDto(row: UploadRow): UploadDto {
  return {
    id: row.id,
    purpose: row.purpose,
    status: row.status,
    scanStatus: row.scanStatus,
    homeId: row.homeId,
    roomId: row.roomId,
    originalName: row.originalName,
    mimeType: row.detectedMime,
    sizeBytes: row.sizeBytes,
    widthPx: row.widthPx,
    heightPx: row.heightPx,
    pageCount: row.pageCount,
    rejectionReason:
      row.status === "rejected"
        ? rejectionReason(
            (row.rejectionCode ?? "processing_error") as RejectionCode,
          )
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
