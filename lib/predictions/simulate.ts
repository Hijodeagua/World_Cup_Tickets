import {
  HOME_ADVANTAGE,
  HOST_CODES,
  blendElo,
  makeRng,
  simulateKnockout,
  simulateMatch,
} from "./elo";

export interface TeamInput {
  code: string;
  group: string;
  elo: number; // blended
}
export interface GroupFixture {
  home: string;
  away: string;
}
// A group match already played: its result is fixed, not simulated, so
// projections update after every real outcome. Keyed by "home|away" (fixture
// orientation) within rankGroup.
export interface PlayedMatch {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
}

// Standard 32-seed single-elimination bracket order (seeds, 1-indexed) so higher
// seeds are kept apart until later rounds.
const BRACKET_SEED_ORDER = [
  1, 32, 16, 17, 8, 25, 9, 24, 4, 29, 13, 20, 5, 28, 12, 21, 2, 31, 15, 18, 7, 26, 10, 23, 3, 30, 14, 19, 6, 27, 11, 22,
];

export interface TeamProbabilities {
  code: string;
  group: string;
  elo: number;
  pGroupWinner: number;
  pQualify: number; // reach round of 32
  pR16: number;
  pQF: number;
  pSF: number;
  pFinal: number;
  pChampion: number;
}

interface Standing {
  code: string;
  pts: number;
  gd: number;
  gf: number;
  elo: number;
}

function rankGroup(
  teams: TeamInput[],
  fixtures: GroupFixture[],
  groupElo: Map<string, number>,
  rng: () => number,
  played?: Map<string, PlayedMatch>,
): Standing[] {
  const s = new Map<string, Standing>();
  for (const t of teams) s.set(t.code, { code: t.code, pts: 0, gd: 0, gf: 0, elo: t.elo });

  for (const f of fixtures) {
    const a = s.get(f.home);
    const b = s.get(f.away);
    if (!a || !b) continue;
    // Use the real result if this match has been played; otherwise simulate it.
    const fixed = played?.get(`${f.home}|${f.away}`);
    const goalsA = fixed ? fixed.homeScore : 0;
    const goalsB = fixed ? fixed.awayScore : 0;
    const m = fixed
      ? { goalsA, goalsB, result: goalsA > goalsB ? 1 : goalsA < goalsB ? -1 : 0 }
      : simulateMatch(groupElo.get(f.home)!, groupElo.get(f.away)!, rng);
    a.gf += m.goalsA;
    b.gf += m.goalsB;
    a.gd += m.goalsA - m.goalsB;
    b.gd += m.goalsB - m.goalsA;
    if (m.result === 1) a.pts += 3;
    else if (m.result === -1) b.pts += 3;
    else {
      a.pts += 1;
      b.pts += 1;
    }
  }

  return [...s.values()].sort(cmpStanding);
}

function cmpStanding(x: Standing, y: Standing): number {
  if (y.pts !== x.pts) return y.pts - x.pts;
  if (y.gd !== x.gd) return y.gd - x.gd;
  if (y.gf !== x.gf) return y.gf - x.gf;
  return y.elo - x.elo;
}

export function runSimulations(
  teams: TeamInput[],
  groupFixtures: Record<string, GroupFixture[]>,
  iterations = 20000,
  seed = 1234,
  playedResults: PlayedMatch[] = [],
): TeamProbabilities[] {
  const rng = makeRng(seed);
  const byCode = new Map(teams.map((t) => [t.code, t]));
  const groups = [...new Set(teams.map((t) => t.group))].sort();

  // Index played matches by "home|away" so rankGroup can fix their outcomes.
  const playedByMatch = new Map<string, PlayedMatch>();
  for (const p of playedResults) playedByMatch.set(`${p.home}|${p.away}`, p);

  // Group-stage Elo includes a host boost; knockout uses base Elo.
  const groupElo = new Map<string, number>();
  for (const t of teams) groupElo.set(t.code, t.elo + (HOST_CODES.has(t.code) ? HOME_ADVANTAGE : 0));

  const counts = new Map<string, { gw: number; q: number; r16: number; qf: number; sf: number; fin: number; champ: number }>();
  for (const t of teams) counts.set(t.code, { gw: 0, q: 0, r16: 0, qf: 0, sf: 0, fin: 0, champ: 0 });

  for (let i = 0; i < iterations; i++) {
    const winners: string[] = [];
    const runners: string[] = [];
    const thirds: Standing[] = [];

    for (const g of groups) {
      const gteams = teams.filter((t) => t.group === g);
      const standings = rankGroup(gteams, groupFixtures[g] ?? [], groupElo, rng, playedByMatch);
      winners.push(standings[0].code);
      runners.push(standings[1].code);
      thirds.push(standings[2]);
      counts.get(standings[0].code)!.gw++;
    }

    const bestThirds = [...thirds].sort(cmpStanding).slice(0, 8).map((t) => t.code);
    const qualifiers = [...winners, ...runners, ...bestThirds];
    for (const c of qualifiers) counts.get(c)!.q++;

    // Seed the bracket by blended Elo.
    const seeded = [...qualifiers].sort((a, b) => byCode.get(b)!.elo - byCode.get(a)!.elo);
    let bracket = BRACKET_SEED_ORDER.map((seed) => seeded[seed - 1]);

    // Single elimination. Record each round survivors reach.
    while (bracket.length > 1) {
      const next: string[] = [];
      for (let j = 0; j < bracket.length; j += 2) {
        const a = bracket[j];
        const b = bracket[j + 1];
        const res = simulateKnockout(byCode.get(a)!.elo, byCode.get(b)!.elo, rng);
        next.push(res === 1 ? a : b);
      }
      // `next` are the survivors of this round. Each team passes through a given
      // survivor-count exactly once, so increment that bucket only on equality.
      const survivorRound = next.length; // 16, 8, 4, 2, 1
      for (const c of next) {
        const k = counts.get(c)!;
        if (survivorRound === 16) k.r16++;
        else if (survivorRound === 8) k.qf++;
        else if (survivorRound === 4) k.sf++;
        else if (survivorRound === 2) k.fin++;
        else if (survivorRound === 1) k.champ++;
      }
      bracket = next;
    }
  }

  const out: TeamProbabilities[] = teams.map((t) => {
    const c = counts.get(t.code)!;
    return {
      code: t.code,
      group: t.group,
      elo: Math.round(t.elo),
      pGroupWinner: c.gw / iterations,
      pQualify: c.q / iterations,
      pR16: c.r16 / iterations,
      pQF: c.qf / iterations,
      pSF: c.sf / iterations,
      pFinal: c.fin / iterations,
      pChampion: c.champ / iterations,
    };
  });

  out.sort((a, b) => b.pChampion - a.pChampion || b.pSF - a.pSF || b.elo - a.elo);
  return out;
}
