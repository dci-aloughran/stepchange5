import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import type { AccessibilityRow } from "./dto.js";
import {
  accessibilityValues,
  defaultPersonLabel,
  mergeAccessibilityUpdate,
  mergeJourneyState,
} from "./helpers.js";
import { formatIssue } from "./validate.js";

const ROOM = "00000000-0000-4000-8000-000000000001";
const PERSON = "00000000-0000-4000-8000-000000000002";

describe("mergeJourneyState (MB-005)", () => {
  it("shallow-merges and removes null keys", () => {
    expect(
      mergeJourneyState(
        { lastConfirmedStep: "household", draft: { a: 1 }, keep: true },
        { lastConfirmedStep: "home", draft: null },
      ),
    ).toEqual({ lastConfirmedStep: "home", keep: true });
  });
});

describe("defaultPersonLabel (SE-007)", () => {
  it("numbers labels per role without needing names", () => {
    expect(defaultPersonLabel("child", [])).toBe("Child 1");
    expect(defaultPersonLabel("child", ["Child 1", "Adult 1"])).toBe("Child 2");
    expect(defaultPersonLabel("regular_visitor", [])).toBe("Visitor 1");
  });

  it("skips labels already taken", () => {
    expect(defaultPersonLabel("adult", ["Adult 2"])).toBe("Adult 3");
  });
});

const stored: AccessibilityRow = {
  id: "00000000-0000-4000-8000-000000000003",
  householdId: "00000000-0000-4000-8000-000000000004",
  scope: "room",
  roomId: ROOM,
  personId: null,
  needType: "clear_route",
  params: { minWidthCm: 90 },
  confirmed: false,
  notes: null,
  createdAt: new Date(),
};

describe("mergeAccessibilityUpdate (AC-001..003)", () => {
  it("confirms a need without re-sending params", () => {
    const merged = mergeAccessibilityUpdate(stored, { confirmed: true });
    expect(merged).toMatchObject({
      needType: "clear_route",
      params: { minWidthCm: 90 },
      confirmed: true,
      roomId: ROOM,
    });
  });

  it("requires params matching a changed needType", () => {
    expect(() =>
      mergeAccessibilityUpdate(stored, { needType: "turning_area" }),
    ).toThrow(HTTPException);
    expect(
      mergeAccessibilityUpdate(stored, {
        needType: "turning_area",
        params: { diameterCm: 150 },
      }).params,
    ).toEqual({ diameterCm: 150 });
  });

  it("drops the room link when moving to person scope", () => {
    const merged = mergeAccessibilityUpdate(stored, {
      scope: "person",
      personId: PERSON,
    });
    expect(accessibilityValues(merged)).toMatchObject({
      scope: "person",
      roomId: null,
      personId: PERSON,
    });
  });

  it("rejects person scope without a person", () => {
    expect(() => mergeAccessibilityUpdate(stored, { scope: "person" })).toThrow(
      /personId/,
    );
  });
});

describe("formatIssue", () => {
  it("prefixes the path", () => {
    expect(
      formatIssue({ path: ["params", "minCm"], message: "Too small" }),
    ).toBe("params.minCm: Too small");
    expect(formatIssue({ path: [], message: "Nothing to update" })).toBe(
      "Nothing to update",
    );
    expect(formatIssue(undefined)).toBe("Invalid request");
  });
});
