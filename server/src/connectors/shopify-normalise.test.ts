import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  extractDims,
  normaliseProduct,
  parseLabelledDims,
  type UcpProduct,
} from "./shopify-normalise.js";

// Sanitised capture of a real Global Catalog search_catalog response
// ("oak coffee table", ships_to GB) taken 2026-11-20.
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "./__fixtures__/global-search-oak-coffee-table.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { products: UcpProduct[] };

const retrievedAt = new Date("2026-11-20T12:00:00Z");

describe("normaliseProduct (real fixture)", () => {
  const [jakob, maru] = fixture.products.map((p) =>
    normaliseProduct(p, { retrievedAt, shipsToGbFiltered: true }),
  );

  it("maps FR-21 fields from a Global Catalog offer", () => {
    const p = jakob?.[0];
    expect(p).toMatchObject({
      retailer: "Roseland Furniture",
      connector: "shopify_ucp",
      sourceProductId: "gid://shopify/Product/6852883251277",
      sourceVariantId: "gid://shopify/ProductVariant/40049617797197",
      upid: "gid://shopify/p/77Gy5r5D7wvkg4CiSstFG6",
      pricePence: 10995,
      currency: "GBP",
      availability: "in_stock",
      deliversToUk: true,
      licenceStatus: "display_with_attribution",
      sponsored: false,
    });
    expect(p?.checkoutUrl).toContain("/buy/40049617797197:1");
    expect(p?.canonicalUrl).toContain("roselandfurniture.com/products/");
    expect(p?.imageUrls[0]).toMatch(/^https:\/\/cdn\.shopify\.com\//);
    expect(p?.description).not.toMatch(/<[a-z]/i);
  });

  it("does not take sub-component (drawer/leg) dims as overall size", () => {
    expect(jakob?.[0]?.dimensionStatus).toBe("unknown");
    expect(jakob?.[0]?.widthCm).toBeNull();
  });

  it("parses explicit retailer-printed dims", () => {
    expect(maru?.[0]).toMatchObject({
      widthCm: 80,
      depthCm: 80,
      heightCm: 40,
      dimensionStatus: "source_printed",
      colour: "Silver Oak",
    });
  });

  it("flags promoted placements as sponsored", () => {
    const p = structuredClone(fixture.products[0]) as UcpProduct;
    (p.variants?.[0] as { placement?: unknown }).placement = {
      type: "affiliate",
    };
    expect(
      normaliseProduct(p, { retrievedAt, shipsToGbFiltered: true })[0]
        ?.sponsored,
    ).toBe(true);
  });
});

describe("dimension parsing", () => {
  it("handles labelled formats and units", () => {
    expect(parseLabelledDims("(H) 75cm | (W) 120cm | (D) 60cm")).toEqual({
      widthCm: 120,
      depthCm: 60,
      heightCm: 75,
    });
    expect(parseLabelledDims("Width: 2000mm, Depth: 900mm")).toEqual({
      widthCm: 200,
      depthCm: 90,
    });
  });
  it("ignores unlabelled triples", () => {
    expect(
      extractDims("Table", "Size 120 x 60 x 75 cm", undefined).status,
    ).toBe("unknown");
  });
  it("marks Shopify-inferred tech specs as estimated", () => {
    expect(
      extractDims("Table", "", ["Width: 100 cm, Depth: 50 cm"]).status,
    ).toBe("estimated");
  });
});
