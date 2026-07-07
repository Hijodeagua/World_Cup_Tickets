import type { PrismaClient } from "@prisma/client";
import elo from "../../data/elo-ratings.json";
import fixtures from "../../data/fixtures-2026.json";
import { FIRST_KNOCKOUT_MATCH, LAST_KNOCKOUT_MATCH } from "../bracket";
import { ensureMatchColumns, ensureProjectionColumns } from "../ensure-schema";
import { blendElo } from "./elo";
import { runSimulations, type GroupFixture, type KnockoutSlotState, type PlayedMatch, type TeamInput } from "./simulate";

// Raised from 20,000. Each tournament iteration simulates 72 group matches plus
// a 31-match knockout bracket (~103 match sims), so 100,000 iterations is ~10M
// match simulations — a few seconds of single-threaded work, comfortably inside
// the predictions cron's 120s budget (see app/api/cron/predictions/route.ts).
// Monte Carlo error falls as 1/sqrt(N), so beyond ~250k the precision gain is
// not worth the time; 100k keeps per-team champion odds stable to a few tenths
// of a percent.
const DEFAULT_ITERATIONS = 100000;

// Run the Elo Monte Carlo simulation from the ratings + group fixtures and
// persist per-team probabilities. Group matches that have already been played
// are fixed rather than simulated, so projections update after every real
// result. The played results come from the COMPLETED Match rows in the database
// — the same source the standings read — so the groups page never shows
// standings and projections that disagree (e.g. a team that has clinched
// reading below 100% to advance). Shared by the seed, scripts/predict.ts, and
// the nightly cron, which applies the latest results onto Match rows first.
export async function computeAndStoreProjections(prisma: PrismaClient, iterations = DEFAULT_ITERATIONS): Promise<number> {
  await ensureMatchColumns(prisma);
  await ensureProjectionColumns(prisma);

  const ratings = new Map(elo.ratings.map((r) => [r.code, r]));

  const teams: TeamInput[] = (fixtures.teams as { code: string; group: string }[]).map((t) => {
    const r = ratings.get(t.code);
    return { code: t.code, group: t.group, elo: r ? blendElo(r.eloOnline, r.eloModel) : 1500 };
  });

  const groupFixtures: Record<string, GroupFixture[]> = {};
  for (const m of fixtures.groupMatches as { group: string; home: string; away: string }[]) {
    (groupFixtures[m.group] ??= []).push({ home: m.home, away: m.away });
  }

  // Condition on real results from the database: every completed group match,
  // oriented home|away exactly as the fixtures (matches are seeded from them).
  const completed = await prisma.match.findMany({
    where: { stage: "GROUP", status: "COMPLETED" },
    include: { homeTeam: { select: { code: true } }, awayTeam: { select: { code: true } } },
  });
  const playedResults: PlayedMatch[] = completed
    .filter((m) => m.homeTeam && m.awayTeam && m.homeScore != null && m.awayScore != null)
    .map((m) => ({
      home: m.homeTeam!.code,
      away: m.awayTeam!.code,
      homeScore: m.homeScore!,
      awayScore: m.awayScore!,
    }));

  // Real knockout bracket state (teams filled by the nightly knockout sync).
  // Once every round-of-32 slot is set, the simulation follows THIS bracket —
  // real results fixed, the rest simulated — instead of an Elo-seeded one.
  const koMatches = await prisma.match.findMany({
    where: { fifaMatchNo: { gte: FIRST_KNOCKOUT_MATCH, lte: LAST_KNOCKOUT_MATCH } },
    include: { homeTeam: { select: { code: true } }, awayTeam: { select: { code: true } } },
  });
  const knockout: KnockoutSlotState[] = koMatches.map((m) => {
    const home = m.homeTeam?.code ?? null;
    const away = m.awayTeam?.code ?? null;
    // Advancing side: the recorded winner (covers shootouts), or the score
    // winner for a decisive completed game missing a winnerCode.
    let winner = m.winnerCode ?? null;
    if (!winner && m.status === "COMPLETED" && m.homeScore != null && m.awayScore != null && m.homeScore !== m.awayScore) {
      winner = m.homeScore > m.awayScore ? home : away;
    }
    return { fifaMatchNo: m.fifaMatchNo, home, away, winner };
  });

  const probs = runSimulations(teams, groupFixtures, iterations, 1234, playedResults, knockout);

  // Baseline "at tournament start" advance odds: the full pre-tournament
  // simulation with no results fixed. Captured once per team and never
  // overwritten, so the "(was X%)" reference on the groups page stays anchored
  // to kickoff even as ratings drift through the tournament.
  const prior = new Map(
    (await prisma.teamProjection.findMany({ select: { code: true, baselinePQualify: true } })).map((p) => [
      p.code,
      p.baselinePQualify,
    ]),
  );
  const needBaseline = teams.some((t) => prior.get(t.code) == null);
  const freshBaseline = new Map<string, number>();
  if (needBaseline) {
    const base = playedResults.length === 0 ? probs : runSimulations(teams, groupFixtures, iterations, 1234, []);
    for (const b of base) freshBaseline.set(b.code, b.pQualify);
  }

  for (const p of probs) {
    const baselinePQualify = prior.get(p.code) ?? freshBaseline.get(p.code) ?? null;
    const data = {
      group: p.group,
      elo: p.elo,
      pGroupWinner: p.pGroupWinner,
      pQualify: p.pQualify,
      baselinePQualify,
      pR16: p.pR16,
      pQF: p.pQF,
      pSF: p.pSF,
      pFinal: p.pFinal,
      pChampion: p.pChampion,
      iterations,
    };
    await prisma.teamProjection.upsert({
      where: { code: p.code },
      create: { code: p.code, ...data },
      update: data,
    });
  }
  return probs.length;
}
