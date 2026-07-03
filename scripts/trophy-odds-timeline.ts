// Precompute the "Trophy odds over time" series shown on the Projections page.
//
// Replays the tournament in chronological order from a FROZEN pre-tournament
// rating baseline (data/elo-baseline-2026.json) and, after each match-day,
// re-runs the Elo Monte Carlo to capture every team's championship probability
// at that point. Replaying from the frozen baseline — rather than the nightly
// retrained data/elo-ratings.json — means regenerating never rewrites history:
// earlier points depend only on earlier results.
//
// Group results condition the group-stage simulation directly. Knockout
// results can't be conditioned into the simulated bracket (it is Elo-seeded,
// not FIFA's real slot table), so they enter three ways: the online rating
// drift, hard elimination (a knocked-out team's odds are zeroed and the
// remaining probability mass is renormalized over the survivors), and each
// series' `eliminatedAt` marker, which the chart renders as a crossed-out team.
//
// Deterministic (fixed RNG seed), so committing the JSON is reproducible. Run
// with `npm run timeline` after results-2026.json changes; the nightly
// refresh workflow regenerates it alongside the synced results.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import baseline from "../data/elo-baseline-2026.json";
import fixtures from "../data/fixtures-2026.json";
import kitColors from "../data/kit-colors.json";
import { HOME_ADVANTAGE, HOST_CODES, blendElo, expectedScore } from "../lib/predictions/elo";
import { runSimulations, type GroupFixture, type PlayedMatch, type TeamInput } from "../lib/predictions/simulate";
import results from "../data/results-2026.json";

// Fewer iterations than the headline projections (100k): a chart only needs the
// odds to a few tenths of a percent, and we run one simulation per match-day.
const ITERATIONS = 40000;
// Online-Elo update strength applied to the live rating after each result, so
// the chart shows odds *moving* with form (the headline projections keep the
// frozen pre-tournament ratings). World Football Elo uses K≈40 for the finals.
const K_FACTOR = 40;
// The chart shows the leading contenders: teams ranked by the highest
// championship odds they reached at any point, capped at MAX_SERIES lines so
// the chart stays readable, with a floor so pure also-rans never chart. This
// Elo bracket concentrates probability on the top seeds (a fixed "reached 5%"
// rule would show only five lines), so a top-N rule keeps the notable
// eliminated runs — Germany, the Netherlands — visible and strikeable.
const MAX_SERIES = 8;
const MIN_PEAK = 0.005;
const FALLBACK_COLOR = "#8a8f98";

type GroupResult = { fifaMatchNo: number; date: string; home: string; away: string; homeScore: number; awayScore: number };
type KnockoutResult = { date: string; home: string; away: string; homeScore: number; awayScore: number; winner: string | null };

// Static per-team components. `online` is updated in place as results come in;
// `model` stays frozen at its pre-tournament value. The blend of the two
// drives each snapshot's simulation.
const online = new Map(baseline.ratings.map((r) => [r.code, r.eloOnline]));
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
const totalGroupMatches = Object.values(groupFixtures).reduce((n, f) => n + f.length, 0);

const playedGroup = ([...(results.results as GroupResult[])]).sort((a, b) =>
  a.date === b.date ? a.fifaMatchNo - b.fifaMatchNo : a.date.localeCompare(b.date),
);
const playedKnockout = ([...((results as { knockoutResults?: KnockoutResult[] }).knockoutResults ?? [])]).sort((a, b) =>
  a.date.localeCompare(b.date),
);
const dates = [...new Set([...playedGroup, ...playedKnockout].map((r) => r.date))].sort();

// When each knocked-out team's run ended, from the knockout results (a drawn
// match with no shootout winner yet eliminates nobody until the feed catches up).
const knockedOutAt = new Map<string, string>();
for (const k of playedKnockout) {
  if (!k.winner) continue;
  const loser = k.winner === k.home ? k.away : k.home;
  if (!knockedOutAt.has(loser)) knockedOutAt.set(loser, k.date);
}

// Goal-difference multiplier from the World Football Elo formula: a wider
// winning margin moves the rating more.
function goalWeight(diff: number): number {
  const g = Math.abs(diff);
  if (g <= 1) return 1;
  if (g === 2) return 1.5;
  return (11 + g) / 8;
}

// Apply one result to the running online Elo of both teams (zero-sum). In the
// group stage the hosts get the same HOME_ADVANTAGE the simulation grants them,
// so their results are credited against the boosted expectation; knockout
// matches stay neutral-venue to match simulateKnockout. A knockout decided on
// penalties (level score) counts as a draw, per World Football Elo convention.
function updateOnline(home: string, away: string, homeScore: number, awayScore: number, groupStage: boolean): void {
  const ra = online.get(home);
  const rb = online.get(away);
  if (ra == null || rb == null) return;
  const boost = (c: string) => (groupStage && HOST_CODES.has(c) ? HOME_ADVANTAGE : 0);
  const we = expectedScore(ra + boost(home), rb + boost(away)); // home expected score, 0..1
  const w = homeScore > awayScore ? 1 : homeScore < awayScore ? 0 : 0.5;
  const delta = K_FACTOR * goalWeight(homeScore - awayScore) * (w - we);
  online.set(home, ra + delta);
  online.set(away, rb - delta);
}

