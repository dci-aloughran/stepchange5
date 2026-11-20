import { describe, expect, it } from "vitest";
import { countByState, isExpired, selectExpired } from "./retention.js";

const NOW = new Date("2026-11-20T03:17:00Z");
const before = new Date("2026-11-20T03:16:59Z");
const after = new Date("2026-11-20T03:17:01Z");

const home = (
  id: string,
  retentionState: string,
  retainUntil: Date | null,
) => ({ id, retentionState, retainUntil });

describe("retention selection", () => {
  it("expires buyer homes whose retainUntil has passed", () => {
    expect(isExpired(home("a", "buyer_active", before), NOW)).toBe(true);
    expect(isExpired(home("b", "purchase_not_proceeding", before), NOW)).toBe(
      true,
    );
  });

  it("expires exactly at retainUntil", () => {
    expect(isExpired(home("a", "buyer_active", NOW), NOW)).toBe(true);
  });

  it("keeps homes that are still within their retention window", () => {
    expect(isExpired(home("a", "buyer_active", after), NOW)).toBe(false);
    expect(isExpired(home("b", "purchase_not_proceeding", after), NOW)).toBe(
      false,
    );
  });

  it("never expires homes without an expiry", () => {
    expect(isExpired(home("a", "buyer_active", null), NOW)).toBe(false);
    expect(isExpired(home("b", "active", null), NOW)).toBe(false);
  });

  it("never expires homeowner/purchased homes, even with a stray date", () => {
    expect(isExpired(home("a", "active", before), NOW)).toBe(false);
    expect(isExpired(home("b", "something_else", before), NOW)).toBe(false);
  });

  it("selects only the expired homes and counts them by state", () => {
    const homes = [
      home("1", "buyer_active", before),
      home("2", "buyer_active", after),
      home("3", "purchase_not_proceeding", before),
      home("4", "active", before),
      home("5", "active", null),
      home("6", "purchase_not_proceeding", before),
    ];
    const expired = selectExpired(homes, NOW);
    expect(expired.map((h) => h.id)).toEqual(["1", "3", "6"]);
    expect(countByState(expired)).toEqual({
      buyer_active: 1,
      purchase_not_proceeding: 2,
    });
  });
});
