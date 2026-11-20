import {
  UPLOAD_ALLOWED_MIME,
  UPLOAD_EXTENSIONS,
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_PDF_PAGES,
  UPLOAD_MAX_PIXELS,
  type UploadMime,
  type UploadPurpose,
  type UploadRejectionReason,
} from "@stepchange/shared";
import { inspectPdf, type PdfRejectionCode } from "./pdf.js";

// Pure, synchronous upload validation (SE-001 / SE-002). No I/O, no DB, so it
// can be unit tested with crafted buffers. Image decoding / re-encoding (CDR)
// happens afterwards in sanitize.ts.

export type RejectionCode =
  | "empty_file"
  | "size_exceeded"
  | "filename_invalid"
  | "double_extension"
  | "extension_not_allowed"
  | "declared_mime_mismatch"
  | "signature_unknown"
  | "signature_mismatch"
  | "image_header_invalid"
  | "pixel_limit"
  | "decode_failed"
  | "decoded_type_mismatch"
  | "scan_infected"
  | "scan_error"
  | "scan_required"
  | "processing_error"
  | PdfRejectionCode;

export const UPLOAD_LIMITS = {
  maxBytes: UPLOAD_MAX_BYTES,
  maxPixels: UPLOAD_MAX_PIXELS,
  maxPdfPages: UPLOAD_MAX_PDF_PAGES,
  maxFilenameLength: 200,
} as const;

/** Map an internal rejection code to the coarse user-safe reason (SE-005). */
export function rejectionReason(code: RejectionCode): UploadRejectionReason {
  switch (code) {
    case "size_exceeded":
      return "too_large";
    case "extension_not_allowed":
    case "pdf_too_many_pages":
    case "pixel_limit":
      return "unsupported_type";
    case "processing_error":
    case "scan_error":
      return "processing_error";
    default:
      return "invalid_file";
  }
}

/** Codes that indicate a likely-malicious or malformed file (SE-006). */
export function countsTowardAbuse(code: RejectionCode): boolean {
  return code !== "processing_error" && code !== "scan_error";
}

/**
 * Extensions that must never appear as an inner segment of a filename
 * (`x.php.jpg`, `plan.pdf.exe`, `photo.jpg.png`). Includes executables,
 * scripts, archives, office/active documents and the allowlisted types
 * themselves (a second media extension is a classic disguise).
 */
const RISKY_INNER_EXTENSIONS = new Set([
  // executables / installers
  "exe",
  "com",
  "bat",
  "cmd",
  "msi",
  "msp",
  "scr",
  "pif",
  "cpl",
  "dll",
  "sys",
  "app",
  "dmg",
  "pkg",
  "deb",
  "rpm",
  "apk",
  "ipa",
  "bin",
  "elf",
  "so",
  "jar",
  "run",
  "out",
  // scripts
  "sh",
  "bash",
  "zsh",
  "ps1",
  "psm1",
  "vbs",
  "vbe",
  "js",
  "mjs",
  "cjs",
  "jse",
  "ts",
  "wsf",
  "wsh",
  "hta",
  "py",
  "pl",
  "rb",
  "php",
  "php3",
  "php4",
  "php5",
  "phtml",
  "phar",
  "asp",
  "aspx",
  "jsp",
  "cgi",
  "lnk",
  "reg",
  "scf",
  "inf",
  // markup / active documents
  "html",
  "htm",
  "xhtml",
  "shtml",
  "svg",
  "svgz",
  "xml",
  "xsl",
  "swf",
  "doc",
  "docm",
  "docx",
  "xls",
  "xlsm",
  "xlsx",
  "ppt",
  "pptm",
  "pptx",
  "rtf",
  "odt",
  "iso",
  "img",
  "vhd",
  // archives
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "cab",
  // media (allowlisted or otherwise) used as a disguise
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "heif",
  "avif",
  "ico",
]);

export type FilenameCheck =
  | { ok: true; name: string; extension: string }
  | { ok: false; code: RejectionCode };

/** Validate a client-supplied filename and extract its extension. */
export function checkFilename(raw: string): FilenameCheck {
  // Reduce to a basename; never trust client paths.
  const base = raw.split(/[\\/]/).pop() ?? "";
  if (!base || /\p{Cc}/u.test(base)) {
    return { ok: false, code: "filename_invalid" };
  }
  if (base.length > 255) return { ok: false, code: "filename_invalid" };
  // Trailing dots/spaces are stripped by some filesystems (plan.exe. -> exe).
  if (/[.\s]$/.test(base)) return { ok: false, code: "filename_invalid" };
  // Unicode bidi overrides can disguise extensions (e.g. "gpj.exe").
  if (/[\u202a-\u202e\u2066-\u2069\u200e\u200f]/.test(base)) {
    return { ok: false, code: "filename_invalid" };
  }

  const segments = base.split(".");
  if (segments.length < 2 || !segments[0]?.trim()) {
    return { ok: false, code: "filename_invalid" };
  }
  const extension = (segments.at(-1) ?? "").toLowerCase();
  const inner = segments.slice(1, -1).map((s) => s.trim().toLowerCase());
  if (inner.some((s) => RISKY_INNER_EXTENSIONS.has(s))) {
    return { ok: false, code: "double_extension" };
  }
  const name =
    base.length > UPLOAD_LIMITS.maxFilenameLength
      ? `${base.slice(0, UPLOAD_LIMITS.maxFilenameLength - extension.length - 1)}.${extension}`
      : base;
  return { ok: true, name, extension };
}

