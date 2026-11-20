// Free-text taste inputs kept on this device until a taste profile exists.
// The server has no field for the description, so it is sent with each
// POST /taste/derive; brands and colours move into the profile once derived.

export const TASTE_DRAFT_KEY = "deloitful.taste";

export type TasteDraft = {
  description: string;
  brands: string;
  colours: string;
};

const EMPTY: TasteDraft = { description: "", brands: "", colours: "" };

export function readTasteDraft(): TasteDraft {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = JSON.parse(localStorage.getItem(TASTE_DRAFT_KEY) ?? "{}");
    return {
      description:
        typeof raw.description === "string"
          ? raw.description
          : EMPTY.description,
      brands: typeof raw.brands === "string" ? raw.brands : EMPTY.brands,
      colours: typeof raw.colours === "string" ? raw.colours : EMPTY.colours,
    };
  } catch {
    return EMPTY;
  }
}

export function writeTasteDraft(patch: Partial<TasteDraft>): TasteDraft {
  const next = { ...readTasteDraft(), ...patch };
  try {
    localStorage.setItem(TASTE_DRAFT_KEY, JSON.stringify(next));
  } catch {}
  return next;
}
