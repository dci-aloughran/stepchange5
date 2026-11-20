import type { RecommendationDto } from "@stepchange/shared";
import { describe, expect, it } from "vitest";
import { handoffUrl, recommendationLabels, SWAP_INTENTS } from "./products";

function rec(
  labels: Partial<RecommendationDto["labels"]> = {},
  product: Partial<RecommendationDto["product"]> = {},
): RecommendationDto {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    roomId: "00000000-0000-4000-8000-000000000002",
    briefId: null,
    requirementId: "sofa",
    rank: 1,
    status: "active",
    includeInBudget: true,
    includeInBudgetSetByUser: false,
    score: 1,
    reasons: [],
    labels: {
      stale: false,
      unavailable: false,
      priceNeedsRefresh: false,
      sponsored: false,
      verifiedFit: false,
      dimensionFit: "unbounded",
      fromPreviousBrief: false,
      ...labels,
    },
    product: {
      id: "00000000-0000-4000-8000-000000000003",
      retailer: "Example Store",
      connector: "shopify_ucp",
      sourceProductId: "p",
      sourceVariantId: "v",
      title: "Sofa",
      description: null,
      category: null,
      widthCm: null,
      depthCm: null,
      heightCm: null,
      dimensionStatus: "unknown",
      colour: null,
      material: null,
      pricePence: 50000,
      currency: "GBP",
      availability: "in_stock",
      imageUrls: [],
      deliversToUk: true,
      canonicalUrl: null,
      checkoutUrl: null,
      licenceStatus: "display_with_attribution",
      attribution:
        "Image and product details: Example Store via Shopify Catalog",
      imagesUsableInConcepts: false,
      sponsored: false,
      retrievedAt: new Date().toISOString(),
      ...product,
    },
    createdAt: new Date().toISOString(),
  };
}

const texts = (r: RecommendationDto) =>
  recommendationLabels(r).map((l) => l.text);

describe("recommendationLabels", () => {
  it("labels verified and unverified fit honestly", () => {
    expect(texts(rec({ dimensionFit: "fits", verifiedFit: true }))).toContain(
      "✓ Fits (retailer sizes)",
    );
    expect(texts(rec({ dimensionFit: "fits", verifiedFit: false }))).toContain(
      "Appears to fit · not verified",
    );
    expect(texts(rec({ dimensionFit: "unknown" }))).toContain(
      "Size not published · measure first",
    );
  });
  it("discloses sponsorship first", () => {
    expect(texts(rec({ sponsored: true }))[0]).toBe("Sponsored");
    expect(texts(rec({}, { sponsored: true }))[0]).toBe("Sponsored");
    expect(texts(rec())).not.toContain("Sponsored");
  });
  it("labels stale prices and availability", () => {
    expect(texts(rec({ stale: true, priceNeedsRefresh: true }))).toContain(
      "Price over 24 h old",
    );
    expect(texts(rec({ priceNeedsRefresh: true }))).toContain(
      "Re-check price before buying",
    );
    expect(texts(rec({ unavailable: true }))).toContain("Out of stock");
    expect(texts(rec({}, { availability: "unknown" }))).toContain(
      "Availability unknown",
    );
    expect(texts(rec({}, { deliversToUk: false }))).toContain(
      "May not deliver to the UK",
    );
  });
});

describe("handoffUrl", () => {
  it("prefers checkout, falls back to the product page", () => {
    expect(
      handoffUrl("https://shop.example/cart/1:1", "https://shop.example/p"),
    ).toBe("https://shop.example/cart/1:1");
    expect(handoffUrl(null, "https://shop.example/p")).toBe(
      "https://shop.example/p",
    );
  });
  it("never opens non-http URLs", () => {
    expect(handoffUrl("javascript:alert(1)", null)).toBeNull();
    expect(handoffUrl("not a url", "data:text/html,hi")).toBeNull();
    expect(handoffUrl(null, null)).toBeNull();
  });
});

it("offers all eight swap intents", () => {
  expect(SWAP_INTENTS.map((s) => s.intent)).toEqual([
    "cheaper",
    "similar",
    "upgrade",
    "different_colour",
    "different_retailer",
    "more_durable",
    "child_friendly",
    "available_sooner",
  ]);
});
