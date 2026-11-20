// Build a catalogue search intent from a furniture requirement + taste +
// budget band. Requirement first, product second.

import type { SwapIntent } from "@stepchange/shared";
import { keywords } from "./ranking.js";

export type IntentRequirement = {
  category: string;
  description: string;
};

export function requirementKeywords(r: IntentRequirement): string[] {
  // Category words are what the product must actually be.
  return keywords(r.category);
}

export function buildQuery(r: IntentRequirement, swap?: SwapIntent): string {
  const cat = r.category.replace(/[_-]/g, " ").toLowerCase().trim();
  const desc = r.description
    .toLowerCase()
    .replace(/\d+(\.\d+)?\s*(–|-|to)\s*\d+(\.\d+)?\s*(cm|mm|m)?/g, " ")
    .replace(/\d+(\.\d+)?\s*(x|×)\s*\d+(\.\d+)?\s*(cm|mm|m)?/g, " ")
    .replace(/\d+(\.\d+)?\s*(cm|mm|m)\b/g, " ")
    .replace(/\b(approx\.?|max|min|around|about|~)\b/g, " ")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let q = desc.includes(cat) ? desc : `${desc} ${cat}`.trim();
  if (swap === "more_durable") q = `durable ${q}`;
  if (swap === "child_friendly") q = `family friendly ${q}`;
  return q.split(" ").slice(0, 10).join(" ");
}

export function tasteKeywords(
  attrs: Array<{ value: string; confidence: number; userEdited: boolean }>,
): string[] {
  return keywords(
    attrs
      .filter((a) => a.userEdited || a.confidence >= 0.5)
      .map((a) => a.value)
      .join(" "),
  ).slice(0, 12);
}

export function priceBand(
  estimate: { low: number; high: number } | undefined,
  allocationPence: number | undefined,
): { low: number; high: number } | null {
  if (estimate) return { low: estimate.low, high: estimate.high };
  if (allocationPence && allocationPence > 0) {
    return { low: Math.floor(allocationPence / 2), high: allocationPence };
  }
  return null;
}

const DURABLE =
  /\b(solid|hardwood|oak|walnut|metal|steel|performance fabric|stain[- ]resistant|warranty|guarantee|durable|heavy[- ]duty)\b/i;
const CHILD =
  /\b(rounded|round edges|soft edges|stain[- ]resistant|washable|wipe[- ]clean|removable covers?|performance fabric|family|kids?|child)\b/i;

// Hard filter for a swap intent, relative to the product being replaced.
export function swapFilter(
  intent: SwapIntent,
  current: {
    pricePence: number | null;
    colour: string | null;
    retailer: string;
  },
  cand: {
    pricePence: number | null;
    colour: string | null;
    retailer: string;
    title: string;
    description: string | null;
    availability: string;
  },
): boolean {
  const text = `${cand.title} ${cand.description ?? ""}`;
  const cp = current.pricePence;
  switch (intent) {
    case "cheaper":
      return cp !== null && cand.pricePence !== null && cand.pricePence < cp;
    case "upgrade":
      return cp !== null && cand.pricePence !== null && cand.pricePence > cp;
    case "similar":
      return (
        cp === null ||
        (cand.pricePence !== null &&
          Math.abs(cand.pricePence - cp) <= cp * 0.25)
      );
    case "different_colour":
      return (
        cand.colour !== null &&
        cand.colour.toLowerCase() !== (current.colour ?? "").toLowerCase()
      );
    case "different_retailer":
      return cand.retailer !== current.retailer;
    case "more_durable":
      return DURABLE.test(text);
    case "child_friendly":
      return CHILD.test(text);
    case "available_sooner":
      // No delivery-date data in the catalogue: in-stock only.
      return cand.availability === "in_stock";
  }
}

export function swapPriceFilter(
  intent: SwapIntent,
  currentPricePence: number | null,
): { minPricePence?: number; maxPricePence?: number } {
  if (currentPricePence === null) return {};
  if (intent === "cheaper") return { maxPricePence: currentPricePence - 1 };
  if (intent === "upgrade") return { minPricePence: currentPricePence + 1 };
  return {};
}