// Build the team inputs for a simulation from the current blended ratings.
function currentTeams(): TeamInput[] {
  return baseline.ratings.map((r) => ({
    code: r.code,
    group: groupOf.get(r.code) ?? "",
    elo: blendElo(online.get(r.code)!, r.eloModel),
  }));
}

// Snapshot 0 = pre-tournament (no results). Then one snapshot per match-day,
// conditioning on every group result up to and including that date, with the
// online Elo rolled forward through all results (group and knockout).
type Snapshot = { date: string; label: string; champ: Map<string, number>; qualify: Map<string, number> };
const snapshots: Snapshot[] = [];

function snapshot(label: string, date: string, upToGroup: GroupResult[]): Snapshot {
  const playedResults: PlayedMatch[] = upToGroup.map((r) => ({
    home: r.home,
    away: r.away,
    homeScore: r.homeScore,
    awayScore: r.awayScore,
  }));
  const probs = runSimulations(currentTeams(), groupFixtures, ITERATIONS, 1234, playedResults);
  const champ = new Map(probs.map((p) => [p.code, p.pChampion]));
  const qualify = new Map(probs.map((p) => [p.code, p.pQualify]));

  // The simulated bracket doesn't know who actually lost a knockout tie, so
  // zero the knocked-out teams and hand their probability mass to the
  // survivors, pro rata. Group-stage eliminations need no correction: with the
  // whole group conditioned, the simulation already gives them exactly 0.
  let outMass = 0;
  for (const [code, at] of knockedOutAt) {
    if (at > date) continue;
    outMass += champ.get(code) ?? 0;
    champ.set(code, 0);
  }
  if (outMass > 0 && outMass < 1) {
    const scale = 1 / (1 - outMass);
    for (const [code, v] of champ) if (v > 0) champ.set(code, v * scale);
  }
  return { date, label, champ, qualify };
}

console.log(`Computing ${dates.length + 1} snapshots at ${ITERATIONS.toLocaleString()} iterations each…`);
snapshots.push(snapshot("Start", fixtures.groupStageStart as string, []));
const upToGroup: GroupResult[] = [];
for (const d of dates) {
  // Roll the online Elo forward through this date's results before snapshotting.
  for (const r of playedGroup.filter((r) => r.date === d)) {
    updateOnline(r.home, r.away, r.homeScore, r.awayScore, true);
    upToGroup.push(r);
  }
  for (const k of playedKnockout.filter((k) => k.date === d)) {
    updateOnline(k.home, k.away, k.homeScore, k.awayScore, false);
  }
  snapshots.push(snapshot(d, d, upToGroup));
  console.log(`  ${d} — ${upToGroup.length}/${playedGroup.length} group, ${playedKnockout.filter((k) => k.date <= d).length}/${playedKnockout.length} knockout`);
}

// When did each team's tournament end? Knockout losses carry their match date;
// group-stage eliminations become certain once every group match is played, at
// which point the fully-conditioned simulation gives non-qualifiers exactly 0.
const eliminatedAt = new Map(knockedOutAt);
if (playedGroup.length === totalGroupMatches) {
  const groupEndDate = playedGroup[playedGroup.length - 1].date;
  const groupEnd = snapshots.find((s) => s.date >= groupEndDate && s.label !== "Start");
  if (groupEnd) {
    for (const code of baseline.ratings.map((r) => r.code)) {
      if ((groupEnd.qualify.get(code) ?? 0) === 0 && !eliminatedAt.has(code)) eliminatedAt.set(code, groupEndDate);
    }
  }
}

// Keep the leading contenders by peak championship odds, then order them by
// their latest odds so the legend reads top-down (eliminated teams sink last).
const peak = new Map(
  baseline.ratings.map((r) => [r.code, Math.max(...snapshots.map((s) => s.champ.get(r.code) ?? 0))]),
);
const appearing = baseline.ratings
  .map((r) => r.code)
  .filter((c) => (peak.get(c) ?? 0) >= MIN_PEAK)
  .sort((a, b) => (peak.get(b) ?? 0) - (peak.get(a) ?? 0))
  .slice(0, MAX_SERIES);
const last = snapshots[snapshots.length - 1].champ;
appearing.sort((a, b) => (last.get(b) ?? 0) - (last.get(a) ?? 0));

const series = appearing.map((code) => ({
  code,
  name: meta.get(code)?.name ?? code,
  flag: meta.get(code)?.flag ?? "🏳️",
  color: (kitColors.colors as Record<string, string>)[code] ?? FALLBACK_COLOR,
  eliminatedAt: eliminatedAt.get(code) ?? null,
  // championship odds as percentages (0..100), one per point.
  values: snapshots.map((s) => Math.round((s.champ.get(code) ?? 0) * 1000) / 10),
}));

const out = {
  note: "Championship odds after every match-day, with knocked-out teams zeroed and marked. Generated by scripts/trophy-odds-timeline.ts; do not edit by hand.",
  generatedAt: new Date().toISOString(),
  sourceUpdatedAt: results.updatedAt,
  iterations: ITERATIONS,
  maxSeries: MAX_SERIES,
  points: snapshots.map((s) => ({ date: s.date, label: s.label })),
  series,
};

const outPath = join(__dirname, "..", "data", "trophy-odds-timeline.json");
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${series.length} teams × ${snapshots.length} points → ${outPath}`);
console.log(`Eliminated so far: ${[...eliminatedAt.keys()].sort().join(", ") || "none"}`);
