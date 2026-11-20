import type { TasteAttributeDto, TasteProfile } from "@stepchange/shared";
import { describe, expect, it } from "vitest";
import {
  categoryKeyFor,
  confidenceWording,
  coreAttributes,
  describeDiff,
  diffAttributes,
  displayUrl,
  type EditableAttribute,
  friendlyError,
  hasInterpretation,
  normaliseLink,
  parseList,
  splitLikesAndAvoids,
  toAttributeInputs,
  toEditable,
} from "./taste";

const attr = (
  key: string,
  label: string,
  value: string,
  confidence = 0.7,
  userEdited = false,
): TasteAttributeDto => ({ key, label, value, confidence, userEdited });

const saved: TasteAttributeDto[] = [
  attr("style.warm-contemporary", "Style", "Warm contemporary", 0.9),
  attr("material.natural-oak", "Material", "Natural oak", 0.65),
  attr("avoid.high-gloss", "Avoid", "High-gloss finishes", 0.5),
  attr("brand.hay", "Preferred brand", "HAY", 1, true),
  attr("colour.sage", "Preferred colour", "Sage", 1, true),
];

const profile = (over: Partial<TasteProfile> = {}): TasteProfile => ({
  id: "00000000-0000-4000-8000-000000000000",
  summary: "",
  attributes: [],
  preferredBrands: [],
  preferredColours: [],
  status: "draft",
  modelVersion: null,
  promptVersion: null,
  updatedAt: "2026-11-20T00:00:00.000Z",
  ...over,
});

describe("confidenceWording", () => {
  it("describes model confidence in plain language", () => {
    expect(confidenceWording(0.95).short).toBe("Very sure");
    expect(confidenceWording(0.8).short).toBe("Very sure");
    expect(confidenceWording(0.7).short).toBe("Fairly sure");
    expect(confidenceWording(0.45).short).toBe("Not so sure");
    expect(confidenceWording(0.1).short).toBe("A guess");
    expect(confidenceWording(Number.NaN).short).toBe("A guess");
  });
  it("credits the user for their own edits", () => {
    expect(confidenceWording(1, true).short).toBe("Your words");
  });
});

describe("profile helpers", () => {
  it("separates stated preferences from the interpretation", () => {
    expect(coreAttributes(saved).map((a) => a.key)).toEqual([
      "style.warm-contemporary",
      "material.natural-oak",
      "avoid.high-gloss",
    ]);
  });
  it("splits dislikes out", () => {
    const { likes, avoids } = splitLikesAndAvoids(coreAttributes(saved));
    expect(likes).toHaveLength(2);
    expect(avoids.map((a) => a.value)).toEqual(["High-gloss finishes"]);
    // A new attribute without a key is classed by its label.
    expect(
      splitLikesAndAvoids([{ label: "Avoid", value: "Chrome" }]).avoids,
    ).toHaveLength(1);
  });
  it("treats a preferences-only profile as not yet interpreted", () => {
    expect(hasInterpretation(null)).toBe(false);
    expect(hasInterpretation(profile({ attributes: saved.slice(3) }))).toBe(
      false,
    );
    expect(hasInterpretation(profile({ summary: "Calm and warm." }))).toBe(
      true,
    );
    expect(hasInterpretation(profile({ attributes: saved }))).toBe(true);
  });
  it("maps attributes to edit categories", () => {
    expect(categoryKeyFor({ key: "avoid.x", label: "Avoid" })).toBe("avoid");
    expect(categoryKeyFor({ label: "Material" })).toBe("material");
    expect(categoryKeyFor({ key: "weird.x", label: "Weird" })).toBe("");
  });
});

describe("attribute editing", () => {
  it("leaves brand/colour preferences out of the edit list", () => {
    expect(toEditable(saved)).toHaveLength(3);
  });

  it("reports no changes for an untouched list", () => {
    const d = diffAttributes(saved, toEditable(saved));
    expect(d).toEqual({ added: 0, removed: 0, changed: 0, total: 0 });
    expect(describeDiff(d)).toBe("");
  });

  it("counts edits, removals and additions", () => {
    const list = toEditable(saved);
    const edited: EditableAttribute[] = [
      { ...(list[0] as EditableAttribute), value: "Warm minimal" },
      // natural oak removed
      list[2] as EditableAttribute,
      { id: "new-1", label: "Texture", value: "Boucle" },
      { id: "new-2", label: "Mood", value: "   " }, // blank: ignored
    ];
    const d = diffAttributes(saved, edited);
    expect(d).toEqual({ added: 1, removed: 1, changed: 1, total: 3 });
    expect(describeDiff(d)).toBe("1 added, 1 changed, 1 removed");
  });

  it("ignores whitespace-only differences", () => {
    const list = toEditable(saved).map((a) => ({
      ...a,
      value: ` ${a.value} `,
    }));
    expect(diffAttributes(saved, list).total).toBe(0);
  });

  it("builds a PUT body that keeps keys and drops blanks", () => {
    const inputs = toAttributeInputs([
      {
        id: "a",
        key: "style.warm-contemporary",
        label: "Style",
        value: " Warm minimal ",
        confidence: 0.9,
      },
      { id: "b", label: "Texture", value: "Boucle" },
      { id: "c", label: "Mood", value: "" },
    ]);
    expect(inputs).toEqual([
      {
        key: "style.warm-contemporary",
        label: "Style",
        value: "Warm minimal",
        confidence: 0.9,
      },
      { label: "Texture", value: "Boucle" },
    ]);
  });
});

describe("inputs", () => {
  it("parses comma or line separated lists without duplicates", () => {
    expect(parseList("Oak, linen\n  sage   green ; oak,,")).toEqual([
      "Oak",
      "linen",
      "sage green",
    ]);
    expect(parseList("a,b,c", 2)).toEqual(["a", "b"]);
    expect(parseList("")).toEqual([]);
  });

  it("normalises pasted links and recognises boards", () => {
    expect(normaliseLink("pinterest.co.uk/me/our-first-place")).toEqual({
      url: "https://pinterest.co.uk/me/our-first-place",
      kind: "pinterest",
    });
    expect(normaliseLink("https://pin.it/abc")?.kind).toBe("pinterest");
    expect(normaliseLink("https://www.instagram.com/p/xyz/")?.kind).toBe(
      "instagram",
    );
    expect(normaliseLink("https://example.com/room")?.kind).toBe("link");
  });

  it("rejects things that aren't web links", () => {
    expect(normaliseLink("")).toBeNull();
    expect(normaliseLink("not a link")).toBeNull();
    expect(normaliseLink("javascript:alert(1)")).toBeNull();
    expect(normaliseLink("ftp://example.com/x")).toBeNull();
    expect(normaliseLink("localhost")).toBeNull();
  });

  it("turns request failures into friendly messages", () => {
    const err = (message: string, status?: number) =>
      Object.assign(new Error(message), { status });
    expect(friendlyError(err("Not found", 404), "fb")).toBe("Not found");
    expect(friendlyError(err("[object Object]", 400), "fb")).toBe("fb");
    expect(friendlyError(err("Request failed (500)", 500), "fb")).toBe("fb");
    expect(friendlyError(err("Too many requests", 429), "fb")).toMatch(
      /last hour/,
    );
    expect(friendlyError("boom", "fb")).toBe("fb");
  });

  it("shortens URLs for display", () => {
    expect(displayUrl("https://www.pinterest.com/me/board/")).toBe(
      "pinterest.com/me/board",
    );
    expect(displayUrl(`https://a.com/${"x".repeat(80)}`, 20)).toHaveLength(20);
  });
});
