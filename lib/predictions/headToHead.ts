// Head-to-head matchup model. Reuses the same Elo + Poisson engine that powers
// the tournament projections (lib/predictions/elo.ts) to answer a narrower
// question: if these two specific teams played, what happens?
//
// Two outputs, by design (see the /matches/[id] "Matchup" section):
//   - forecast %  — win/draw/loss + average scoreline, derived from a LARGE run
//     (default 10,000) so the probabilities are stable.
//   - topScorelines — the most likely exact scorelines, surfaced as a short
//     "what usually happens" list. We show ten of them; ten *individual* sims
//     would be far too noisy to quote percentages from, so the headline numbers
//     come from the big run while this list gives the human-readable texture.

import { HOME_ADVANTAGE, HOST_CODES, makeRng, simulateMatch } from "./elo";

export interface Scoreline {
  goalsA: number;
  goalsB: number;
  pct: number; // share of simulations ending in exactly this score
}

export interface HeadToHead {
  iterations: number;
  pWinA: number; // 0..1
  pDraw: number;
  pWinB: number;
  avgGoalsA: number;
  avgGoalsB: number;
  // Implied fair odds (decimal) from our model, for side-by-side with the market.
  fairOdds: { a: number; draw: number; b: number };
  // The N most likely exact scorelines, descending by frequency.
  topScorelines: Scoreline[];
}

export interface HeadToHeadInput {
  eloA: number;
  eloB: number;
  /** team codes, used only to apply the host boost consistently with the sim */
  codeA?: string;
  codeB?: string;
  iterations?: number;
  topN?: number;
  seed?: number;
}

// Raised from 10,000. A single head-to-head match is one Poisson draw per side,
// so 50,000 iterations runs in a few milliseconds while tightening the win/draw/
// loss split to well under a percentage point of Monte Carlo noise.
const DEFAULT_ITERATIONS = 50_000;
const DEFAULT_TOP_N = 10;

function decimalOdds(p: number): number {
  // Guard against divide-by-zero on rare/never outcomes.
  return p > 0 ? Math.round((1 / p) * 100) / 100 : Infinity;
}

export function simulateHeadToHead(input: HeadToHeadInput): HeadToHead {
  const iterations = input.iterations ?? DEFAULT_ITERATIONS;
  const topN = input.topN ?? DEFAULT_TOP_N;
  // Host nations carry the same home-field boost the tournament sim gives them.
  const eloA = input.eloA + (input.codeA && HOST_CODES.has(input.codeA) ? HOME_ADVANTAGE : 0);
  const eloB = input.eloB + (input.codeB && HOST_CODES.has(input.codeB) ? HOME_ADVANTAGE : 0);

  // Deterministic so a given matchup always renders the same numbers.
  const seed = input.seed ?? (Math.round(eloA) * 73856093) ^ (Math.round(eloB) * 19349663);
  const rng = makeRng(seed >>> 0);

  let winA = 0;
  let draw = 0;
  let winB = 0;
  let sumA = 0;
  let sumB = 0;
  const scoreCounts = new Map<string, number>();

  for (let i = 0; i < iterations; i++) {
    const m = simulateMatch(eloA, eloB, rng);
    if (m.result === 1) winA++;
    else if (m.result === -1) winB++;
    else draw++;
    sumA += m.goalsA;
    sumB += m.goalsB;
    const key = `${m.goalsA}-${m.goalsB}`;
    scoreCounts.set(key, (scoreCounts.get(key) ?? 0) + 1);
  }

  const topScorelines: Scoreline[] = [...scoreCounts.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, topN)
    .map(([key, count]) => {
      const [goalsA, goalsB] = key.split("-").map(Number);
      return { goalsA, goalsB, pct: count / iterations };
    });

  const pWinA = winA / iterations;
  const pDraw = draw / iterations;
  const pWinB = winB / iterations;

  return {
    iterations,
    pWinA,
    pDraw,
    pWinB,
    avgGoalsA: sumA / iterations,
    avgGoalsB: sumB / iterations,
    fairOdds: { a: decimalOdds(pWinA), draw: decimalOdds(pDraw), b: decimalOdds(pWinB) },
    topScorelines,
  };
}
