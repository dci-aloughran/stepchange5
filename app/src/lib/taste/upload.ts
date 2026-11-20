// Browser-only helpers for inspiration photo uploads (SE-001).
import {
  UPLOAD_ALLOWED_MIME,
  UPLOAD_MAX_BYTES,
  type UploadDto,
} from "@stepchange/shared";
import { ApiError, SERVER_URL } from "@/lib/server";

const ALLOWED = UPLOAD_ALLOWED_MIME.inspiration as readonly string[];
export const INSPIRATION_ACCEPT = ALLOWED.join(",");
const TARGET = UPLOAD_MAX_BYTES * 0.9;

/**
 * Phone photos are often over the 4 MB limit, and some formats (e.g. HEIC)
 * aren't accepted; re-encode those to JPEG in the browser before upload.
 */
export async function prepareImage(file: File): Promise<File> {
  if (ALLOWED.includes(file.type) && file.size <= TARGET) return file;
  if (!file.type.startsWith("image/") && file.type !== "") {
    throw new Error("Please choose a photo or screenshot (PNG, JPEG or WebP).");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      "We couldn't open this image. Try a PNG or JPEG screenshot instead.",
    );
  }
  let scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  for (let attempt = 0; attempt < 5; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (blob && blob.size <= TARGET) {
      bitmap.close();
      const name = file.name.replace(/\.[^.]+$/, "") || "inspiration";
      return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
    }
    scale *= 0.75;
  }
  bitmap.close();
  throw new Error("This image is too large. Try a smaller photo.");
}

/** POST /uploads with progress (fetch can't report upload progress). */
export function uploadInspiration(
  file: File,
  token: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<UploadDto> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.set("file", file);
    form.set("purpose", "inspiration");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SERVER_URL}/uploads`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      let body: { error?: string; upload?: UploadDto } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && body.upload) {
        resolve(body.upload);
      } else {
        reject(
          new ApiError(
            body.error ?? "We couldn't accept that file. Please try again.",
            xhr.status,
            body,
          ),
        );
      }
    };
    xhr.onerror = () =>
      reject(new ApiError("Upload failed. Check your connection.", 0));
    xhr.onabort = () => reject(new DOMException("Cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}
