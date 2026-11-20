import {
  BUYER_RETENTION_DAYS,
  NOT_PROCEEDING_RETENTION_DAYS,
} from "@stepchange/shared";

// Journey progress kept in this browser (see journey.tsx and rooms-step.tsx).
export const LOCAL_JOURNEY_KEYS = [
  "deloitful.journey",
  "deloitful.rooms",
] as const;

// Removes the locally saved journey so nothing is left behind on a shared
// device after signing out or deleting the account.
export function clearLocalJourneyData(storage: Pick<Storage, "removeItem">) {
  for (const key of LOCAL_JOURNEY_KEYS) {
    try {
      storage.removeItem(key);
    } catch {}
  }
}

export const DELETE_CONFIRM_WORD = "DELETE";

export function isDeleteConfirmed(input: string) {
  return input.trim().toUpperCase() === DELETE_CONFIRM_WORD;
}

// Uses the server's suggested filename when present.
export function filenameFromDisposition(
  header: string | null,
  now = new Date(),
) {
  const match = header?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const name = match?.[1]?.trim();
  if (name && /^[\w.-]+$/.test(name)) return name;
  return `deloitful-home-export-${now.toISOString().slice(0, 10)}.json`;
}

// The letter shown in the header account button.
export function accountInitial(user: {
  firstName?: string | null;
  email?: string | null;
}) {
  const source = user.firstName?.trim() || user.email?.trim() || "";
  const letter = source.match(/\p{L}|\p{N}/u)?.[0];
  return letter ? letter.toUpperCase() : "?";
}

// SE-011 / SE-012, in plain English.
export const RETENTION_NOTICE = [
  `Buying: a home you're considering, with its rooms, uploads and concepts, is kept for ${BUYER_RETENTION_DAYS} days from when you add it, then deleted automatically.`,
  `If you tell us the purchase isn't going ahead, it's deleted ${NOT_PROCEEDING_RETENTION_DAYS} days later.`,
  "Once you've bought it, or for a home you already own, we keep it until you delete it or your account.",
  "Deleting your account removes everything straight away, including uploaded floor plans and photos. We keep only an anonymous record that a deletion happened.",
] as const;
