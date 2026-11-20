import { constants, inflateSync } from "node:zlib";

// Bounded structural inspection of untrusted PDFs (SE-002 / SE-004).
//
// This is deliberately NOT a full PDF parser. It performs linear scans over
// the raw bytes (<= UPLOAD_MAX_BYTES) plus a capped amount of decompressed
// object-stream data, so its worst case is bounded in time and memory. Any
// construct it cannot verify (encryption, object streams with unsupported
// filters, inflation failures, budget exhaustion) is rejected: fail closed.
//
// Stream payloads (page content, images, fonts) are excluded from the name
// scan because compressed binary data would randomly match short names such
// as "/JS". Dictionaries, where actions and embedded files are declared, live
// outside streams or inside object streams (/ObjStm), which we inflate.

export type PdfInspection =
  | { ok: true; pageCount: number; version: string }
  | { ok: false; code: PdfRejectionCode };

export type PdfRejectionCode =
  | "pdf_structure"
  | "pdf_encrypted"
  | "pdf_active_content"
  | "pdf_unverifiable"
  | "pdf_too_many_pages"
  | "polyglot";

export const PDF_LIMITS = {
  /** Max stream objects of any kind. */
  maxStreams: 20_000,
  /** Max number of compressed object streams we will inflate. */
  maxObjectStreams: 500,
  /** Max decompressed bytes per object stream. */
  maxInflatePerStream: 8 * 1024 * 1024,
  /** Max decompressed bytes across all object streams. */
  maxInflateTotal: 32 * 1024 * 1024,
  /** Max name tokens scanned across raw + decompressed data. */
  maxNameTokens: 2_000_000,
} as const;

/**
 * PDF names that indicate active or embedded content. Compared after
 * decoding `#xx` escapes so `/J#61vaScript` is caught.
 */
export const PDF_ACTIVE_NAMES: ReadonlySet<string> = new Set([
  "JavaScript",
  "JS",
  "Launch",
  "EmbeddedFile",
  "EmbeddedFiles",
  "FileAttachment",
  "RichMedia",
  "XFA",
  "AA",
  "SubmitForm",
  "ImportData",
  "GoToR",
  "GoToE",
  "Movie",
  "Sound",
  "Rendition",
]);

const POLYGLOT_MARKERS = ["<script", "<?php", "<html", "<!doctype html"];

/** Decode `#xx` hex escapes in a PDF name token (without leading slash). */
export function decodePdfName(raw: string): string {
  if (!raw.includes("#")) return raw;
  return raw.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

// PDF delimiter and whitespace characters terminate a name token.
const NAME_RE = /\/([^\s/<>[\](){}%]*)/g;

type ScanState = {
  pageObjects: number;
  maxCount: number;
  active: boolean;
  encrypted: boolean;
  tokens: number;
  exhausted: boolean;
};

function scanNames(text: string, state: ScanState) {
  const re = new RegExp(NAME_RE.source, "g");
  let prev = "";
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    state.tokens += 1;
    if (state.tokens > PDF_LIMITS.maxNameTokens) {
      state.exhausted = true;
      return;
    }
    const name = decodePdfName(m[1] ?? "");
    if (PDF_ACTIVE_NAMES.has(name)) {
      state.active = true;
      return;
    }
    if (name === "Encrypt") state.encrypted = true;
    // The regex stops at delimiters, so "/Pages" is a different token.
    if (prev === "Type" && name === "Page") state.pageObjects += 1;
    if (name === "Count") {
      const after = text.slice(re.lastIndex, re.lastIndex + 24);
      const num = /^\s*(\d{1,6})/.exec(after);
      if (num?.[1]) state.maxCount = Math.max(state.maxCount, Number(num[1]));
    }
    prev = name;
    m = re.exec(text);
  }
}

type StreamSpan = { dict: string; dataStart: number; dataEnd: number };

/** Locate stream objects: their dictionary text and payload byte range. */
function findStreams(
  buf: Buffer,
  text: string,
): { ok: true; streams: StreamSpan[] } | { ok: false; code: PdfRejectionCode } {
  const streams: StreamSpan[] = [];
  let from = 0;
  for (;;) {
    const kw = text.indexOf("stream", from);
    if (kw === -1) break;
    from = kw + 6;
    if (kw >= 3 && text.slice(kw - 3, kw) === "end") continue;
    // "stream" must be a keyword followed by an EOL.
    const next = buf[kw + 6];
    if (next !== 0x0d && next !== 0x0a) continue;
    // The dictionary precedes the keyword; look back (bounded) to "obj".
    const head = text.slice(Math.max(0, kw - 4096), kw);
    const objIdx = head.lastIndexOf("obj");
    const dict = objIdx === -1 ? head : head.slice(objIdx + 3);
    let dataStart = kw + 6;
    if (buf[dataStart] === 0x0d) dataStart += 1;
    if (buf[dataStart] === 0x0a) dataStart += 1;
    const dataEnd = text.indexOf("endstream", dataStart);
    if (dataEnd === -1) return { ok: false, code: "pdf_structure" };
    streams.push({ dict, dataStart, dataEnd });
    if (streams.length > PDF_LIMITS.maxStreams) {
      return { ok: false, code: "pdf_unverifiable" };
    }
    from = dataEnd + 9;
  }
  return { ok: true, streams };
}

