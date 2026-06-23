// Per-match Elo predictions — the win / draw / loss split shown on the home
// page game cards and graded on the /accuracy page.
//
// Two lifecycles:
//   - LIVE: for an upcoming match we compute the split on the fly from the
//     current blended Elo (simulateHeadToHead), so the card always reflects the
//     latest ratings.
//   - FROZEN: the nightly cron (refreshMatchPredictions) snapshots the split the
//     night before kickoff and marks it frozen. A frozen row is NEVER recomputed,
//     so once a match is played we keep grading the model against the prediction
//     it actually made beforehand — data refreshes can't rewrite history.

import type { PrismaClient } from "@prisma/client";
import { simulateHeadToHead } from "./headToHead";
import { getBlendedElo } from "./ratings";

export type Outcome = "A" | "DRAW" | "B";

export interface MatchPredictionValue {
  pWinA: number; // 0..1, home team win
  pDraw: number;
  pWinB: number; // 0..1, away team win
  eloA: number; // blended Elo (display), host boost applied inside the sim
  eloB: number;
  iterations: number;
  topScoreline: { goalsA: number; goalsB: number } | null;
}

// Freeze a prediction once the match is within this window of kickoff (i.e. the
// last nightly run before the game) or already played.
const FREEZE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function predictMatch(codeA: string | null | undefined, codeB: string | null | undefined): MatchPredictionValue | null {
  const eloA = getBlendedElo(codeA);
  const eloB = getBlendedElo(codeB);
  if (eloA == null || eloB == null) return null;
  const h2h = simulateHeadToHead({ eloA, eloB, codeA: codeA ?? undefined, codeB: codeB ?? undefined });
  const top = h2h.topScorelines[0] ?? null;
  return {
    pWinA: h2h.pWinA, pDraw: h2h.pDraw, pWinB: h2h.pWinB, eloA, eloB, iterations: h2h.iterations,
    topScoreline: top ? { goalsA: top.goalsA, goalsB: top.goalsB } : null,
  };
}

// Which of the three outcomes the model thinks is most likely. Ties break toward
// a decisive result (rare with continuous probabilities).
export function mostLikelyOutcome(v: { pWinA: number; pDraw: number; pWinB: number }): Outcome {
  if (v.pWinA >= v.pDraw && v.pWinA >= v.pWinB) return "A";
  if (v.pWinB >= v.pDraw && v.pWinB >= v.pWinA) return "B";
  return "DRAW";
}

// The team more likely to win outright, ignoring the draw — the "most likely
// winner" surfaced in the right column of each card.
export function favoredWinner(v: { pWinA: number; pWinB: number }): { side: "A" | "B"; p: number } {
  return v.pWinA >= v.pWinB ? { side: "A", p: v.pWinA } : { side: "B", p: v.pWinB };
}

export function actualOutcome(homeScore: number, awayScore: number): Outcome {
  return homeScore > awayScore ? "A" : homeScore < awayScore ? "B" : "DRAW";
}

export interface ResolvedPrediction extends MatchPredictionValue {
  frozen: boolean; // true = stored snapshot, false = live estimate
  live: boolean; // true = computed on the fly (no stored row)
}

type StoredPrediction = {
  eloA: number;
  eloB: number;
  pWinA: number;
  pDraw: number;
  pWinB: number;
  iterations: number;
  frozen: boolean;
};

// Prefer the stored (possibly frozen) snapshot; otherwise compute live so cards
// still render before the cron has ever run.
export function resolvePrediction(
  stored: StoredPrediction | undefined,
  codeA: string | null | undefined,
  codeB: string | null | undefined,
): ResolvedPrediction | null {
  if (stored) {
    // Sim is deterministic (seeded from Elos), so re-derive the top scoreline
    // without storing it — avoids a schema change.
    const h2h = simulateHeadToHead({ eloA: stored.eloA, eloB: stored.eloB, codeA: codeA ?? undefined, codeB: codeB ?? undefined });
    const top = h2h.topScorelines[0] ?? null;
    return {
      pWinA: stored.pWinA,
      pDraw: stored.pDraw,
      pWinB: stored.pWinB,
      eloA: stored.eloA,
      eloB: stored.eloB,
      iterations: stored.iterations,
      frozen: stored.frozen,
      live: false,
      topScoreline: top ? { goalsA: top.goalsA, goalsB: top.goalsB } : null,
    };
  }
  const v = predictMatch(codeA, codeB);
  if (!v) return null;
  return { ...v, frozen: false, live: true };
}

// Nightly job: compute predictions for every fixture with both teams known and
// freeze the ones inside the kickoff window. Frozen rows are left untouched.
export async function refreshMatchPredictions(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{ computed: number; frozen: number; skipped: number }> {
  const [matches, stored] = await Promise.all([
    prisma.match.findMany({ include: { homeTeam: true, awayTeam: true } }),
    prisma.matchPrediction.findMany(),
  ]);
  const existing = new Map(stored.map((p) => [p.matchId, p]));

  let computed = 0;
  let frozen = 0;
  let skipped = 0;

  for (const m of matches) {
    const prev = existing.get(m.id);
    if (prev?.frozen) {
      skipped++;
      continue; // never recompute a frozen prediction
    }
    const codeA = m.homeTeam?.code ?? null;
    const codeB = m.awayTeam?.code ?? null;
    const v = predictMatch(codeA, codeB);
    if (!v) continue; // teams TBD or no Elo

    const shouldFreeze = m.status === "COMPLETED" || m.kickoff.getTime() - now.getTime() <= FREEZE_WINDOW_MS;

    const data = {
      fifaMatchNo: m.fifaMatchNo,
      homeCode: codeA,
      awayCode: codeB,
      eloA: Math.round(v.eloA),
      eloB: Math.round(v.eloB),
      pWinA: v.pWinA,
      pDraw: v.pDraw,
      pWinB: v.pWinB,
      iterations: v.iterations,
      frozen: shouldFreeze,
    };
    await prisma.matchPrediction.upsert({
      where: { matchId: m.id },
      create: { matchId: m.id, ...data },
      update: data,
    });
    computed++;
    if (shouldFreeze) frozen++;
  }

  return { computed, frozen, skipped };
}
