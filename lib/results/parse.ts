// Shared parser/mapper for the martj42 international-results CSV (the feed behind
// the Can-Tre-Beat-Vegas dataset). Given the raw CSV text, returns the played
// World Cup 2026 group-stage results aligned to our fixtures (fifaMatchNo),
// oriented to each fixture's home/away — plus the knockout rows (73-104), which
// carry the actual teams (unknown at seed time) as well as the scores. Pure —
// no filesystem or network — so it is shared by both scripts/sync-results.ts
// (file in, file out) and the nightly predictions cron (live fetch in, DB out).

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

// A knockout fixture as reported by the feed. The feed lists a knockout match
// as soon as its teams are decided, with "NA" scores until it is played — so a
// row with null scores is a real upcoming pairing (e.g. a quarter-final whose
// teams came from last night's round-of-16 games). `winner` is the side that
// advances: the score winner, or the shootout winner when the game was drawn
// (resolved from shootouts.csv); null while unplayed or unresolvable.
export interface KnockoutRow {
  fifaMatchNo: number;
  stage: string;
  date: string;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  winner: string | null;
}

interface GroupMatch {
  date: string;
  group: string;
  home: string;
  away: string;
}
interface KnockoutFixture {
  matchNo: number;
  stage: string;
  date: string;
  venue: string;
}

const SEASON_START = "2026-06-01";

// Feed city -> our venue key. The feed is loose about host cities (the same
// stadium shows up as "Dallas" or "Arlington", "Miami" or "Miami Gardens"), so
// each venue lists every name observed or plausible. Lower-cased keys.
const CITY_TO_VENUE: Record<string, string> = {
  "inglewood": "sofi",
  "los angeles": "sofi",
  "foxborough": "gillette",
  "boston": "gillette",
  "guadalupe": "bbva",
  "monterrey": "bbva",
  "houston": "nrg",
  "east rutherford": "metlife",
  "new york": "metlife",
  "new york city": "metlife",
  "new jersey": "metlife",
  "arlington": "att",
  "dallas": "att",
  "mexico city": "azteca",
  "atlanta": "mercedes",
  "santa clara": "levis",
  "san francisco": "levis",
  "san francisco bay area": "levis",
  "seattle": "lumen",
  "toronto": "bmo",
  "vancouver": "bcplace",
  "miami gardens": "hardrock",
  "miami": "hardrock",
  "kansas city": "arrowhead",
  "philadelphia": "linc",
  "zapopan": "akron",
  "guadalajara": "akron",
};

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

// engineName -> code from the explicit map plus fixture names.
function buildNameToCode(): Map<string, string> {
  const codeToName = (nameMap as { codeToEngineName: Record<string, string> }).codeToEngineName;
  const nameToCode = new Map<string, string>();
  for (const t of fixtures.teams as { code: string; name: string }[]) {
    nameToCode.set(t.name, t.code);
    nameToCode.set(codeToName[t.code] ?? t.name, t.code);
  }
  return nameToCode;
}

