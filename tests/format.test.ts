import { describe, expect, it } from "vitest";
import { formatPct, formatPrice, kickoffParts } from "../lib/format";

describe("formatPct", () => {
  it("renders zero and negatives as an em dash", () => {
    expect(formatPct(0)).toBe("—");
    expect(formatPct(-0.2)).toBe("—");
  });

  it("renders sub-1% probabilities as <1%", () => {
    expect(formatPct(0.004)).toBe("<1%");
  });

  it("rounds to whole percent", () => {
    expect(formatPct(0.034)).toBe("3%");
    expect(formatPct(0.987)).toBe("99%");
    expect(formatPct(1)).toBe("100%");
  });
});

describe("formatPrice", () => {
  it("returns null when amount is missing", () => {
    expect(formatPrice(null, "USD")).toBeNull();
  });

  it("formats whole-dollar USD by default", () => {
    expect(formatPrice(125, null)).toBe("$125");
    expect(formatPrice(125, "USD")).toBe("$125");
  });

  it("falls back to plain text on unknown currency codes", () => {
    expect(formatPrice(99, "NOT_A_CODE")).toBe("99 NOT_A_CODE");
  });
});

describe("kickoffParts", () => {
  it("splits a UTC instant into ET date and 24h time", () => {
    // 2026-06-11 19:00 UTC == 15:00 ET (EDT)
    const d = new Date("2026-06-11T19:00:00Z");
    expect(kickoffParts(d)).toEqual({ date: "2026-06-11", time: "15:00" });
  });

  it("normalizes hour 24 to 00 and respects the timezone argument", () => {
    const d = new Date("2026-06-12T00:30:00Z");
    expect(kickoffParts(d, "UTC")).toEqual({ date: "2026-06-12", time: "00:30" });
  });
});
