import { describe, expect, it } from "vitest";
import {
  canonicalRoomType,
  type ListingModelOutput,
  normaliseListing,
} from "./extract.js";

const base: ListingModelOutput = {
  isListing: true,
  address: " Rowan Court, Sheffield ",
  priceGbp: 325000,
  priceQualifier: "Guide price",
  tenure: "Freehold",
  propertyType: "house",
  propertySubtype: "Semi-detached house",
  bedrooms: 3,
  bathrooms: 1,
  receptions: 2,
  floorArea: { value: 1001, unit: "sqft" },
  keyFeatures: [" South-facing garden ", ""],
  summary: "A three bedroom semi.",
  agent: "Example Estates",
  portal: "Rightmove",
  rooms: [
    {
      name: "Living room",
      roomType: "living_room",
      widthCm: 460.4,
      lengthCm: 380,
    },
    { name: "Bedroom 3", roomType: "bedroom", widthCm: 240, lengthCm: null },
  ],
  images: [
    { index: 0, kind: "listing_details" },
    { index: 1, kind: "property_photo" },
    { index: 2, kind: "floor_plan" },
  ],
  notes: [],
};
const ids = ["u0", "u1", "u2"];

describe("normaliseListing", () => {
  it("converts units and maps images to uploads", () => {
    const r = normaliseListing(base, ids, {
      sourceUrl: "https://www.rightmove.co.uk/properties/1",
      modelVersion: "m",
    });
    expect(r.details.pricePence).toBe(32_500_000);
    expect(r.details.floorAreaSqm).toBe(93);
    expect(r.details.address).toBe("Rowan Court, Sheffield");
    expect(r.details.keyFeatures).toEqual(["South-facing garden"]);
    expect(r.photoUploadIds).toEqual(["u1"]);
    expect(r.floorPlanUploadId).toBe("u2");
    expect(r.missing).toEqual([]);
    expect(r.rooms[0]).toEqual({
      name: "Living room",
      roomType: "living_room",
      widthCm: 460,
      lengthCm: 380,
      dimensionStatus: "source_printed",
    });
  });

  it("never claims a size when only one side is printed", () => {
    const r = normaliseListing(base, ids, {
      sourceUrl: null,
      modelVersion: "m",
    });
    expect(r.rooms[1]).toMatchObject({
      widthCm: null,
      lengthCm: null,
      dimensionStatus: "unknown",
    });
  });

  it("lists missing key facts and flags non-listings", () => {
    const r = normaliseListing(
      {
        ...base,
        isListing: false,
        priceGbp: null,
        bedrooms: null,
        floorArea: null,
        images: [],
      },
      ids,
      { sourceUrl: null, modelVersion: "m" },
    );
    expect(r.missing).toEqual(["price", "bedrooms", "floor area"]);
    expect(r.notes[0]).toMatch(/doesn't look like a property listing/);
    expect(r.floorPlanUploadId).toBeNull();
    expect(r.photoUploadIds).toEqual([]);
  });
});

describe("canonicalRoomType", () => {
  it.each([
    ["living_room", "Living Room", "living_room"],
    ["living room", "Living Room", "living_room"],
    ["reception", "Lounge", "living_room"],
    ["", "Kitchen/Diner", "kitchen_diner"],
    ["kitchen", "Kitchen", "kitchen"],
    ["", "Bedroom One", "bedroom"],
    ["", "En-suite", "en_suite"],
    ["", "Family Bathroom", "bathroom"],
    ["", "Downstairs WC", "wc"],
    ["", "Entrance Hall", "hallway"],
    ["", "Loft space", "other"],
  ])("%j / %j → %s", (type, name, expected) => {
    expect(canonicalRoomType(type, name)).toBe(expected);
  });
});
