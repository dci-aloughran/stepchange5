import type { TasteAttributeInput } from "@stepchange/shared";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { TasteAttribute } from "../../db/schema.js";
import { MODELS } from "../ai.js";

export const TASTE_PROMPT_VERSION = "taste-v1";
export const MAX_DERIVE_IMAGES = 10;

const CATEGORY_LABEL: Record<string, string> = {
  style: "Style",
  palette: "Palette",
  material: "Material",
  texture: "Texture",
  form: "Form",
  accent: "Accent",
  light: "Light",
  clutter: "Clutter",
  pattern: "Pattern",
  mood: "Mood",
  avoid: "Avoid",
  brand: "Preferred brand",
  colour: "Preferred colour",
};

export function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "item"
  );
}

function labelToCategory(label: string): string {
  const l = label.toLowerCase();
  for (const [k, v] of Object.entries(CATEGORY_LABEL)) {
    if (v.toLowerCase() === l || k === l) return k;
  }
  return slug(label);
}

export function preferenceAttributes(
  brands: string[],
  colours: string[],
): TasteAttribute[] {
  return [
    ...brands.map((b) => ({
      key: `brand.${slug(b)}`,
      label: CATEGORY_LABEL.brand as string,
      value: b,
      confidence: 1,
      userEdited: true,
    })),
    ...colours.map((c) => ({
      key: `colour.${slug(c)}`,
      label: CATEGORY_LABEL.colour as string,
      value: c,
      confidence: 1,
      userEdited: true,
    })),
  ];
}

// Applies user corrections; returns the new list and how many attributes
// were added, changed or removed (taste-profile correction rate metric).
export function applyAttributeCorrections(
  previous: TasteAttribute[],
  input: TasteAttributeInput[],
): { attributes: TasteAttribute[]; changedCount: number } {
  const prev = new Map(previous.map((a) => [a.key, a]));
  const seen = new Set<string>();
  const out: TasteAttribute[] = [];
  let changed = 0;
  for (const a of input) {
    let key = a.key ?? `${labelToCategory(a.label)}.${slug(a.value)}`;
    while (seen.has(key)) key = `${key}-x`;
    seen.add(key);
    const before = prev.get(key);
    const isChanged =
      !before || before.label !== a.label || before.value !== a.value;
    if (isChanged) changed++;
    out.push({
      key,
      label: a.label,
      value: a.value,
      confidence: isChanged ? 1 : (a.confidence ?? before?.confidence ?? 1),
      userEdited: isChanged ? true : (before?.userEdited ?? false),
    });
  }
  for (const k of prev.keys()) if (!seen.has(k)) changed++;
  return { attributes: out, changedCount: changed };
}

const DerivedSchema = z.object({
  summary: z.string(),
  attributes: z.array(
    z.object({
      category: z.enum([
        "style",
        "palette",
        "material",
        "texture",
        "form",
        "accent",
        "light",
        "clutter",
        "pattern",
        "mood",
        "avoid",
      ]),
      value: z.string(),
      confidence: z.number(),
    }),
  ),
});

const INSTRUCTIONS = `You interpret a person's home-interior taste from inspiration images, their reactions and notes.
Produce a rich, specific, editable profile, not a single style label. Good attribute values look like:
"Warm contemporary", "Natural oak", "Warm neutrals", "Muted greens", "Textured fabrics", "Minimal visual clutter",
"Rounded furniture", "Black accents used sparingly", "Strong preference for natural light".
Use category "avoid" for things they dislike (from "dislike" reactions or notes), e.g. "High-gloss finishes".
Confidence is 0..1 and reflects how consistently the evidence supports the attribute.
You cannot open links; only use what is shown or written. 6-14 attributes. The summary is 1-3 friendly sentences in UK English.`;

export type DeriveInput = {
  images: Array<{
    bytes: Uint8Array;
    mediaType: string;
    reaction: string;
    note: string | null;
  }>;
  links: Array<{ kind: string; reaction: string; note: string | null }>;
  textOnlyItems: Array<{ reaction: string; note: string | null }>;
  description?: string;
  brands: string[];
  colours: string[];
  keptAttributes: TasteAttribute[];
};

export async function deriveTaste(input: DeriveInput) {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "file"; mediaType: string; data: Uint8Array }
  > = [];
  input.images.forEach((img, i) => {
    content.push({
      type: "text",
      text: `Image ${i + 1}: reaction=${img.reaction}${img.note ? `; note: ${img.note}` : ""}`,
    });
    content.push({ type: "file", mediaType: img.mediaType, data: img.bytes });
  });
  const lines: string[] = [];
  if (input.images.length === 0) {
    lines.push(
      "No images are available; derive the profile from the text below only.",
    );
  }
  for (const l of input.links) {
    lines.push(
      `Saved ${l.kind} reference (not viewable): reaction=${l.reaction}${l.note ? `; note: ${l.note}` : ""}`,
    );
  }
  for (const t of input.textOnlyItems) {
    if (t.note) lines.push(`Inspiration note (${t.reaction}): ${t.note}`);
  }
  if (input.description) lines.push(`In their words: ${input.description}`);
  if (input.brands.length)
    lines.push(`Preferred brands: ${input.brands.join(", ")}`);
  if (input.colours.length)
    lines.push(`Preferred colours: ${input.colours.join(", ")}`);
  if (input.keptAttributes.length) {
    lines.push(
      `Already confirmed by the user (keep consistent, do not repeat): ${input.keptAttributes
        .map((a) => `${a.label}: ${a.value}`)
        .join("; ")}`,
    );
  }
  lines.push("Derive the taste profile.");
  content.push({ type: "text", text: lines.join("\n") });

  const result = await generateText({
    model: MODELS.vision,
    instructions: INSTRUCTIONS,
    messages: [{ role: "user", content }],
    output: Output.object({ schema: DerivedSchema }),
    timeout: 90_000,
  });

  const seen = new Set(input.keptAttributes.map((a) => a.key));
  const derived: TasteAttribute[] = [];
  for (const a of result.output.attributes.slice(0, 20)) {
    const key = `${a.category}.${slug(a.value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    derived.push({
      key,
      label: CATEGORY_LABEL[a.category] ?? a.category,
      value: a.value.slice(0, 160),
      confidence: Math.min(1, Math.max(0, a.confidence)),
      userEdited: false,
    });
  }
  return {
    summary: result.output.summary.slice(0, 1000),
    attributes: derived,
    modelVersion: result.response?.modelId ?? MODELS.vision,
  };
}
