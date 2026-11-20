// Room photo upload helpers (copied from the floor-plan upload pattern so the
// plan area doesn't depend on that component's internals).

import { UPLOAD_MAX_BYTES } from "@stepchange/shared";
import { ApiError, SERVER_URL } from "@/lib/server";

export const PHOTO_ACCEPT = "image/png,image/jpeg";

// Phone photos are often over the 4 MB limit; shrink images before upload.
export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= UPLOAD_MAX_BYTES * 0.9) {
    return file;
  }
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, 3200 / Math.max(bitmap.width, bitmap.height));
  for (let attempt = 0; attempt < 5; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (blob && blob.size <= UPLOAD_MAX_BYTES * 0.9) {
      const name = file.name.replace(/\.[^.]+$/, "") || "room-photo";
      return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
    }
    scale *= 0.75;
  }
  throw new Error("This image is too large. Try a smaller photo.");
}

export function uploadWithProgress(
  form: FormData,
  token: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<{ upload: { id: string; status?: string } }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SERVER_URL}/uploads`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: { error?: string; upload?: { id: string; status?: string } } =
        {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && body.upload) {
        resolve({ upload: body.upload });
      } else {
        reject(
          new ApiError(
            body.error ?? "We couldn't accept that photo. Please try again.",
            xhr.status,
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
