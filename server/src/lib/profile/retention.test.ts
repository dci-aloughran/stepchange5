import { describe, expect, it } from "vitest";
import { addDays, initialRetention, resolveRetention } from "./retention.js";

const now = new Date("2026-11-20T12:00:00Z");

describe("initialRetention (SE-011)", () => {
  it("gives buyer homes a 180-day buyer_active retention", () => {
    expect(initialRetention("buyer", now)).toEqual({
      journeyType: "buyer",
      retentionState: "buyer_active",
      retainUntil: new Date("2027-05-19T12:00:00Z"),
    });
  });

  it("keeps homeowner homes active without expiry", () => {
    expect(initialRetention("homeowner", now)).toEqual({
      journeyType: "homeowner",
      retentionState: "active",
      retainUntil: null,
    });
  });
});

describe("resolveRetention", () => {
  const buyer = initialRetention("buyer", new Date("2026-01-01T00:00:00Z"));

  it("expires 30 days after a purchase stops proceeding", () => {
    expect(
      resolveRetention(
        buyer,
        { retentionState: "purchase_not_proceeding" },
        now,
      ),
    ).toEqual({
      journeyType: "buyer",
      retentionState: "purchase_not_proceeding",
      retainUntil: addDays(now, 30),
    });
  });

  it("converts a purchased home to an active homeowner home", () => {
    expect(resolveRetention(buyer, { retentionState: "active" }, now)).toEqual({
      journeyType: "homeowner",
      retentionState: "active",
      retainUntil: null,
    });
  });

  it("restarts buyer retention when re-activated", () => {
    const stopped = {
      journeyType: "buyer" as const,
      retentionState: "purchase_not_proceeding" as const,
      retainUntil: now,
    };
    expect(
      resolveRetention(stopped, { retentionState: "buyer_active" }, now)
        ?.retainUntil,
    ).toEqual(addDays(now, 180));
  });

  it("applies the journey's retention when only journeyType changes", () => {
    const owner = initialRetention("homeowner", now);
    expect(resolveRetention(owner, { journeyType: "buyer" }, now)).toEqual(
      initialRetention("buyer", now),
    );
  });

  it("returns null when nothing retention-related changes", () => {
    expect(resolveRetention(buyer, {}, now)).toBeNull();
    expect(
      resolveRetention(
        buyer,
        { journeyType: "buyer", retentionState: "buyer_active" },
        now,
      ),
    ).toBeNull();
  });
});
