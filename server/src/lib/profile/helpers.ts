import {
  type AccessibilityNeedInput,
  AccessibilityNeedInputSchema,
  type PersonRole,
  type UpdateAccessibilityNeed,
} from "@stepchange/shared";
import { HTTPException } from "hono/http-exception";
import type { AccessibilityRow } from "./dto.js";
import { formatIssue } from "./validate.js";

// MB-005: shallow-merge autosaved journey state. A null value removes a key
// so the app can discard a draft without overwriting confirmed steps.
export function mergeJourneyState(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return next;
}

const ROLE_LABEL: Record<PersonRole, string> = {
  adult: "Adult",
  child: "Child",
  regular_visitor: "Visitor",
};

// SE-007: no names needed; default to "Child 2" etc.
export function defaultPersonLabel(
  role: PersonRole,
  existingLabels: string[],
): string {
  const base = ROLE_LABEL[role];
  const taken = new Set(existingLabels);
  let n = existingLabels.filter((l) => l.startsWith(`${base} `)).length + 1;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

// Merge a PATCH onto a stored need and re-validate the whole record, so a
// needType change must come with matching params. Switching scope clears the
// now-irrelevant room/person link.
export function mergeAccessibilityUpdate(
  current: AccessibilityRow,
  patch: UpdateAccessibilityNeed,
): AccessibilityNeedInput {
  const scope = patch.scope ?? current.scope;
  const merged = {
    scope,
    roomId:
      scope === "room"
        ? patch.roomId !== undefined
          ? patch.roomId
          : current.roomId
        : null,
    personId:
      scope === "person"
        ? patch.personId !== undefined
          ? patch.personId
          : current.personId
        : null,
    needType: patch.needType ?? current.needType,
    params: patch.params ?? current.params,
    confirmed: patch.confirmed ?? current.confirmed,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
  };
  const result = AccessibilityNeedInputSchema.safeParse(merged);
  if (!result.success) {
    throw new HTTPException(400, {
      message: formatIssue(result.error.issues[0]),
    });
  }
  return result.data;
}

// Normalise a validated need for insert/update: links not relevant to the
// scope are dropped.
export function accessibilityValues(input: AccessibilityNeedInput) {
  return {
    scope: input.scope,
    roomId: input.scope === "room" ? (input.roomId ?? null) : null,
    personId: input.scope === "person" ? (input.personId ?? null) : null,
    needType: input.needType,
    params: input.params as Record<string, unknown>,
    confirmed: input.confirmed ?? false,
    notes: input.notes ?? null,
  };
}
