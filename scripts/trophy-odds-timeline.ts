// Precompute the "Trophy odds over time" series shown on the Projections page.
//
// Replays the completed group-stage results in chronological order and, after
// each match-day, re-runs the Elo Monte Carlo to capture every team's
// championship probability at that point in the tournament. The first point is
// the pre-tournament baseline (no results fixed). The output mirrors the concept
// of the reference chart: one line per team, updated after every match played.
//
// Deterministic (fixed RNG seed), so committing the JSON is reproducible. Run
// with `npm run timeline` after results-2026.json changes; the nightly job can
// regenerate it alongside the projections.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import elo from "../data/elo-ratings.json";
import fixtures from "../data/fixtures-2026.json";
import kitColors from "../data/kit-colors.json";
import { blendElo, expectedScore } from "../lib/predictions/elo";
import { runSimulations, type GroupFixture, type PlayedMatch, type TeamInput } from "../lib/predictions/simulate";
import results from "../data/results-2026.json";

// Fewer iterations than the headline projections (100k): a chart only needs the
// odds to a few tenths of a percent, and we run one simulation per match-day.
const ITERATIONS = 40000;
// Online-Elo update strength applied to the live rating after each result, so
// the chart shows odds *moving* with form (the headline projections keep the
// frozen pre-tournament ratings). World Football Elo uses K≈40 for the finals.
const K_FACTOR = 40;
// A team appears in the chart if its championship odds cross this at any point,
// matching the reference chart's "every team that has reached 5%" rule.
const APPEAR_THRESHOLD = 0.05;
const FALLBACK_COLOR = "#8a8f98";

type Result = { fifaMatchNo: number; date: string; home: string; away: string; homeScore: number; awayScore: number };

// Static per-team components. `online` is updated in place as results come in;
// `model` stays frozen. The blend of the two drives each snapshot's simulation.
const online = new Map(elo.ratings.map((r) => [r.code, r.eloOnline]));
const model = new Map(elo.ratings.map((r) => [r.code, r.eloModel]));
const groupOf = new Map(
  (fixtures.teams as { code: string; group: string }[]).map((t) => [t.code, t.group]),
);
const meta = new Map(
  (fixtures.teams as { code: string; name: string; flag: string }[]).map((t) => [t.code, { name: t.name, flag: t.flag }]),
);

const groupFixtures: Record<string, GroupFixture[]> = {};
for (const m of fixtures.groupMatches as { group: string; home: string; away: string }[]) {
  (groupFixtures[m.group] ??= []).push({ home: m.home, away: m.away });
}

const played = ([...(results.results as Result[])]).sort((a, b) =>
  a.date === b.date ? a.fifaMatchNo - b.fifaMatchNo : a.date.localeCompare(b.date),
);
const dates = [...new Set(played.map((r) => r.date))].sort();

// Goal-difference multiplier from the World Football Elo formula: a wider
// winning margin moves the rating more.
function goalWeight(diff: number): number {
  const g = Math.abs(diff);
  if (g <= 1) return 1;
  if (g === 2) return 1.5;
  return (11 + g) / 8;
}

// Apply one result to the running online Elo of both teams (zero-sum).
function updateOnline(r: Result): void {
  const ra = online.get(r.home);
  const rb = online.get(r.away);
  if (ra == null || rb == null) return;
  const we = expectedScore(ra, rb); // home expected score, 0..1
  const w = r.homeScore > r.awayScore ? 1 : r.homeScore < r.awayScore ? 0 : 0.5;
  const delta = K_FACTOR * goalWeight(r.homeScore - r.awayScore) * (w - we);
  online.set(r.home, ra + delta);
  online.set(r.away, rb - delta);
}

// Build the team inputs for a simulation from the current blended ratings.
function currentTeams(): TeamInput[] {
  return elo.ratings.map((r) => ({
    code: r.code,
    group: groupOf.get(r.code) ?? "",
    elo: blendElo(online.get(r.code)!, model.get(r.code)!),
  }));
}

// Snapshot 0 = pre-tournament (no results). Then one snapshot per match-day,
// conditioning on every result up to and including that date, with the online
// Elo updated in place as those results are applied.
type Snapshot = { date: string; label: string; champ: Map<string, number> };
const snapshots: Snapshot[] = [];

function snapshot(label: string, date: string, upTo: Result[]): Snapshot {
  const playedResults: PlayedMatch[] = upTo.map((r) => ({
    home: r.home,
    away: r.away,
    homeScore: r.homeScore,
    awayScore: r.awayScore,
  }));
  const probs = runSimulations(currentTeams(), groupFixtures, ITERATIONS, 1234, playedResults);
  const champ = new Map(probs.map((p) => [p.code, p.pChampion]));
  return { date, label, champ };
}

console.log(`Computing ${dates.length + 1} snapshots at ${ITERATIONS.toLocaleString()} iterations each…`);
snapshots.push(snapshot("Start", fixtures.groupStageStart as string, []));
for (const d of dates) {
  // Roll the online Elo forward through this date's results before snapshotting.
  for (const r of played.filter((r) => r.date === d)) updateOnline(r);
  const upTo = played.filter((r) => r.date <= d);
  snapshots.push(snapshot(d, d, upTo));
  console.log(`  ${d} — ${upTo.length}/${played.length} matches played`);
}

// Keep teams that clear the appearance threshold at any snapshot, ordered by
// their latest (most recent) championship odds so the legend reads top-down.
const codes = elo.ratings.map((r) => r.code);
const appearing = codes.filter((c) => snapshots.some((s) => (s.champ.get(c) ?? 0) >= APPEAR_THRESHOLD));
const last = snapshots[snapshots.length - 1].champ;
appearing.sort((a, b) => (last.get(b) ?? 0) - (last.get(a) ?? 0));

const series = appearing.map((code) => ({
  code,
  name: meta.get(code)?.name ?? code,
  flag: meta.get(code)?.flag ?? "🏳️",
  color: (kitColors.colors as Record<string, string>)[code] ?? FALLBACK_COLOR,
  // championship odds as percentages (0..100), one per point.
  values: snapshots.map((s) => Math.round((s.champ.get(code) ?? 0) * 1000) / 10),
}));

const out = {
  note: "Championship odds after every group match-day. Generated by scripts/trophy-odds-timeline.ts; do not edit by hand.",
  generatedAt: results.updatedAt,
  iterations: ITERATIONS,
  appearThreshold: APPEAR_THRESHOLD,
  points: snapshots.map((s) => ({ date: s.date, label: s.label })),
  series,
};

const outPath = join(__dirname, "..", "data", "trophy-odds-timeline.json");
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${series.length} teams × ${snapshots.length} points → ${outPath}`);
