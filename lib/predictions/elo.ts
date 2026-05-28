// Elo-based match model. Two rating sources (online World Football Elo and a
// Silver/SPI-style model) are blended into a single Elo per team; match outcomes
// are simulated with a Poisson goals model driven by the Elo difference, which
// yields wins/draws/losses AND goal differences for group tiebreakers.

export const BLEND_WEIGHT_ONLINE = 0.5; // 0..1 weight on eloOnline vs eloModel

const ELO_PER_GOAL = 100; // ~100 Elo points ≈ one expected goal of edge
const BASE_GOALS = 1.35; // baseline expected goals per side for even teams
export const HOME_ADVANTAGE = 60; // Elo boost for host nations playing at home

export const HOST_CODES = new Set(["USA", "MEX", "CAN"]);

export function blendElo(eloOnline: number, eloModel: number, w = BLEND_WEIGHT_ONLINE): number {
  return w * eloOnline + (1 - w) * eloModel;
}

// Expected win probability for A (used for knockout shootouts / coin flips).
export function expectedScore(eloA: number, eloB: number): number {
  return 1 / (1 + 10 ** ((eloB - eloA) / 400));
}

function poisson(lambda: number, rng: () => number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

export interface SimMatch {
  goalsA: number;
  goalsB: number;
  // 1 = A wins, 0 = draw, -1 = B wins
  result: 1 | 0 | -1;
}

export function simulateMatch(eloA: number, eloB: number, rng: () => number): SimMatch {
  const dr = eloA - eloB;
  const expGD = dr / ELO_PER_GOAL;
  const lambdaA = Math.min(6, Math.max(0.15, BASE_GOALS + expGD / 2));
  const lambdaB = Math.min(6, Math.max(0.15, BASE_GOALS - expGD / 2));
  const goalsA = poisson(lambdaA, rng);
  const goalsB = poisson(lambdaB, rng);
  const result = goalsA > goalsB ? 1 : goalsA < goalsB ? -1 : 0;
  return { goalsA, goalsB, result };
}

// Knockout: a match that can't end in a draw — extra time/penalties resolved as
// an Elo-weighted coin flip.
export function simulateKnockout(eloA: number, eloB: number, rng: () => number): 1 | -1 {
  const m = simulateMatch(eloA, eloB, rng);
  if (m.result !== 0) return m.result;
  return rng() < expectedScore(eloA, eloB) ? 1 : -1;
}

// Small, fast, seedable PRNG (mulberry32) so projections are reproducible.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