/** Raw text with stream payloads removed (dictionaries kept). */
function structureText(text: string, streams: StreamSpan[]): string {
  const parts: string[] = [];
  let pos = 0;
  for (const s of streams) {
    parts.push(text.slice(pos, s.dataStart));
    pos = s.dataEnd;
  }
  parts.push(text.slice(pos));
  return parts.join(" ");
}

function decodeNames(dict: string): string {
  return dict.replace(
    new RegExp(NAME_RE.source, "g"),
    (_, n: string) => `/${decodePdfName(n)}`,
  );
}

/** Inflate object streams (/Type /ObjStm) within budget. */
function inflateObjectStreams(
  buf: Buffer,
  streams: StreamSpan[],
): { ok: true; texts: string[] } | { ok: false; code: PdfRejectionCode } {
  const texts: string[] = [];
  let total = 0;
  let count = 0;
  for (const s of streams) {
    const dict = decodeNames(s.dict);
    if (!/\/Type\s*\/ObjStm\b/.test(dict)) continue;
    count += 1;
    if (count > PDF_LIMITS.maxObjectStreams) {
      return { ok: false, code: "pdf_unverifiable" };
    }
    // Only a single FlateDecode filter without predictors is supported;
    // anything else cannot be inspected and is rejected.
    const filters = dict.match(/\/[A-Za-z0-9]+Decode\b/g) ?? [];
    if (filters.length !== 1 || filters[0] !== "/FlateDecode") {
      return { ok: false, code: "pdf_unverifiable" };
    }
    if (/\/DecodeParms\b/.test(dict)) {
      return { ok: false, code: "pdf_unverifiable" };
    }
    const remaining = PDF_LIMITS.maxInflateTotal - total;
    if (remaining <= 0) return { ok: false, code: "pdf_unverifiable" };
    let out: Buffer;
    try {
      out = inflateSync(buf.subarray(s.dataStart, s.dataEnd), {
        maxOutputLength: Math.min(PDF_LIMITS.maxInflatePerStream, remaining),
        // Tolerate trailing EOL bytes before "endstream".
        finishFlush: constants.Z_SYNC_FLUSH,
      });
    } catch {
      return { ok: false, code: "pdf_unverifiable" };
    }
    total += out.length;
    texts.push(out.toString("latin1"));
  }
  return { ok: true, texts };
}

/**
 * Inspect an untrusted PDF buffer. Pure and synchronous; bounded by the
 * input size limit enforced by the caller plus PDF_LIMITS.
 */
export function inspectPdf(buf: Buffer, maxPages: number): PdfInspection {
  // Header must be at offset 0 (stricter than the spec's 1024-byte allowance,
  // which is a common polyglot trick).
  const header = buf.subarray(0, 16).toString("latin1");
  const hm = /^%PDF-([12]\.\d)/.exec(header);
  if (!hm?.[1]) return { ok: false, code: "pdf_structure" };

  // Trailer: %%EOF within the last 1 KiB and a startxref keyword.
  const tail = buf.subarray(Math.max(0, buf.length - 1024)).toString("latin1");
  if (!tail.includes("%%EOF") || !tail.includes("startxref")) {
    return { ok: false, code: "pdf_structure" };
  }

  const text = buf.toString("latin1");
  const found = findStreams(buf, text);
  if (!found.ok) return found;

  const structure = structureText(text, found.streams);
  const lower = structure.toLowerCase();
  if (POLYGLOT_MARKERS.some((m) => lower.includes(m))) {
    return { ok: false, code: "polyglot" };
  }

  const state: ScanState = {
    pageObjects: 0,
    maxCount: 0,
    active: false,
    encrypted: false,
    tokens: 0,
    exhausted: false,
  };

  scanNames(structure, state);
  if (state.active) return { ok: false, code: "pdf_active_content" };
  if (state.exhausted) return { ok: false, code: "pdf_unverifiable" };
  // Encrypted documents cannot be inspected (or read by the AI step).
  if (state.encrypted) return { ok: false, code: "pdf_encrypted" };

  const inflated = inflateObjectStreams(buf, found.streams);
  if (!inflated.ok) return inflated;
  for (const t of inflated.texts) {
    scanNames(t, state);
    if (state.active) return { ok: false, code: "pdf_active_content" };
    if (state.exhausted) return { ok: false, code: "pdf_unverifiable" };
  }

  // Enforce the limit on the larger signal (an attacker controls both), but
  // report the page-tree /Count when present since incremental updates can
  // duplicate page objects.
  const upperBound = Math.max(state.pageObjects, state.maxCount);
  if (upperBound < 1) return { ok: false, code: "pdf_structure" };
  if (upperBound > maxPages) return { ok: false, code: "pdf_too_many_pages" };
  const pageCount = state.maxCount > 0 ? state.maxCount : state.pageObjects;

  return { ok: true, pageCount, version: hm[1] };
}
