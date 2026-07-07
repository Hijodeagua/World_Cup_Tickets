import { PrismaClient } from "@prisma/client";
import fixtures from "../data/fixtures-2026.json";

const prisma = new PrismaClient();

interface FixtureVenue {
  key: string;
  city: string;
  country: string;
  stadium: string;
  capacity: number;
}
interface FixtureTeam {
  code: string;
  name: string;
  group: string;
  flag: string;
}
interface FixtureGroupMatch {
  date: string;
  group: string;
  home: string;
  away: string;
  venue: string;
  timeET: string; // "HH:MM" Eastern Time (per source legend)
}
interface FixtureKnockoutMatch {
  matchNo: number;
  stage: string;
  date: string;
  venue: string;
  timeET: string;
}

const GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const;
const ET_UTC_OFFSET = "-04:00"; // EDT in June/July 2026

function validateFixtures(venues: FixtureVenue[], teams: FixtureTeam[], matches: FixtureGroupMatch[]) {
  const errors: string[] = [];

  const venueKeys = new Set(venues.map((v) => v.key));
  if (venueKeys.size !== venues.length) errors.push("duplicate venue keys");
  if (venues.length !== 16) errors.push(`expected 16 venues, got ${venues.length}`);

  const teamsByGroup = new Map<string, FixtureTeam[]>();
  for (const t of teams) {
    if (!teamsByGroup.has(t.group)) teamsByGroup.set(t.group, []);
    teamsByGroup.get(t.group)!.push(t);
  }
  for (const g of GROUPS) {
    const n = teamsByGroup.get(g)?.length ?? 0;
    if (n !== 4) errors.push(`group ${g} has ${n} teams, expected 4`);
  }
  const extraGroups = [...teamsByGroup.keys()].filter((g) => !GROUPS.includes(g as (typeof GROUPS)[number]));
  if (extraGroups.length) errors.push(`unexpected groups: ${extraGroups.join(", ")}`);

  const codes = new Set(teams.map((t) => t.code));
  if (codes.size !== teams.length) errors.push("duplicate team codes");
  const groupByCode = new Map(teams.map((t) => [t.code, t.group]));

  if (matches.length !== 72) errors.push(`expected 72 group matches, got ${matches.length}`);

  const appearances = new Map<string, number>();
  const matchesPerGroup = new Map<string, number>();
  const venueDateSlot = new Set<string>();

  for (const m of matches) {
    if (!venueKeys.has(m.venue)) errors.push(`match ${m.home}-${m.away}: unknown venue "${m.venue}"`);
    if (!/^\d{1,2}:\d{2}$/.test(m.timeET ?? "")) errors.push(`match ${m.home}-${m.away}: invalid timeET "${m.timeET}"`);
    for (const code of [m.home, m.away]) {
      if (!codes.has(code)) errors.push(`match references unknown team "${code}"`);
      else if (groupByCode.get(code) !== m.group) errors.push(`team ${code} listed in group ${m.group} but belongs to ${groupByCode.get(code)}`);
      appearances.set(code, (appearances.get(code) ?? 0) + 1);
    }
    matchesPerGroup.set(m.group, (matchesPerGroup.get(m.group) ?? 0) + 1);

    // No stadium hosts two matches on the same day.
    const vd = `${m.venue}|${m.date}`;
    if (venueDateSlot.has(vd)) errors.push(`venue ${m.venue} double-booked on ${m.date}`);
    venueDateSlot.add(vd);
  }

  for (const g of GROUPS) {
    if ((matchesPerGroup.get(g) ?? 0) !== 6) errors.push(`group ${g} has ${matchesPerGroup.get(g) ?? 0} matches, expected 6`);
  }
  for (const t of teams) {
    if ((appearances.get(t.code) ?? 0) !== 3) errors.push(`team ${t.code} plays ${appearances.get(t.code) ?? 0} group matches, expected 3`);
  }

  if (errors.length) {
    throw new Error(`Fixture validation failed:\n - ${errors.join("\n - ")}`);
  }
}

