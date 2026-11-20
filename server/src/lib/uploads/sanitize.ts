import type { UploadMime } from "@stepchange/shared";
import sharp from "sharp";
import { UPLOAD_LIMITS } from "./validate.js";

// SE-003 content disarm and reconstruction for raster images: decode the
// pixels and re-encode a brand-new file. Anything that is not pixel data
// (EXIF incl. GPS location, XMP, ICC tricks, trailing polyglot payloads,
// extra animation frames, comments) is discarded.
//
// SE-004 gap: decoding runs in-process with libvips (sharp), bounded by
// limitInputPixels, a single page/frame, a timeout and disabled caching. It is
// NOT an isolated least-privilege sandbox; see docs in the uploads route.

// Keep libvips memory use predictable on serverless instances.
sharp.cache(false);
sharp.concurrency(1);

const DECODED_FORMAT: Record<string, UploadMime> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export type SanitizedImage =
  | {
      ok: true;
      bytes: Buffer;
      mime: UploadMime;
      widthPx: number;
      heightPx: number;
    }
  | {
      ok: false;
      code: "decode_failed" | "decoded_type_mismatch" | "pixel_limit";
    };

export async function sanitizeImage(
  input: Buffer,
  expected: UploadMime,
): Promise<SanitizedImage> {
  const opts = {
    limitInputPixels: UPLOAD_LIMITS.maxPixels,
    failOn: "error" as const,
    pages: 1,
    sequentialRead: true,
  };
  try {
    // Parser-detected type: libvips must agree with magic bytes + extension.
    const meta = await sharp(input, opts).metadata();
    if (!meta.format || DECODED_FORMAT[meta.format] !== expected) {
      return { ok: false, code: "decoded_type_mismatch" };
    }
    if (
      !meta.width ||
      !meta.height ||
      meta.width * meta.height > UPLOAD_LIMITS.maxPixels
    ) {
      return { ok: false, code: "pixel_limit" };
    }

    // .rotate() bakes EXIF orientation into pixels before metadata is
    // dropped (sharp strips all metadata by default on output).
    let pipeline = sharp(input, opts).rotate().timeout({ seconds: 15 });
    if (expected === "image/png") {
      pipeline = pipeline.png({ compressionLevel: 9 });
    } else if (expected === "image/jpeg") {
      pipeline = pipeline.jpeg({ quality: 88, mozjpeg: true });
    } else {
      pipeline = pipeline.webp({ quality: 88 });
    }
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      ok: true,
      bytes: data,
      mime: expected,
      widthPx: info.width,
      heightPx: info.height,
    };
  } catch (err) {
    const msg = String(err);
    if (/pixel limit/i.test(msg)) return { ok: false, code: "pixel_limit" };
    return { ok: false, code: "decode_failed" };
  }
}
