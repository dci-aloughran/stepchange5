import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

type Issue = { path: PropertyKey[]; message: string };

export function formatIssue(issue: Issue | undefined): string {
  if (!issue) return "Invalid request";
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

// zValidator that reports failures through HTTPException so every error
// response is `{ error }`. Malformed path ids are reported as 404 so we never
// reveal whether a resource exists.
export const validate = <
  T extends z.ZodType,
  Target extends keyof ValidationTargets,
>(
  target: Target,
  schema: T,
) =>
  zValidator(target, schema, (result) => {
    if (result.success) return;
    if (target === "param") {
      throw new HTTPException(404, { message: "Not found" });
    }
    throw new HTTPException(400, {
      message: formatIssue(result.error.issues[0]),
    });
  });

export const uuidParam = z.uuid();
