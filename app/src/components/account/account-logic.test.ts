import { describe, expect, it } from "vitest";
import {
  accountInitial,
  clearLocalJourneyData,
  filenameFromDisposition,
  isDeleteConfirmed,
  RETENTION_NOTICE,
} from "./account-logic";

describe("clearLocalJourneyData", () => {
  it("removes the journey and rooms keys only", () => {
    const store = new Map([
      ["deloitful.journey", "{}"],
      ["deloitful.rooms", "[]"],
      ["other", "keep"],
    ]);
    clearLocalJourneyData({ removeItem: (k: string) => store.delete(k) });
    expect([...store.keys()]).toEqual(["other"]);
  });

  it("ignores storage errors", () => {
    expect(() =>
      clearLocalJourneyData({
        removeItem: () => {
          throw new Error("blocked");
        },
      }),
    ).not.toThrow();
  });
});

describe("isDeleteConfirmed", () => {
  it("needs the word DELETE", () => {
    expect(isDeleteConfirmed("")).toBe(false);
    expect(isDeleteConfirmed("DEL")).toBe(false);
    expect(isDeleteConfirmed("delete me")).toBe(false);
    expect(isDeleteConfirmed("DELETE")).toBe(true);
    expect(isDeleteConfirmed(" delete ")).toBe(true);
  });
});

describe("filenameFromDisposition", () => {
  const now = new Date("2026-11-20T10:00:00Z");
  it("uses the server filename", () => {
    expect(
      filenameFromDisposition(
        'attachment; filename="deloitful-home-export-2026-11-19.json"',
        now,
      ),
    ).toBe("deloitful-home-export-2026-11-19.json");
  });
  it("falls back to a dated name for missing or unsafe names", () => {
    const fallback = "deloitful-home-export-2026-11-20.json";
    expect(filenameFromDisposition(null, now)).toBe(fallback);
    expect(
      filenameFromDisposition('attachment; filename="../../x.json"', now),
    ).toBe(fallback);
  });
});

describe("accountInitial", () => {
  it("prefers the first name, then the email", () => {
    expect(accountInitial({ firstName: "ada", email: "x@y.com" })).toBe("A");
    expect(accountInitial({ firstName: " ", email: "e2e+1@example.com" })).toBe(
      "E",
    );
    expect(accountInitial({})).toBe("?");
  });
});

describe("RETENTION_NOTICE", () => {
  it("states the buyer retention periods from the shared constants", () => {
    const text = RETENTION_NOTICE.join(" ");
    expect(text).toContain("180 days");
    expect(text).toContain("30 days");
  });
});
