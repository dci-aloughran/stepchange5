import { createHash } from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import { audit } from "../audit.js";

// One-way hash so audit rows can be correlated with a support request
// without storing the account identifier.
export const subjectHash = (userId: string) =>
  createHash("sha256").update(userId).digest("hex");

export type IdentityDeletion =
  | { deleted: true; alreadyGone?: boolean }
  | { deleted: false; reason: string };

// SE-008: after the user's data is gone, delete the Clerk identity too so a
// later sign-in doesn't silently recreate an empty account. Never throws:
// the data deletion has already succeeded, so a failure here is audited as a
// warning for follow-up instead of failing the user's request.
export async function deleteClerkUser(
  userId: string,
): Promise<IdentityDeletion> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  let result: IdentityDeletion;
  if (!secretKey) {
    result = { deleted: false, reason: "clerk_secret_key_missing" };
  } else {
    try {
      await createClerkClient({ secretKey }).users.deleteUser(userId);
      result = { deleted: true };
    } catch (err) {
      const status = (err as { status?: unknown } | null)?.status;
      result =
        status === 404
          ? { deleted: true, alreadyGone: true }
          : {
              deleted: false,
              reason:
                typeof status === "number" ? `clerk_http_${status}` : "error",
            };
      if (!result.deleted) console.error("Clerk user delete failed", err);
    }
  }
  if (!result.deleted) {
    try {
      await audit("account.identity_delete_failed", {
        userId: null,
        severity: "warn",
        payload: { subjectHash: subjectHash(userId), reason: result.reason },
      });
    } catch (err) {
      console.error("audit failed", err);
    }
  }
  return result;
}
