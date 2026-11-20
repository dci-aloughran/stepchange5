import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { inspectPdf } from "./pdf.js";
import { sanitizeImage } from "./sanitize.js";
import {
  checkFilename,
  detectMime,
  jpegHeader,
  pngHeader,
  rejectionReason,
  validateUpload,
  webpHeader,
} from "./validate.js";

function pngBytes(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function jpegBytes(width: number, height: number): Buffer {
  // SOI, APP0 (len 16), SOF0 (len 17)
  const app0 = Buffer.alloc(18);
  app0[0] = 0xff;
  app0[1] = 0xe0;
  app0.writeUInt16BE(16, 2);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

function pdf(body: string, opts: { header?: string; trailer?: boolean } = {}) {
  const header = opts.header ?? "%PDF-1.7\n";
  const trailer =
    opts.trailer === false
      ? ""
      : "\nxref\ntrailer\n<<>>\nstartxref\n0\n%%EOF\n";
  return Buffer.from(`${header}${body}${trailer}`, "latin1");
}

function pages(n: number) {
  let s = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count ${n} /Kids [] >>\nendobj\n`;
  for (let i = 0; i < n; i++) {
    s += `${i + 3} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n`;
  }
  return s;
}

describe("checkFilename", () => {
  it("accepts ordinary names", () => {
    expect(checkFilename("plan.pdf")).toMatchObject({
      ok: true,
      extension: "pdf",
    });
    expect(checkFilename("My House v2.final.JPG")).toMatchObject({
      ok: true,
      extension: "jpg",
    });
  });

  it("strips client paths", () => {
    expect(checkFilename("C:\\Users\\me\\plan.png")).toMatchObject({
      ok: true,
      name: "plan.png",
    });
    expect(checkFilename("../../etc/plan.png")).toMatchObject({
      ok: true,
      name: "plan.png",
    });
  });

  it.each([
    "x.php.jpg",
    "plan.pdf.png",
    "photo.jpg.png",
    "invoice.exe.pdf",
    "a.HTML.jpeg",
  ])("rejects double extension %s", (name) => {
    expect(checkFilename(name)).toEqual({
      ok: false,
      code: "double_extension",
    });
  });

  it.each([
    "",
    "noext",
    ".png",
    "plan.pdf.",
    "plan.pdf ",
    "pl\u0000an.png",
    "gpj\u202e.exe",
  ])("rejects malformed name %j", (name) => {
    expect(checkFilename(name)).toMatchObject({ ok: false });
  });
});

describe("detectMime / headers", () => {
  it("detects signatures", () => {
    expect(detectMime(pngBytes(10, 10))).toBe("image/png");
    expect(detectMime(jpegBytes(10, 10))).toBe("image/jpeg");
    expect(detectMime(pdf(pages(1)))).toBe("application/pdf");
    expect(detectMime(Buffer.from("MZ\x90\x00\x03\x00\x00\x00"))).toBeNull();
    expect(detectMime(Buffer.from("<svg xmlns='x'></svg>"))).toBeNull();
    expect(detectMime(Buffer.from("GIF89a......"))).toBeNull();
  });

  it("reads dimensions", () => {
    expect(pngHeader(pngBytes(640, 480))).toEqual({ width: 640, height: 480 });
    expect(jpegHeader(jpegBytes(1200, 900))).toEqual({
      width: 1200,
      height: 900,
    });
  });

  it("reads webp dimensions", async () => {
    const webp = await sharp({
      create: { width: 33, height: 21, channels: 3, background: "#fff" },
    })
      .webp()
      .toBuffer();
    expect(detectMime(webp)).toBe("image/webp");
    expect(webpHeader(webp)).toEqual({ width: 33, height: 21 });
  });
});

describe("validateUpload", () => {
  const base = { declaredMime: null, purpose: "floor_plan" as const };

  it("accepts a valid PNG floor plan", () => {
    const r = validateUpload({
      ...base,
      bytes: pngBytes(800, 600),
      filename: "plan.png",
      declaredMime: "image/png",
    });
    expect(r).toMatchObject({
      ok: true,
      mime: "image/png",
      widthPx: 800,
      heightPx: 600,
    });
  });

  it("accepts a valid JPEG with image/jpg alias", () => {
    const r = validateUpload({
      ...base,
      bytes: jpegBytes(100, 100),
      filename: "plan.jpeg",
      declaredMime: "image/jpg",
    });
    expect(r).toMatchObject({ ok: true, mime: "image/jpeg" });
  });

  it("accepts a valid PDF and counts pages", () => {
    const r = validateUpload({
      ...base,
      bytes: pdf(pages(3)),
      filename: "plan.pdf",
      declaredMime: "application/pdf",
    });
    expect(r).toMatchObject({ ok: true, pageCount: 3 });
  });

  it("rejects mismatched magic bytes (PNG named .pdf)", () => {
    const r = validateUpload({
      ...base,
      bytes: pngBytes(10, 10),
      filename: "plan.pdf",
    });
    expect(r).toMatchObject({ ok: false, code: "signature_mismatch" });
  });

  it("rejects declared MIME that disagrees with extension", () => {
    const r = validateUpload({
      ...base,
      bytes: pngBytes(10, 10),
      filename: "plan.png",
      declaredMime: "text/html",
    });
    expect(r).toMatchObject({ ok: false, code: "declared_mime_mismatch" });
  });

  it("rejects unknown signatures (executable renamed .png)", () => {
    const r = validateUpload({
      ...base,
      bytes: Buffer.from("MZ\x90\x00 this is a PE file", "latin1"),
      filename: "plan.png",
    });
    expect(r).toMatchObject({ ok: false, code: "signature_unknown" });
  });

  it("rejects double extensions", () => {
    const r = validateUpload({
      ...base,
      bytes: jpegBytes(10, 10),
      filename: "x.php.jpg",
    });
    expect(r).toMatchObject({ ok: false, code: "double_extension" });
    expect(rejectionReason("double_extension")).toBe("invalid_file");
  });

  it("rejects disallowed extensions per purpose", () => {
    expect(
      validateUpload({ ...base, bytes: Buffer.from("x"), filename: "a.exe" }),
    ).toMatchObject({ ok: false, code: "extension_not_allowed" });
    // PDFs are floor-plan only.
    expect(
      validateUpload({
        ...base,
        purpose: "room_photo",
        bytes: pdf(pages(1)),
        filename: "a.pdf",
      }),
    ).toMatchObject({ ok: false, code: "extension_not_allowed" });
    // WebP is not a floor-plan format.
    expect(
      validateUpload({ ...base, bytes: Buffer.from("x"), filename: "a.webp" }),
    ).toMatchObject({ ok: false, code: "extension_not_allowed" });
  });

  it("rejects oversize and empty files", () => {
    const big = Buffer.concat([
      pngBytes(10, 10),
      Buffer.alloc(4 * 1024 * 1024),
    ]);
    expect(
      validateUpload({ ...base, bytes: big, filename: "a.png" }),
    ).toMatchObject({ ok: false, code: "size_exceeded" });
    expect(rejectionReason("size_exceeded")).toBe("too_large");
    expect(
      validateUpload({ ...base, bytes: Buffer.alloc(0), filename: "a.png" }),
    ).toMatchObject({ ok: false, code: "empty_file" });
  });

  it("rejects images over the pixel limit (decompression bomb)", () => {
    const r = validateUpload({
      ...base,
      bytes: pngBytes(50_000, 50_000),
      filename: "a.png",
    });
    expect(r).toMatchObject({ ok: false, code: "pixel_limit" });
  });

  it("rejects a PNG signature without IHDR", () => {
    const b = pngBytes(10, 10);
    b.write("XXXX", 12, "latin1");
    expect(
      validateUpload({ ...base, bytes: b, filename: "a.png" }),
    ).toMatchObject({ ok: false, code: "image_header_invalid" });
  });
});

describe("inspectPdf", () => {
  it("rejects missing header / trailer", () => {
    expect(inspectPdf(pdf(pages(1), { header: "%PDX-1.7\n" }), 20)).toEqual({
      ok: false,
      code: "pdf_structure",
    });
    expect(inspectPdf(pdf(pages(1), { trailer: false }), 20)).toEqual({
      ok: false,
      code: "pdf_structure",
    });
    // Header not at offset 0 (polyglot trick).
    expect(inspectPdf(pdf(pages(1), { header: "junk%PDF-1.7\n" }), 20)).toEqual(
      { ok: false, code: "pdf_structure" },
    );
  });

  it("rejects PDFs without pages", () => {
    expect(inspectPdf(pdf("1 0 obj\n<< >>\nendobj\n"), 20)).toEqual({
      ok: false,
      code: "pdf_structure",
    });
  });

  it("rejects too many pages", () => {
    expect(inspectPdf(pdf(pages(21)), 20)).toEqual({
      ok: false,
      code: "pdf_too_many_pages",
    });
    // Lying /Count is caught by counting page objects.
    const lying = pages(25).replace("/Count 25", "/Count 1");
    expect(inspectPdf(pdf(lying), 20)).toEqual({
      ok: false,
      code: "pdf_too_many_pages",
    });
  });

  it.each([
    "<< /Type /Action /S /JavaScript /JS (app.alert(1)) >>",
    "<< /OpenAction << /S /JavaScript /JS 9 0 R >> >>",
    "<< /S /Launch /F (cmd.exe) >>",
    "<< /Names << /EmbeddedFiles 5 0 R >> >>",
    "<< /Type /EmbeddedFile >>",
    "<< /AA << /O 7 0 R >> >>",
    "<< /RichMedia 1 0 R >>",
    "<< /AcroForm << /XFA 3 0 R >> >>",
    "<< /S /J#61vaScript >>",
  ])("rejects active content %s", (dict) => {
    const r = inspectPdf(pdf(`${pages(1)}9 0 obj\n${dict}\nendobj\n`), 20);
    expect(r).toEqual({ ok: false, code: "pdf_active_content" });
  });

  it("rejects active content hidden in a compressed object stream", () => {
    const hidden = deflateSync(Buffer.from("<< /S /JavaScript /JS (x) >>"));
    const body = `${pages(1)}9 0 obj\n<< /Type /ObjStm /N 1 /First 0 /Filter /FlateDecode /Length ${hidden.length} >>\nstream\n`;
    const buf = Buffer.concat([
      Buffer.from(`%PDF-1.7\n${body}`, "latin1"),
      hidden,
      Buffer.from(
        "\nendstream\nendobj\nxref\ntrailer\n<<>>\nstartxref\n0\n%%EOF\n",
        "latin1",
      ),
    ]);
    expect(inspectPdf(buf, 20)).toEqual({
      ok: false,
      code: "pdf_active_content",
    });
  });

  it("rejects object streams it cannot inspect", () => {
    const body = `${pages(1)}9 0 obj\n<< /Type /ObjStm /Filter /LZWDecode /Length 3 >>\nstream\nabc\nendstream\nendobj\n`;
    expect(inspectPdf(pdf(body), 20)).toEqual({
      ok: false,
      code: "pdf_unverifiable",
    });
  });

  it("ignores names inside binary content streams", () => {
    // A page content stream whose bytes happen to contain "/JS " must not
    // trigger a false positive.
    const body = `${pages(1)}9 0 obj\n<< /Length 10 >>\nstream\n\x00\x01/JS \x02\x03\nendstream\nendobj\n`;
    expect(inspectPdf(pdf(body), 20)).toMatchObject({ ok: true, pageCount: 1 });
  });

  it("rejects encrypted PDFs and HTML polyglots", () => {
    expect(
      inspectPdf(pdf(`${pages(1)}trailer << /Encrypt 5 0 R >>\n`), 20),
    ).toEqual({ ok: false, code: "pdf_encrypted" });
    expect(
      inspectPdf(pdf(`${pages(1)}<script>alert(1)</script>\n`), 20),
    ).toEqual({ ok: false, code: "polyglot" });
  });
});

describe("sanitizeImage (CDR)", () => {
  it("re-encodes and strips EXIF metadata including GPS", async () => {
    const original = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "#c00" },
    })
      .jpeg()
      .withExif({
        IFD0: { Make: "TestCam", Copyright: "secret" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1" },
      })
      .toBuffer();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const r = await sanitizeImage(original, "image/jpeg");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const meta = await sharp(r.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(r.widthPx).toBe(40);
    expect(r.heightPx).toBe(30);
  });

  it("drops trailing polyglot payloads", async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    const polyglot = Buffer.concat([
      png,
      Buffer.from("<?php system($_GET[1]);"),
    ]);
    const r = await sanitizeImage(polyglot, "image/png");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bytes.includes(Buffer.from("<?php"))).toBe(false);
  });

  it("rejects when libvips disagrees with the detected type", async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    expect(await sanitizeImage(png, "image/jpeg")).toEqual({
      ok: false,
      code: "decoded_type_mismatch",
    });
  });

  it("rejects truncated / corrupt images", async () => {
    const r = await sanitizeImage(jpegBytes(100, 100), "image/jpeg");
    expect(r.ok).toBe(false);
  });
});