/** MIME type implied by an extension, if allowlisted at all. */
export function mimeForExtension(ext: string): UploadMime | null {
  for (const [mime, exts] of Object.entries(UPLOAD_EXTENSIONS)) {
    if (exts.includes(ext)) return mime as UploadMime;
  }
  return null;
}

const DECLARED_MIME_ALIASES: Record<string, UploadMime> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
  "application/x-pdf": "application/pdf",
};

/** Normalise a client-declared MIME; null means "not declared". */
export function normaliseDeclaredMime(declared: string | undefined | null) {
  const d = (declared ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!d || d === "application/octet-stream") return null;
  return DECLARED_MIME_ALIASES[d] ?? d;
}

/** Detect file type from magic bytes. Only allowlisted types are detected. */
export function detectMime(buf: Buffer): UploadMime | null {
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return "image/png";
  }
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buf.length >= 12 &&
    buf.toString("latin1", 0, 4) === "RIFF" &&
    buf.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (buf.length >= 8 && buf.toString("latin1", 0, 5) === "%PDF-") {
    return "application/pdf";
  }
  return null;
}

export type ImageHeader = { width: number; height: number };

/** Read PNG dimensions from IHDR. */
export function pngHeader(buf: Buffer): ImageHeader | null {
  if (buf.length < 24 || buf.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Read JPEG dimensions from the first SOFn marker (bounded scan). */
export function jpegHeader(buf: Buffer): ImageHeader | null {
  let i = 2;
  let guard = 0;
  while (i + 9 < buf.length && guard++ < 10_000) {
    if (buf[i] !== 0xff) return null;
    let marker = buf[i + 1] ?? 0;
    // Skip fill bytes.
    while (marker === 0xff && i + 2 < buf.length) {
      i += 1;
      marker = buf[i + 1] ?? 0;
    }
    if (
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker === 0x01
    ) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS before SOF
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      if (i + 9 > buf.length) return null;
      return {
        height: buf.readUInt16BE(i + 5),
        width: buf.readUInt16BE(i + 7),
      };
    }
    i += 2 + len;
  }
  return null;
}

/** Read WebP dimensions from VP8 / VP8L / VP8X chunk headers. */
export function webpHeader(buf: Buffer): ImageHeader | null {
  if (buf.length < 30) return null;
  const chunk = buf.toString("latin1", 12, 16);
  if (chunk === "VP8X") {
    return {
      width: 1 + buf.readUIntLE(24, 3),
      height: 1 + buf.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8L") {
    if (buf[20] !== 0x2f) return null;
    const b = buf.readUInt32LE(21);
    return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
  }
  if (chunk === "VP8 ") {
    // Frame tag (3 bytes) + start code 9d 01 2a.
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return {
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

export function imageHeader(mime: UploadMime, buf: Buffer): ImageHeader | null {
  switch (mime) {
    case "image/png":
      return pngHeader(buf);
    case "image/jpeg":
      return jpegHeader(buf);
    case "image/webp":
      return webpHeader(buf);
    default:
      return null;
  }
}

export type ValidationInput = {
  bytes: Buffer;
  filename: string;
  declaredMime?: string | null;
  purpose: UploadPurpose;
};

export type ValidationResult =
  | {
      ok: true;
      name: string;
      extension: string;
      mime: UploadMime;
      widthPx: number | null;
      heightPx: number | null;
      pageCount: number | null;
    }
  | { ok: false; code: RejectionCode; name: string };

/**
 * Validate size, filename, extension, declared MIME, magic bytes and the
 * structural (parser-detected) type. All checks must agree.
 */
export function validateUpload(input: ValidationInput): ValidationResult {
  const { bytes, purpose } = input;
  const fn = checkFilename(input.filename);
  const safeName = fn.ok ? fn.name : "upload";
  const reject = (code: RejectionCode): ValidationResult => ({
    ok: false,
    code,
    name: safeName,
  });

  if (bytes.length === 0) return reject("empty_file");
  if (bytes.length > UPLOAD_LIMITS.maxBytes) return reject("size_exceeded");
  if (!fn.ok) return reject(fn.code);

  const allowed = UPLOAD_ALLOWED_MIME[purpose];
  const extMime = mimeForExtension(fn.extension);
  if (!extMime || !allowed.includes(extMime)) {
    return reject("extension_not_allowed");
  }

  const declared = normaliseDeclaredMime(input.declaredMime);
  if (declared !== null && declared !== extMime) {
    return reject("declared_mime_mismatch");
  }

  const detected = detectMime(bytes);
  if (!detected) return reject("signature_unknown");
  if (detected !== extMime) return reject("signature_mismatch");

  if (detected === "application/pdf") {
    const pdf = inspectPdf(bytes, UPLOAD_LIMITS.maxPdfPages);
    if (!pdf.ok) return reject(pdf.code);
    return {
      ok: true,
      name: fn.name,
      extension: fn.extension,
      mime: detected,
      widthPx: null,
      heightPx: null,
      pageCount: pdf.pageCount,
    };
  }

  const header = imageHeader(detected, bytes);
  if (!header || header.width < 1 || header.height < 1) {
    return reject("image_header_invalid");
  }
  if (header.width * header.height > UPLOAD_LIMITS.maxPixels) {
    return reject("pixel_limit");
  }
  return {
    ok: true,
    name: fn.name,
    extension: fn.extension,
    mime: detected,
    widthPx: header.width,
    heightPx: header.height,
    pageCount: null,
  };
}

/** Canonical stored extension for a MIME type. */
export function storedExtension(mime: UploadMime): string {
  switch (mime) {
    case "application/pdf":
      return "pdf";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
  }
}
