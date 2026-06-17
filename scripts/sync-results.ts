// Sync completed World Cup 2026 results from the Can-Tre-Beat-Vegas dataset.
//
// That repo's soccer/data/results.csv carries the full international results
// feed (martj42), including the 2026 World Cup fixtures — scores fill in as
// matches are played. This reads the played WC-2026 rows, maps team names to
// our codes, aligns each to its fixture (fifaMatchNo) and writes
// data/results-2026.json. The cron predictions endpoint then applies these
// scores to Match rows and re-runs the projections conditioned on them.
//
// Usage:
//   npm run sync-results
//   RESULTS_CSV_PATH=/path/to/results.csv npm run sync-results

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import fixtures from "../data/fixtures-2026.json";
import nameMap from "../data/team-name-map.json";

const DEFAULT_SOURCE = "../Can-Tre-Beat-Vegas/soccer/data/results.csv";
const OUT_FILE = resolve(__dirname, "../data/results-2026.json");
const SEASON_START = "2026-06-01";

interface GroupMatch {
  date: string;
  group: string;
  home: string;
  away: string;
}
interface ResultRow {
  fifaMatchNo: number;
  date: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
}

// Minimal CSV parser: the results feed has no quoted/embedded commas.
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

function main() {
  const csvPath = resolve(process.cwd(), process.env.RESULTS_CSV_PATH ?? DEFAULT_SOURCE);
  let text: string;
  try {
    text = readFileSync(csvPath, "utf8");
  } catch {
    throw new Error(`Could not read results CSV at ${csvPath}. Set RESULTS_CSV_PATH or check out Can-Tre-Beat-Vegas alongside this repo.`);
  }

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
    results.push({ fifaMatchNo: fx.no, date: r.date, home: fx.home, away: fx.away, homeScore, awayScore });
  }

  results.sort((a, b) => a.fifaMatchNo - b.fifaMatchNo);
  const payload = {
    note: (JSON.parse(readFileSync(OUT_FILE, "utf8")) as { note: string }).note,
    updatedAt: new Date().toISOString(),
    results,
  };
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
  console.log(`sync-results: wrote ${results.length} completed group-stage result(s) to ${OUT_FILE}`);
  if (unmatched.length) console.warn(`sync-results: ${unmatched.length} unmatched row(s): ${unmatched.slice(0, 5).join("; ")}${unmatched.length > 5 ? " …" : ""}`);
}

main();
