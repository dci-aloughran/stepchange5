// Product / recommendation presentation rules (FR-13, FR-14, FR-22, FR-39).

import type { RecommendationDto, SwapIntent } from "@stepchange/shared";

export const SWAP_INTENTS: { intent: SwapIntent; label: string }[] = [
  { intent: "cheaper", label: "£ Cheaper" },
  { intent: "similar", label: "££ Similar" },
  { intent: "upgrade", label: "£££ Upgrade" },
  { intent: "different_colour", label: "Different colour" },
  { intent: "different_retailer", label: "Different retailer" },
  { intent: "more_durable", label: "More durable" },
  { intent: "child_friendly", label: "Child-friendly" },
  { intent: "available_sooner", label: "Available sooner" },
];

export type LabelTone = "ok" | "warn" | "bad" | "none" | "info";
export type ProductLabel = { text: string; tone: LabelTone };

// Honest labels for one recommendation, most important first.
export function recommendationLabels(rec: RecommendationDto): ProductLabel[] {
  const out: ProductLabel[] = [];
  const { labels, product } = rec;
  if (labels.sponsored || product.sponsored) {
    out.push({ text: "Sponsored", tone: "info" });
  }
  if (labels.unavailable) out.push({ text: "Out of stock", tone: "bad" });
  else if (product.availability === "in_stock")
    out.push({ text: "In stock", tone: "ok" });
  else out.push({ text: "Availability unknown", tone: "none" });

  switch (labels.dimensionFit) {
    case "fits":
      out.push(
        labels.verifiedFit
          ? { text: "✓ Fits (retailer sizes)", tone: "ok" }
          : { text: "Appears to fit · not verified", tone: "warn" },
      );
      break;
    case "unknown":
      out.push({ text: "Size not published · measure first", tone: "warn" });
      break;
    case "exceeds":
      out.push({ text: "Too big for the space", tone: "bad" });
      break;
    default:
      break;
  }
  if (labels.stale) {
    out.push({ text: "Price over 24 h old", tone: "warn" });
  } else if (labels.priceNeedsRefresh) {
    out.push({ text: "Re-check price before buying", tone: "none" });
  }
  if (product.deliversToUk === false) {
    out.push({ text: "May not deliver to the UK", tone: "warn" });
  }
  if (labels.fromPreviousBrief) {
    out.push({ text: "From an earlier brief", tone: "none" });
  }
  return out;
}

// Retailer URL to hand off to: checkout if known, else the product page.
// Only http(s) URLs are ever opened.
export function handoffUrl(
  checkoutUrl: string | null | undefined,
  canonicalUrl: string | null | undefined,
): string | null {
  for (const u of [checkoutUrl, canonicalUrl]) {
    if (!u) continue;
    try {
      const parsed = new URL(u);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return parsed.toString();
      }
    } catch {}
  }
  return null;
}

export const EXCLUDED_REASON_TEXT: Record<string, string> = {
  stale: "price is over 24 hours old",
  unavailable: "out of stock",
  user_excluded: "you excluded it",
  no_gbp_price: "no UK price",
  no_recommendation: "no product chosen yet",
};
