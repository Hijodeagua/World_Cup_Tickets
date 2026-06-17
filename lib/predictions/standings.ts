// Group standings computed from completed match results (status === COMPLETED).
//
// Pure function over match rows so it works for both the live DB-backed groups
// page and tests. World Cup group ranking: points (3/1/0), then goal
// difference, then goals for. (Head-to-head and the further FIFA tiebreakers
// are not modeled; ties below GF fall back to alphabetical code for stability.)

export interface ResultInput {
  group: string | null;
  homeCode: string | null;
  awayCode: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
}

export interface StandingRow {
  code: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
}

function empty(code: string): StandingRow {
  return { code, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
}

export function cmpStanding(a: StandingRow, b: StandingRow): number {
  if (b.pts !== a.pts) return b.pts - a.pts;
  if (b.gd !== a.gd) return b.gd - a.gd;
  if (b.gf !== a.gf) return b.gf - a.gf;
  return a.code.localeCompare(b.code);
}

// teamsByGroup seeds rows for every team so a group with no results yet still
// renders all four sides at 0. Returns standings per group, each sorted.
export function computeStandings(
  matches: ResultInput[],
  teamsByGroup: Record<string, string[]>,
): Record<string, StandingRow[]> {
  const rows = new Map<string, StandingRow>();
  for (const [, codes] of Object.entries(teamsByGroup)) {
    for (const code of codes) rows.set(code, empty(code));
  }

  for (const m of matches) {
    if (m.status !== "COMPLETED" || m.homeScore == null || m.awayScore == null) continue;
    if (!m.homeCode || !m.awayCode) continue;
    const home = rows.get(m.homeCode) ?? empty(m.homeCode);
    const away = rows.get(m.awayCode) ?? empty(m.awayCode);
    rows.set(m.homeCode, home);
    rows.set(m.awayCode, away);

    home.played++; away.played++;
    home.gf += m.homeScore; home.ga += m.awayScore;
    away.gf += m.awayScore; away.ga += m.homeScore;
    home.gd = home.gf - home.ga;
    away.gd = away.gf - away.ga;
    if (m.homeScore > m.awayScore) {
      home.won++; away.lost++; home.pts += 3;
    } else if (m.homeScore < m.awayScore) {
      away.won++; home.lost++; away.pts += 3;
    } else {
      home.drawn++; away.drawn++; home.pts++; away.pts++;
    }
  }

  const byGroup: Record<string, StandingRow[]> = {};
  for (const [group, codes] of Object.entries(teamsByGroup)) {
    byGroup[group] = codes.map((c) => rows.get(c) ?? empty(c)).sort(cmpStanding);
  }
  return byGroup;
}
