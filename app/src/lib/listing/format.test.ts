import type { ListingDetails } from "@stepchange/shared";
import { describe, expect, it } from "vitest";
import { factRows, formatPrice, propertyTypeLabel } from "./format";

const empty: ListingDetails = {
  address: null,
  pricePence: null,
  priceQualifier: null,
  tenure: null,
  propertyType: null,
  propertySubtype: null,
  bedrooms: null,
  bathrooms: null,
  receptions: null,
  floorAreaSqm: null,
  keyFeatures: [],
  summary: null,
  agent: null,
  portal: null,
};

describe("listing formatting", () => {
  it("formats prices in pounds", () => {
    expect(formatPrice(32_500_000)).toBe("£325,000");
    expect(formatPrice(null)).toBeNull();
  });

  it("prefers the listing's own property wording", () => {
    expect(
      propertyTypeLabel({
        ...empty,
        propertyType: "house",
        propertySubtype: "Semi-detached house",
      }),
    ).toBe("Semi-detached house");
    expect(propertyTypeLabel({ ...empty, propertyType: "flat" })).toBe("Flat");
  });

  it("keeps missing facts as null rather than filling them", () => {
    const rows = factRows({
      ...empty,
      pricePence: 32_500_000,
      priceQualifier: "Guide price",
      bedrooms: 0,
    });
    expect(rows.find((r) => r.label === "Price")?.value).toBe(
      "Guide price £325,000",
    );
    expect(rows.find((r) => r.label === "Bedrooms")?.value).toBe("0");
    expect(rows.find((r) => r.label === "Bathrooms")?.value).toBeNull();
  });
});
