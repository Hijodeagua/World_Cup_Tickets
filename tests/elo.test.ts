import { describe, expect, it } from "vitest";
import {
  BLEND_WEIGHT_ONLINE,
  blendElo,
  expectedScore,
  makeRng,
  simulateKnockout,
  simulateMatch,
} from "../lib/predictions/elo";

describe("blendElo", () => {
  it("averages with the default weight", () => {
    expect(blendElo(2000, 1800)).toBeCloseTo(2000 * BLEND_WEIGHT_ONLINE + 1800 * (1 - BLEND_WEIGHT_ONLINE));
  });

  it("respects an explicit weight", () => {
    expect(blendElo(2000, 1800, 1)).toBe(2000);
    expect(blendElo(2000, 1800, 0)).toBe(1800);
  });
});

describe("expectedScore", () => {
  it("is 0.5 for equal ratings and symmetric", () => {
    expect(expectedScore(1900, 1900)).toBeCloseTo(0.5);
    expect(expectedScore(2000, 1800) + expectedScore(1800, 2000)).toBeCloseTo(1);
  });

  it("is monotone in the rating gap", () => {
    expect(expectedScore(2000, 1800)).toBeGreaterThan(expectedScore(1900, 1800));
  });
});

describe("makeRng", () => {
  it("is deterministic for a given seed and in [0, 1)", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("simulateMatch / simulateKnockout", () => {
  it("produces consistent result codes and non-negative goals", () => {
    const rng = makeRng(7);
    for (let i = 0; i < 200; i++) {
      const m = simulateMatch(1950, 1850, rng);
      expect(m.goalsA).toBeGreaterThanOrEqual(0);
      expect(m.goalsB).toBeGreaterThanOrEqual(0);
      const expected = m.goalsA > m.goalsB ? 1 : m.goalsA < m.goalsB ? -1 : 0;
      expect(m.result).toBe(expected);
    }
  });

  it("favors the stronger side over many simulations", () => {
    const rng = makeRng(2026);
    let wins = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      if (simulateKnockout(2100, 1700, rng) === 1) wins++;
    }
    expect(wins / n).toBeGreaterThan(0.7);
  });

  it("knockout never returns a draw", () => {
    const rng = makeRng(11);
    for (let i = 0; i < 500; i++) {
      expect([1, -1]).toContain(simulateKnockout(1900, 1900, rng));
    }
  });
});
