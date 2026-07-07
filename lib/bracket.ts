// The real knockout bracket (matches 73-104), assembled from two sources:
//
//   1. The results feed — a knockout row appears with its actual teams as soon
//      as the pairing is set, and with scores (plus a shootout winner for drawn
//      games) once played. This is the ground truth for who is in each slot.
//   2. The bracket lineage (data/bracket-2026.json) — which earlier matches
//      feed each slot from the round of 16 on. It fills slots the feed hasn't
//      announced yet (e.g. a semi-final pairing the morning after the quarters)
//      and gives unfilled slots a human label ("Winner Match 97").
//
// `resolveBracket` is pure; `applyKnockoutsToDb` writes the resolved teams,
// scores and advancing side onto the Match rows so the whole site — match
// board, bracket page, projections, per-match predictions — follows the real
// tournament as it unfolds. Called by the nightly cron and the seed.

import type { PrismaClient } from "@prisma/client";
import bracket from "../data/bracket-2026.json";
import type { KnockoutRow } from "./results/parse";

export interface SlotSource {
  winnerOf?: number;
  loserOf?: number;
}
export interface MatchLineage {
  home: SlotSource;
  away: SlotSource;
}

export const FIRST_KNOCKOUT_MATCH = 73;
export const LAST_KNOCKOUT_MATCH = 104;

export const KNOCKOUT_LINEAGE: ReadonlyMap<number, MatchLineage> = new Map(
  Object.entries((bracket as { lineage: Record<string, MatchLineage> }).lineage).map(([no, lin]) => [Number(no), lin]),
);

export function slotLabel(source: SlotSource | undefined): string | null {
  if (!source) return null;
  if (source.winnerOf) return `Winner Match ${source.winnerOf}`;
  if (source.loserOf) return `Loser Match ${source.loserOf}`;
  return null;
}

// Column order for rendering the bracket: walk back from the final so each
// round lists matches in feeder order — the two matches feeding a slot sit
// next to each other, one column to the left. Returns
// [R32(16), R16(8), QF(4), SF(2), FINAL(1)]; the third-place game (103) is not
// part of the tree and is rendered separately.
export function bracketRounds(finalMatchNo = LAST_KNOCKOUT_MATCH): number[][] {
  const rounds: number[][] = [[finalMatchNo]];
  for (;;) {
    const feeders = rounds[0].flatMap((no) => {
      const lin = KNOCKOUT_LINEAGE.get(no);
      if (!lin) return [];
      return [lin.home.winnerOf ?? lin.home.loserOf!, lin.away.winnerOf ?? lin.away.loserOf!];
    });
    if (feeders.length === 0) return rounds;
    rounds.unshift(feeders);
  }
}

export interface BracketSlot {
  fifaMatchNo: number;
  home: string | null; // team code
  away: string | null;
  homeScore: number | null;
  awayScore: number | null;
  winner: string | null; // advancing side (score winner, or shootout winner on a draw)
  loser: string | null;
}

// Merge the feed's knockout rows with the lineage into the full 73-104 slot
// map. Ascending match-number order is a topological order (every feeder has a
// lower number than the match it feeds), so one pass settles everything.
export function resolveBracket(rows: KnockoutRow[]): Map<number, BracketSlot> {
  const slots = new Map<number, BracketSlot>();
  for (let no = FIRST_KNOCKOUT_MATCH; no <= LAST_KNOCKOUT_MATCH; no++) {
    slots.set(no, { fifaMatchNo: no, home: null, away: null, homeScore: null, awayScore: null, winner: null, loser: null });
  }

  for (const r of rows) {
    const s = slots.get(r.fifaMatchNo);
    if (!s) continue;
    s.home = r.home;
    s.away = r.away;
    s.homeScore = r.homeScore;
    s.awayScore = r.awayScore;
    s.winner = r.winner;
    s.loser = r.winner ? (r.winner === r.home ? r.away : r.home) : null;
  }

  const fromSource = (src: SlotSource): string | null => {
    const feeder = slots.get(src.winnerOf ?? src.loserOf ?? -1);
    if (!feeder) return null;
    return src.winnerOf ? feeder.winner : feeder.loser;
  };
  for (let no = FIRST_KNOCKOUT_MATCH; no <= LAST_KNOCKOUT_MATCH; no++) {
    const lin = KNOCKOUT_LINEAGE.get(no);
    if (!lin) continue;
    const s = slots.get(no)!;
    s.home ??= fromSource(lin.home);
    s.away ??= fromSource(lin.away);
  }
  return slots;
}

// Write the resolved bracket onto the knockout Match rows. Only fills — never
// clears — teams, so a hiccup in the feed can't blank out a slot the site
// already shows. Idempotent: rows are only written when something changed.
export async function applyKnockoutsToDb(
  prisma: PrismaClient,
  rows: KnockoutRow[],
): Promise<{ updated: number; slotsFilled: number; completed: number }> {
  const slots = resolveBracket(rows);
  const [teams, matches] = await Promise.all([
    prisma.team.findMany({ select: { id: true, code: true } }),
    prisma.match.findMany({
      where: { fifaMatchNo: { gte: FIRST_KNOCKOUT_MATCH, lte: LAST_KNOCKOUT_MATCH } },
      include: { homeTeam: { select: { code: true } }, awayTeam: { select: { code: true } } },
    }),
  ]);
  const teamIdByCode = new Map(teams.map((t) => [t.code, t.id]));

  let updated = 0;
  let slotsFilled = 0;
  let completed = 0;
  for (const m of matches) {
    const s = slots.get(m.fifaMatchNo);
    if (!s) continue;
    const lin = KNOCKOUT_LINEAGE.get(m.fifaMatchNo);

    const data: Record<string, unknown> = {};
    if (s.home && teamIdByCode.has(s.home) && m.homeTeam?.code !== s.home) data.homeTeamId = teamIdByCode.get(s.home);
    if (s.away && teamIdByCode.has(s.away) && m.awayTeam?.code !== s.away) data.awayTeamId = teamIdByCode.get(s.away);

    // Placeholder labels for slots still TBD ("Winner Match 97").
    const homeLabel = s.home ? null : slotLabel(lin?.home);
    const awayLabel = s.away ? null : slotLabel(lin?.away);
    if (homeLabel !== m.homeLabel && (homeLabel || m.homeLabel)) data.homeLabel = homeLabel;
    if (awayLabel !== m.awayLabel && (awayLabel || m.awayLabel)) data.awayLabel = awayLabel;

    const played = s.homeScore != null && s.awayScore != null;
    if (played && (m.status !== "COMPLETED" || m.homeScore !== s.homeScore || m.awayScore !== s.awayScore)) {
      data.status = "COMPLETED";
      data.homeScore = s.homeScore;
      data.awayScore = s.awayScore;
    }
    if (s.winner && m.winnerCode !== s.winner) data.winnerCode = s.winner;

    if (s.home && s.away) slotsFilled++;
    if (played) completed++;
    if (Object.keys(data).length === 0) continue;
    await prisma.match.update({ where: { fifaMatchNo: m.fifaMatchNo }, data });
    updated++;
  }
  return { updated, slotsFilled, completed };
}