// Parse the raw results CSV into our oriented, fixture-aligned result rows.
// `unmatched` collects rows that could not be mapped (logged by callers).
export function parseWorldCupResultsCsv(text: string): { results: ResultRow[]; unmatched: string[] } {
  const nameToCode = buildNameToCode();

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
    if (!fx) continue; // not a group fixture — knockout rows are handled by parseWorldCupKnockoutsCsv
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

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

// Map the feed's World Cup knockout rows onto fixtures 73-104. Knockout
// fixtures were seeded with no teams (they're decided on the pitch), so rows
// are matched by venue + date instead: the feed's city resolves to a stadium,
// and the closest knockout fixture at that stadium within a day is the match.
// (The one-day tolerance absorbs the feed's occasional off-by-one dating; venue
// disambiguates the multiple knockout games played on the same day.) Rows with
// "NA" scores are kept — that's how the feed announces an upcoming pairing —
// and drawn games get their winner from the shootouts CSV when provided.
export function parseWorldCupKnockoutsCsv(
  text: string,
  shootoutsText?: string,
): { knockouts: KnockoutRow[]; unmatched: string[] } {
  const nameToCode = buildNameToCode();
  const knockoutFixtures = fixtures.knockoutMatches as KnockoutFixture[];
  const koStart = knockoutFixtures.reduce((min, m) => (m.date < min ? m.date : min), "9999-12-31");
  const fixturesByVenue = new Map<string, KnockoutFixture[]>();
  for (const f of knockoutFixtures) {
    if (!fixturesByVenue.has(f.venue)) fixturesByVenue.set(f.venue, []);
    fixturesByVenue.get(f.venue)!.push(f);
  }

  // Group fixtures by date + unordered pair, so a group game near the knockout
  // window can never be mistaken for a knockout match.
  const groupKeys = new Set(
    (fixtures.groupMatches as GroupMatch[]).map((m) => `${m.date}|${[m.home, m.away].sort().join("|")}`),
  );

  // Shootout winners keyed by date + unordered pair of team codes.
  const shootoutWinner = new Map<string, string>();
  if (shootoutsText) {
    for (const r of parseCsv(shootoutsText)) {
      const hc = nameToCode.get(r.home_team);
      const ac = nameToCode.get(r.away_team);
      const wc = nameToCode.get(r.winner);
      if (hc && ac && wc) shootoutWinner.set(`${r.date}|${[hc, ac].sort().join("|")}`, wc);
    }
  }

  // Knockout window: feed rows from the day before the first knockout fixture
  // on (one day of slack for the feed's occasional off-by-one dating).
  const rows = parseCsv(text).filter(
    (r) => r.tournament === "FIFA World Cup" && (r.date >= koStart || dayDiff(r.date, koStart) <= 1),
  );

  const byMatchNo = new Map<number, KnockoutRow>();
  const unmatched: string[] = [];
  for (const r of rows) {
    const hc = nameToCode.get(r.home_team);
    const ac = nameToCode.get(r.away_team);
    if (!hc || !ac) {
      unmatched.push(`${r.date} ${r.home_team} v ${r.away_team} (unknown team)`);
      continue;
    }
    if (groupKeys.has(`${r.date}|${[hc, ac].sort().join("|")}`)) continue; // a group game, not a knockout

    // Resolve the fixture: same stadium, nearest date within a day.
    const venue = CITY_TO_VENUE[(r.city ?? "").trim().toLowerCase()];
    let candidates = venue ? (fixturesByVenue.get(venue) ?? []) : knockoutFixtures.filter((f) => f.date === r.date);
    candidates = candidates.filter((f) => dayDiff(f.date, r.date) <= 1);
    candidates.sort((a, b) => dayDiff(a.date, r.date) - dayDiff(b.date, r.date));
    const fx = candidates[0];
    const tie = fx && candidates[1] && dayDiff(candidates[1].date, r.date) === dayDiff(fx.date, r.date);
    if (!fx || tie) {
      unmatched.push(`${r.date} ${hc} v ${ac} @ ${r.city} (${tie ? "ambiguous" : "no"} knockout fixture)`);
      continue;
    }

    const played = r.home_score !== "" && r.home_score !== "NA";
    const homeScore = played ? Number(r.home_score) : null;
    const awayScore = played ? Number(r.away_score) : null;
    if (played && (!Number.isFinite(homeScore) || !Number.isFinite(awayScore))) {
      unmatched.push(`${r.date} ${hc} v ${ac} (bad score)`);
      continue;
    }
    let winner: string | null = null;
    if (played) {
      if (homeScore! > awayScore!) winner = hc;
      else if (homeScore! < awayScore!) winner = ac;
      else winner = shootoutWinner.get(`${r.date}|${[hc, ac].sort().join("|")}`) ?? null;
    }

    const row: KnockoutRow = {
      fifaMatchNo: fx.matchNo,
      stage: fx.stage,
      date: fx.date,
      home: hc,
      away: ac,
      homeScore,
      awayScore,
      winner,
    };
    // Prefer a played row over a scheduled one if the feed carries both.
    const prev = byMatchNo.get(fx.matchNo);
    if (!prev || (played && prev.homeScore == null)) byMatchNo.set(fx.matchNo, row);
  }

  const knockouts = [...byMatchNo.values()].sort((a, b) => a.fifaMatchNo - b.fifaMatchNo);
  return { knockouts, unmatched };
}

// Default upstream sources: martj42's international results feed (master
// branch). Override with RESULTS_CSV_URL / SHOOTOUTS_CSV_URL.
export const DEFAULT_RESULTS_CSV_URL =
  "https://raw.githubusercontent.com/martj42/international_results/master/results.csv";
export const DEFAULT_SHOOTOUTS_CSV_URL =
  "https://raw.githubusercontent.com/martj42/international_results/master/shootouts.csv";
