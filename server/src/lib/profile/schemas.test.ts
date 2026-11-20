import {
  AccessibilityNeedInputSchema,
  CreateHomeSchema,
  CreatePersonSchema,
  CreatePossessionSchema,
  CreateRoomSchema,
  UpdateHouseholdSchema,
  UpdateUserProfileSchema,
} from "@stepchange/shared";
import { describe, expect, it } from "vitest";

const ROOM = "00000000-0000-4000-8000-000000000001";

describe("profile schemas", () => {
  it("rejects an empty profile patch and oversized journey state", () => {
    expect(UpdateUserProfileSchema.safeParse({}).success).toBe(false);
    expect(
      UpdateUserProfileSchema.safeParse({
        journeyState: { draft: "x".repeat(70_000) },
      }).success,
    ).toBe(false);
    expect(
      UpdateUserProfileSchema.safeParse({ aiTrainingConsent: true }).success,
    ).toBe(true);
  });

  it("validates lifestyle, practical needs and budget in pence", () => {
    expect(
      UpdateHouseholdSchema.safeParse({
        lifestyle: {
          wfhDaysPerWeek: 3,
          entertaining: "regularly",
          hobbies: ["painting"],
          childrensPlay: true,
        },
        practicalNeeds: { storageLevel: "lots", petFriendlyMaterials: true },
        budgetTotalPence: 500_000,
      }).success,
    ).toBe(true);
    expect(
      UpdateHouseholdSchema.safeParse({ lifestyle: { wfhDaysPerWeek: 8 } })
        .success,
    ).toBe(false);
    expect(
      UpdateHouseholdSchema.safeParse({ budgetTotalPence: 12.5 }).success,
    ).toBe(false);
  });

  it("allows persons without names and bounds age 0-120", () => {
    expect(
      CreatePersonSchema.safeParse({ role: "child", ageYears: 4 }).success,
    ).toBe(true);
    expect(
      CreatePersonSchema.safeParse({ role: "adult", ageYears: 121 }).success,
    ).toBe(false);
    expect(
      CreatePersonSchema.safeParse({ role: "child", ageYears: -1 }).success,
    ).toBe(false);
  });

  it("validates accessibility params per need type", () => {
    const ok = (v: unknown) =>
      AccessibilityNeedInputSchema.safeParse(v).success;
    expect(
      ok({
        scope: "home",
        needType: "mobility_aid",
        params: { aidType: "wheelchair", widthCm: 70, lengthCm: 110 },
      }),
    ).toBe(true);
    expect(
      ok({ scope: "home", needType: "mobility_aid", params: { widthCm: 70 } }),
    ).toBe(false);
    expect(
      ok({
        scope: "home",
        needType: "turning_area",
        params: { diameterCm: 150 },
      }),
    ).toBe(true);
    expect(
      ok({
        scope: "home",
        needType: "reach_range",
        params: { minCm: 120, maxCm: 40 },
      }),
    ).toBe(false);
    expect(
      ok({
        scope: "room",
        roomId: ROOM,
        needType: "transfer_area",
        params: { widthCm: 90, depthCm: 120, side: "left" },
      }),
    ).toBe(true);
    expect(
      ok({
        scope: "home",
        needType: "visual",
        params: { highContrast: true, notes: "Prefer matte finishes" },
      }),
    ).toBe(true);
  });

  it("requires the scoped room or person", () => {
    const r = AccessibilityNeedInputSchema.safeParse({
      scope: "room",
      needType: "clear_route",
      params: { minWidthCm: 90 },
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["roomId"]);
  });

  it("drops any diagnosis field", () => {
    const r = AccessibilityNeedInputSchema.parse({
      scope: "home",
      needType: "step_free",
      params: {},
      diagnosis: "should never be stored",
    });
    expect(r).not.toHaveProperty("diagnosis");
  });

  it("validates possessions", () => {
    expect(
      CreatePossessionSchema.safeParse({
        name: "Piano",
        category: "piano",
        widthCm: 150,
        depthCm: 60,
        keep: true,
      }).success,
    ).toBe(true);
    expect(
      CreatePossessionSchema.safeParse({ name: "", category: "sofa" }).success,
    ).toBe(false);
  });
});

describe("home schemas", () => {
  it("accepts user-entered listing details in pence", () => {
    expect(
      CreateHomeSchema.safeParse({
        name: "12 Example Road",
        journeyType: "buyer",
        listing: {
          pricePence: 32_500_000,
          floorAreaSqm: 78.5,
          bedrooms: 2,
          bathrooms: 1,
        },
      }).success,
    ).toBe(true);
    expect(
      CreateHomeSchema.safeParse({
        name: "x",
        journeyType: "buyer",
        listing: { pricePence: 1.5 },
      }).success,
    ).toBe(false);
  });

  it("validates room dimensions in cm", () => {
    expect(
      CreateRoomSchema.safeParse({ name: "Lounge", widthCm: 420.5 }).success,
    ).toBe(true);
    expect(
      CreateRoomSchema.safeParse({ name: "Lounge", widthCm: 0 }).success,
    ).toBe(false);
    expect(
      CreateRoomSchema.safeParse({ name: "Lounge", roomType: "ballroom" })
        .success,
    ).toBe(false);
  });
});
