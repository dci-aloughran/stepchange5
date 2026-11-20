// Pure helpers for the taste journey (FR-07, FR-08). No React, no network.
import type {
  TasteAttributeDto,
  TasteAttributeInput,
  TasteProfile,
} from "@stepchange/shared";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/** Editable categories, in display order. Labels match the server's. */
export const TASTE_CATEGORIES = [
  { key: "style", label: "Style" },
  { key: "palette", label: "Palette" },
  { key: "material", label: "Material" },
  { key: "texture", label: "Texture" },
  { key: "form", label: "Form" },
  { key: "accent", label: "Accent" },
  { key: "light", label: "Light" },
  { key: "clutter", label: "Clutter" },
  { key: "pattern", label: "Pattern" },
  { key: "mood", label: "Mood" },
  { key: "avoid", label: "Avoid" },
] as const;

export type TasteCategoryKey = (typeof TASTE_CATEGORIES)[number]["key"];

/** "material.natural-oak" → "material". */
export function categoryOf(key: string | undefined): string {
  return (key ?? "").split(".")[0] ?? "";
}

/** Brand and colour attributes are stated preferences, not interpretations. */
export function isPreferenceKey(key: string | undefined): boolean {
  const c = categoryOf(key);
  return c === "brand" || c === "colour";
}

export function isAvoid(attr: { key?: string; label: string }): boolean {
  return (
    categoryOf(attr.key) === "avoid" || attr.label.toLowerCase() === "avoid"
  );
}

/** The category an attribute belongs to, for the edit form's select. */
export function categoryKeyFor(attr: {
  key?: string;
  label: string;
}): TasteCategoryKey | "" {
  const byLabel = TASTE_CATEGORIES.find(
    (c) => c.label.toLowerCase() === attr.label.toLowerCase(),
  );
  if (byLabel) return byLabel.key;
  const byKey = TASTE_CATEGORIES.find((c) => c.key === categoryOf(attr.key));
  return byKey?.key ?? "";
}