async function main() {
  const venues = fixtures.venues as FixtureVenue[];
  const teams = fixtures.teams as FixtureTeam[];
  const groupMatches = fixtures.groupMatches as FixtureGroupMatch[];
  const knockoutMatches = fixtures.knockoutMatches as FixtureKnockoutMatch[];

  validateFixtures(venues, teams, groupMatches);

  // Venues.
  const venueIdByKey = new Map<string, string>();
  for (const v of venues) {
    const row = await prisma.venue.upsert({
      where: { stadium: v.stadium },
      create: { stadium: v.stadium, city: v.city, country: v.country, capacity: v.capacity },
      update: { city: v.city, country: v.country, capacity: v.capacity },
    });
    venueIdByKey.set(v.key, row.id);
  }

  // Teams (group-stage draw is final, so all confirmed).
  const teamIdByCode = new Map<string, string>();
  for (const t of teams) {
    const row = await prisma.team.upsert({
      where: { code: t.code },
      create: { code: t.code, name: t.name, group: t.group, flag: t.flag, confirmed: true },
      update: { name: t.name, group: t.group, flag: t.flag, confirmed: true },
    });
    teamIdByCode.set(t.code, row.id);
  }

  const seen = new Set<string>(); // venueId|kickoff collision guard

  let matchNo = 0;
  const upsertMatch = async (data: {
    kickoff: Date;
    venueId: string;
    stage: string;
    group: string | null;
    confirmed: boolean;
    homeCode?: string;
    awayCode?: string;
    homeLabel?: string;
    awayLabel?: string;
  }) => {
    matchNo++;
    const collisionKey = `${data.venueId}|${data.kickoff.toISOString()}`;
    if (seen.has(collisionKey)) throw new Error(`venue double-booked at ${collisionKey} (match ${matchNo})`);
    seen.add(collisionKey);

    const fields = {
      kickoff: data.kickoff,
      stage: data.stage,
      group: data.group,
      confirmed: data.confirmed,
      venueId: data.venueId,
      homeTeamId: data.homeCode ? teamIdByCode.get(data.homeCode) : null,
      awayTeamId: data.awayCode ? teamIdByCode.get(data.awayCode) : null,
      homeLabel: data.homeLabel ?? null,
      awayLabel: data.awayLabel ?? null,
    };
    await prisma.match.upsert({
      where: { fifaMatchNo: matchNo },
      create: { fifaMatchNo: matchNo, ...fields },
      update: fields,
    });
  };

  // 72 real group-stage matches. Times are Eastern Time per the source; build
  // the instant directly from the ET wall-time so it's stored as correct UTC.
  for (const m of groupMatches) {
    const kickoff = new Date(`${m.date}T${m.timeET}:00${ET_UTC_OFFSET}`);
    if (Number.isNaN(kickoff.getTime())) throw new Error(`invalid kickoff for ${m.home}-${m.away}: ${m.date} ${m.timeET}`);
    await upsertMatch({
      kickoff,
      venueId: venueIdByKey.get(m.venue)!,
      stage: "GROUP",
      group: m.group,
      confirmed: true,
      homeCode: m.home,
      awayCode: m.away,
    });
  }

  // 32 real knockout matches: real venue/date/time from the official schedule,
  // teams TBD at upsert time (decided by group results). The committed knockout
  // rows in data/results-2026.json fill teams/scores just below, and the
  // nightly cron keeps the bracket advancing via lib/bracket.ts.
  for (const m of knockoutMatches) {
    const kickoff = new Date(`${m.date}T${m.timeET}:00${ET_UTC_OFFSET}`);
    if (Number.isNaN(kickoff.getTime())) throw new Error(`invalid knockout kickoff: match ${m.matchNo}`);
    await upsertMatch({
      kickoff,
      venueId: venueIdByKey.get(m.venue)!,
      stage: m.stage,
      group: null,
      confirmed: false,
    });
  }

  const counts = {
    venues: await prisma.venue.count(),
    teams: await prisma.team.count(),
    matches: await prisma.match.count(),
  };
  console.log("Seeded:", counts);

  // Apply any committed completed results so standings reflect them immediately
  // (empty until matches are played; the nightly job keeps it current).
  const results = (await import("../data/results-2026.json")).default as {
    results: { fifaMatchNo: number; homeScore: number; awayScore: number }[];
    knockouts?: import("../lib/results/parse").KnockoutRow[];
  };
  let applied = 0;
  for (const r of results.results) {
    const match = await prisma.match.findUnique({ where: { fifaMatchNo: r.fifaMatchNo } });
    if (!match) continue;
    await prisma.match.update({
      where: { fifaMatchNo: r.fifaMatchNo },
      data: { status: "COMPLETED", homeScore: r.homeScore, awayScore: r.awayScore },
    });
    applied++;
  }
  console.log("Applied", applied, "completed result(s)");

  // Fill the knockout bracket from the committed knockout rows (actual teams,
  // scores, shootout winners) and the lineage — same path as the nightly cron.
  const { applyKnockoutsToDb } = await import("../lib/bracket");
  const bracket = await applyKnockoutsToDb(prisma, results.knockouts ?? []);
  console.log("Knockout bracket:", bracket);

  // Compute Elo Monte Carlo projections (conditioned on any applied results).
  const { computeAndStoreProjections } = await import("../lib/predictions/store");
  const n = await computeAndStoreProjections(prisma);
  console.log("Projections computed for", n, "teams");

  // Seed per-match predictions (freezes any already inside the kickoff window).
  const { refreshMatchPredictions } = await import("../lib/predictions/matchPredictions");
  const mp = await refreshMatchPredictions(prisma);
  console.log("Match predictions:", mp);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
