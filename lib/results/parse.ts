// Shared parser/mapper for the martj42 international-results CSV (the feed behind
// the Can-Tre-Beat-Vegas dataset). Given the raw CSV text, returns the played
// World Cup 2026 group-stage results aligned to our fixtures (fifaMatchNo),
// oriented to each fixture's home/away. Pure — no filesystem or network — so it
// is shared by both scripts/sync-results.ts (file in, file out) and the nightly
// predictions cron (live fetch in, DB out).

import fixtures from "../../data/fixtures-2026.json";
import nameMap from "../../data/team-name-map.json";

export interface ResultRow {
  fifaMatchNo: number;
  date: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
}

interface GroupMatch {
  date: string;
  group: string;
  home: string;
  away: string;
}

const SEASON_START = "2026-06-01";

// Minimal CSV parser: the results feed has no quoted/embedded commas.
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

// Parse the raw results CSV into our oriented, fixture-aligned result rows.
// `unmatched` collects rows that could not be mapped (logged by callers).
export function parseWorldCupResultsCsv(text: string): { results: ResultRow[]; unmatched: string[] } {
  // Build engineName -> code from the explicit map plus fixture names.
  const codeToName = (nameMap as { codeToEngineName: Record<string, string> }).codeToEngineName;
  const nameToCode = new Map<string, string>();
  for (const t of fixtures.teams as { code: string; name: string }[]) {
    nameToCode.set(t.name, t.code);
    nameToCode.set(codeToName[t.code] ?? t.name, t.code);
  }

  // Fixture index: unordered pair + date -> { fifaMatchNo, home, away } (group
  // matches are seeded 1..72 in array order, so fifaMatchNo = index + 1).
  const groupMatches = fixtures.groupMatches as GroupMatch[];
  const fixtureByKey = new Map<string, { no: number; home: string; away: string }>();
  groupMatches.forEach((m, i) => {
    fixtureByKey.set(`${m.date}|${[m.home, m.away].sort().join("|")}`, { no: i + 1, home: m.home, away: m.away });
  });

  const rows = parseCsv(text).filter(
    (r) => r.tournament === "FIFA World Cup" && r.date >= SEASON_START && r.home_score !== "" && r.home_score !== "NA",
  );

  const results: ResultRow[] = [];
  const unmatched: string[] = [];
  for (const r of rows) {
    const hc = nameToCode.get(r.home_team);
    const ac = nameToCode.get(r.away_team);
    if (!hc || !ac) {
      unmatched.push(`${r.date} ${r.home_team} v ${r.away_team}`);
      continue;
    }
    const fx = fixtureByKey.get(`${r.date}|${[hc, ac].sort().join("|")}`);
    if (!fx) {
      unmatched.push(`${r.date} ${hc} v ${ac} (no fixture)`);
      continue;
    }
    // Orient scores to the fixture's home/away.
    const homeScore = Number(hc === fx.home ? r.home_score : r.away_score);
    const awayScore = Number(hc === fx.home ? r.away_score : r.home_score);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
      unmatched.push(`${r.date} ${hc} v ${ac} (bad score)`);
      continue;
    }
    results.push({ fifaMatchNo: fx.no, date: r.date, home: fx.home, away: fx.away, homeScore, awayScore });
  }

  results.sort((a, b) => a.fifaMatchNo - b.fifaMatchNo);
  return { results, unmatched };
}

// Default upstream source: martj42's international results feed (master branch).
// Override with RESULTS_CSV_URL.
export const DEFAULT_RESULTS_CSV_URL =
  "https://raw.githubusercontent.com/martj42/international_results/master/results.csv";