export function categoryLabel(key: string): string {
  return TASTE_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

// ---------------------------------------------------------------------------
// Confidence, in plain language
// ---------------------------------------------------------------------------

export type ConfidenceWording = { short: string; sentence: string };

export function confidenceWording(
  confidence: number,
  userEdited = false,
): ConfidenceWording {
  if (userEdited) {
    return { short: "Your words", sentence: "You added or confirmed this." };
  }
  const c = Number.isFinite(confidence) ? confidence : 0;
  if (c >= 0.8) return { short: "Very sure", sentence: "We're very sure." };
  if (c >= 0.6) return { short: "Fairly sure", sentence: "We're fairly sure." };
  if (c >= 0.4) {
    return { short: "Not so sure", sentence: "We're not so sure about this." };
  }
  return {
    short: "A guess",
    sentence: "This is a guess, so check it.",
  };
}

// ---------------------------------------------------------------------------
// Profile helpers
// ---------------------------------------------------------------------------

/** Interpreted (non-preference) attributes. */
export function coreAttributes(
  attrs: readonly TasteAttributeDto[],
): TasteAttributeDto[] {
  return attrs.filter((a) => !isPreferenceKey(a.key));
}

/** A profile that holds an interpretation (not just stated preferences). */
export function hasInterpretation(profile: TasteProfile | null): boolean {
  if (!profile) return false;
  return (
    profile.summary.trim().length > 0 ||
    coreAttributes(profile.attributes).length > 0
  );
}

export function splitLikesAndAvoids<T extends { key?: string; label: string }>(
  attrs: readonly T[],
): { likes: T[]; avoids: T[] } {
  const likes: T[] = [];
  const avoids: T[] = [];
  for (const a of attrs) (isAvoid(a) ? avoids : likes).push(a);
  return { likes, avoids };
}

export function statusWording(status: TasteProfile["status"]): string {
  switch (status) {
    case "accepted":
      return "Confirmed by you";
    case "edited":
      return "Corrected by you";
    case "rejected":
      return "Marked as not right";
    default:
      return "Draft — not yet confirmed";
  }
}

// ---------------------------------------------------------------------------
// Attribute editing
// ---------------------------------------------------------------------------

/** An attribute in the edit form. `key` is absent for new attributes. */
export type EditableAttribute = {
  id: string;
  key?: string;
  label: string;
  value: string;
  confidence?: number;
  userEdited?: boolean;
};

export function toEditable(
  attrs: readonly TasteAttributeDto[],
): EditableAttribute[] {
  return coreAttributes(attrs).map((a) => ({
    id: a.key,
    key: a.key,
    label: a.label,
    value: a.value,
    confidence: a.confidence,
    userEdited: a.userEdited,
  }));
}

/** Body for PUT /taste `attributes` (full replacement list). */
export function toAttributeInputs(
  attrs: readonly EditableAttribute[],
): TasteAttributeInput[] {
  const out: TasteAttributeInput[] = [];
  for (const a of attrs) {
    const label = a.label.trim().slice(0, 80);
    const value = a.value.trim().slice(0, 160);
    if (!label || !value) continue;
    out.push({
      ...(a.key ? { key: a.key } : {}),
      label,
      value,
      ...(a.confidence !== undefined ? { confidence: a.confidence } : {}),
    });
  }
  return out;
}

export type AttributeDiff = {
  added: number;
  removed: number;
  changed: number;
  total: number;
};

/** Counts edits between the saved attributes and the edit form. */
export function diffAttributes(
  original: readonly TasteAttributeDto[],
  edited: readonly EditableAttribute[],
): AttributeDiff {
  const before = new Map(coreAttributes(original).map((a) => [a.key, a]));
  const kept = new Set<string>();
  let added = 0;
  let changed = 0;
  for (const a of edited) {
    if (!a.value.trim() || !a.label.trim()) continue;
    const prev = a.key ? before.get(a.key) : undefined;
    if (!prev) {
      added++;
      continue;
    }
    kept.add(prev.key);
    if (prev.label !== a.label.trim() || prev.value !== a.value.trim()) {
      changed++;
    }
  }
  const removed = [...before.keys()].filter((k) => !kept.has(k)).length;
  return { added, removed, changed, total: added + removed + changed };
}

export function describeDiff(d: AttributeDiff): string {
  const parts: string[] = [];
  if (d.added) parts.push(`${d.added} added`);
  if (d.changed) parts.push(`${d.changed} changed`);
  if (d.removed) parts.push(`${d.removed} removed`);
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** "Oak, Linen\nsage green, oak" → ["Oak", "Linen", "sage green"]. */
export function parseList(text: string, max = 20, maxLen = 80): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const v = raw.trim().replace(/\s+/g, " ").slice(0, maxLen);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

export function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export type LinkKind = "pinterest" | "instagram" | "link";

/**
 * Validates a pasted board/pin/post link. Adds https:// when missing.
 * Returns null when it isn't a usable http(s) URL.
 */
export function normaliseLink(
  input: string,
): { url: string; kind: LinkKind } | null {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname.includes(".")) return null;
  const href = url.toString();
  if (href.length > 2048) return null;
  return { url: href, kind: linkKind(url.hostname) };
}

export function linkKind(hostname: string): LinkKind {
  const host = hostname.toLowerCase();
  if (/(^|\.)pinterest\.[a-z.]+$/.test(host) || host === "pin.it") {
    return "pinterest";
  }
  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  return "link";
}

export function linkKindLabel(kind: string): string {
  if (kind === "pinterest") return "Pinterest";
  if (kind === "instagram") return "Instagram";
  return "Link";
}

/**
 * A user-facing message for a failed request. Server errors carry
 * `{ error: string }`; validation failures may carry an object instead.
 */
export function friendlyError(e: unknown, fallback: string): string {
  const status = (e as { status?: unknown } | null)?.status;
  if (status === 429) {
    return "You've done that a lot in the last hour. Please wait a while and try again.";
  }
  if (status === 401) return "Your session has ended. Please sign in again.";
  if (status === 0)
    return "We couldn't reach the server. Check your connection.";
  if (e instanceof Error) {
    const m = e.message.trim();
    if (
      m &&
      !m.includes("[object") &&
      !/^Request failed/.test(m) &&
      status !== 400 &&
      (typeof status !== "number" || status < 500 || m.length < 200)
    ) {
      return m;
    }
  }
  return fallback;
}

/** Short, readable form of a URL for display. */
export function displayUrl(url: string, max = 48): string {
  let s = url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
  if (s.length > max) s = `${s.slice(0, max - 1)}…`;
  return s;
}
