import { describe, expect, it } from "vitest";
import {
  formatAge,
  formatBounds,
  formatMetres,
  formatPence,
  formatPenceRange,
  formatProductSize,
  formatRoomSize,
  parseOptionalNumber,
  titleCase,
} from "./format";

describe("money", () => {
  it("formats whole pounds without pence", () => {
    expect(formatPence(600000)).toBe("£6,000");
    expect(formatPence(0)).toBe("£0");
  });
  it("keeps pence when present", () => {
    expect(formatPence(1299)).toBe("£12.99");
    expect(formatPence(123456)).toBe("£1,234.56");
  });
  it("shows a dash for missing values", () => {
    expect(formatPence(null)).toBe("—");
    expect(formatPence(undefined)).toBe("—");
  });
  it("formats ranges to whole pounds and collapses equal ends", () => {
    expect(formatPenceRange(15000, 30000)).toBe("£150–£300");
    expect(formatPenceRange(12999, 12999)).toBe("£130");
    expect(formatPenceRange(12940, 13010)).toBe("£129–£130");
  });
});

describe("sizes", () => {
  it("formats metres and room sizes", () => {
    expect(formatMetres(460)).toBe("4.6 m");
    expect(formatMetres(null)).toBe("?");
    expect(formatRoomSize(460, 380)).toBe("4.6 × 3.8 m");
    expect(formatRoomSize(null, 380)).toBe("Size unknown");
  });
  it("describes requirement bounds", () => {
    expect(formatBounds({})).toBeNull();
    expect(
      formatBounds({ minWidthCm: 180, maxWidthCm: 220, maxDepthCm: 95 }),
    ).toBe("W 180–220 · D ≤ 95 cm");
    expect(formatBounds({ maxWidthCm: 120.4, maxHeightCm: 75 })).toBe(
      "W ≤ 120 · H ≤ 75 cm",
    );
    expect(formatBounds({ minWidthCm: 90 })).toBe("W ≥ 90 cm");
  });
  it("describes product sizes, skipping unknown dimensions", () => {
    expect(
      formatProductSize({ widthCm: 200, depthCm: 90, heightCm: null }),
    ).toBe("W 200 × D 90 cm");
    expect(
      formatProductSize({ widthCm: null, depthCm: null, heightCm: null }),
    ).toBeNull();
  });
});

describe("misc", () => {
  it("parses optional numbers", () => {
    expect(parseOptionalNumber("")).toBeUndefined();
    expect(parseOptionalNumber(" 1,200 ")).toBe(1200);
    expect(Number.isNaN(parseOptionalNumber("abc"))).toBe(true);
  });
  it("title-cases categories", () => {
    expect(titleCase("coffee_table")).toBe("Coffee table");
  });
  it("formats ages", () => {
    const now = Date.parse("2026-01-02T12:00:00Z");
    expect(formatAge("2026-01-02T11:59:50Z", now)).toBe("just now");
    expect(formatAge("2026-01-02T11:30:00Z", now)).toBe("30 min ago");
    expect(formatAge("2026-01-02T06:00:00Z", now)).toBe("6 h ago");
    expect(formatAge("2025-12-28T12:00:00Z", now)).toBe("5 days ago");
  });
});
