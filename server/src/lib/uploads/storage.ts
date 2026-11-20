import { del, get, issueSignedToken, presignUrl, put } from "@vercel/blob";

// Private Vercel Blob storage for uploads. Nothing here is ever public:
// reads go through the authenticated API or short-lived presigned URLs.

export function quarantinePath(userId: string, uploadId: string) {
  return `quarantine/${userId}/${uploadId}`;
}

export function filePath(userId: string, uploadId: string, ext: string) {
  return `files/${userId}/${uploadId}.${ext}`;
}

export async function putPrivate(
  pathname: string,
  body: Buffer,
  contentType: string,
) {
  return put(pathname, body, {
    access: "private",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function readPrivate(
  pathname: string,
  maxBytes: number,
): Promise<Buffer | null> {
  const res = await get(pathname, { access: "private", useCache: false });
  if (res?.statusCode !== 200) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("blob exceeds expected size");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Delete blobs; throws if the store refuses (missing blobs are fine). */
export async function deleteBlobs(pathnames: Array<string | null>) {
  const list = pathnames.filter((p): p is string => !!p);
  if (list.length > 0) await del(list);
}

/** Best-effort delete; never throws (used on failure paths). */
export async function deleteQuietly(pathnames: Array<string | null>) {
  const list = pathnames.filter((p): p is string => !!p);
  if (list.length === 0) return;
  try {
    await del(list);
  } catch (err) {
    console.error("blob delete failed", String(err));
  }
}

/** Short-lived presigned GET URL for a private blob. */
export async function presignedGetUrl(pathname: string, ttlSeconds: number) {
  const validUntil = Date.now() + ttlSeconds * 1000;
  const token = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil,
  });
  const { presignedUrl } = await presignUrl(token, {
    operation: "get",
    pathname,
    validUntil,
    access: "private",
  });
  return { url: presignedUrl, expiresAt: new Date(validUntil) };
}
