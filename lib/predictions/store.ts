import type { PrismaClient } from "@prisma/client";
import elo from "../../data/elo-ratings.json";
import fixtures from "../../data/fixtures-2026.json";
import { blendElo } from "./elo";
import { runSimulations, type GroupFixture, type TeamInput } from "./simulate";

const DEFAULT_ITERATIONS = 20000;

// Run the Elo Monte Carlo simulation from the static ratings + group fixtures
// and persist per-team probabilities. Shared by the seed and scripts/predict.ts.
export async function computeAndStoreProjections(prisma: PrismaClient, iterations = DEFAULT_ITERATIONS): Promise<number> {
  const ratings = new Map(elo.ratings.map((r) => [r.code, r]));

  const teams: TeamInput[] = (fixtures.teams as { code: string; group: string }[]).map((t) => {
    const r = ratings.get(t.code);
    return { code: t.code, group: t.group, elo: r ? blendElo(r.eloOnline, r.eloModel) : 1500 };
  });

  const groupFixtures: Record<string, GroupFixture[]> = {};
  for (const m of fixtures.groupMatches as { group: string; home: string; away: string }[]) {
    (groupFixtures[m.group] ??= []).push({ home: m.home, away: m.away });
  }

  const probs = runSimulations(teams, groupFixtures, iterations);

  for (const p of probs) {
    const data = {
      group: p.group,
      elo: p.elo,
      pGroupWinner: p.pGroupWinner,
      pQualify: p.pQualify,
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
