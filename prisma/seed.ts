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
  confirmed: boolean;
}

const MATCH_SPACING_HOURS = 3; // unique-per-venue spacing => no double-booking
const GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const;

// Round-robin pairings for a 4-team group (indices into the group's team list).
const ROUND_ROBIN: [number, number][] = [
  [0, 1],
  [2, 3],
  [0, 2],
  [1, 3],
  [0, 3],
  [1, 2],
];

function validateFixtures(venues: FixtureVenue[], teams: FixtureTeam[]) {
  const errors: string[] = [];

  const venueKeys = new Set(venues.map((v) => v.key));
  if (venueKeys.size !== venues.length) errors.push("duplicate venue keys");
  if (venues.length !== 16) errors.push(`expected 16 venues, got ${venues.length}`);

  const byGroup = new Map<string, FixtureTeam[]>();
  for (const t of teams) {
    if (!byGroup.has(t.group)) byGroup.set(t.group, []);
    byGroup.get(t.group)!.push(t);
  }
  for (const g of GROUPS) {
    const n = byGroup.get(g)?.length ?? 0;
    if (n !== 4) errors.push(`group ${g} has ${n} teams, expected 4`);
  }
  const extra = [...byGroup.keys()].filter((g) => !GROUPS.includes(g as (typeof GROUPS)[number]));
  if (extra.length) errors.push(`unexpected groups: ${extra.join(", ")}`);

  const codes = new Set(teams.map((t) => t.code));
  if (codes.size !== teams.length) errors.push("duplicate team codes");

  if (errors.length) {
    throw new Error(`Fixture validation failed:\n - ${errors.join("\n - ")}`);
  }
}

async function main() {
  const venues = fixtures.venues as FixtureVenue[];
  const teams = fixtures.teams as FixtureTeam[];

  validateFixtures(venues, teams);

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
  const venueIds = venues.map((v) => venueIdByKey.get(v.key)!);

  // Teams.
  const teamIdByCode = new Map<string, string>();
  for (const t of teams) {
    const row = await prisma.team.upsert({
      where: { code: t.code },
      create: { code: t.code, name: t.name, group: t.group, flag: t.flag, confirmed: t.confirmed },
      update: { name: t.name, group: t.group, flag: t.flag, confirmed: t.confirmed },
    });
    teamIdByCode.set(t.code, row.id);
  }

  const teamsByGroup = new Map<string, FixtureTeam[]>();
  for (const g of GROUPS) teamsByGroup.set(g, teams.filter((t) => t.group === g));

  const start = new Date(`${fixtures.groupStageStart}T16:00:00.000Z`);
  const seen = new Set<string>(); // venueId|kickoff collision guard

  let matchNo = 0;
  const upsertMatch = async (data: {
    stage: string;
    group: string | null;
    confirmed: boolean;
    homeCode?: string;
    awayCode?: string;
    homeLabel?: string;
    awayLabel?: string;
  }) => {
    matchNo++;
    const venueId = venueIds[(matchNo - 1) % venueIds.length];
    const kickoff = new Date(start.getTime() + (matchNo - 1) * MATCH_SPACING_HOURS * 3600_000);

    const collisionKey = `${venueId}|${kickoff.toISOString()}`;
    if (seen.has(collisionKey)) {
      throw new Error(`venue double-booked at ${collisionKey} (match ${matchNo})`);
    }
    seen.add(collisionKey);

    await prisma.match.upsert({
      where: { fifaMatchNo: matchNo },
      create: {
        fifaMatchNo: matchNo,
        kickoff,
        stage: data.stage,
        group: data.group,
        confirmed: data.confirmed,
        venueId,
        homeTeamId: data.homeCode ? teamIdByCode.get(data.homeCode) : null,
        awayTeamId: data.awayCode ? teamIdByCode.get(data.awayCode) : null,
        homeLabel: data.homeLabel ?? null,
        awayLabel: data.awayLabel ?? null,
      },
      update: {
        kickoff,
        stage: data.stage,
        group: data.group,
        confirmed: data.confirmed,
        venueId,
        homeTeamId: data.homeCode ? teamIdByCode.get(data.homeCode) : null,
        awayTeamId: data.awayCode ? teamIdByCode.get(data.awayCode) : null,
        homeLabel: data.homeLabel ?? null,
        awayLabel: data.awayLabel ?? null,
      },
    });
  };

  // 72 group-stage matches.
  for (const g of GROUPS) {
    const gt = teamsByGroup.get(g)!;
    for (const [a, b] of ROUND_ROBIN) {
      await upsertMatch({
        stage: "GROUP",
        group: g,
        confirmed: gt[a].confirmed && gt[b].confirmed,
        homeCode: gt[a].code,
        awayCode: gt[b].code,
      });
    }
  }

  // 32 provisional knockout matches (teams TBD -> labels).
  const knockout: { stage: string; count: number }[] = [
    { stage: "R32", count: 16 },
    { stage: "R16", count: 8 },
    { stage: "QF", count: 4 },
    { stage: "SF", count: 2 },
    { stage: "THIRD", count: 1 },
    { stage: "FINAL", count: 1 },
  ];
  for (const k of knockout) {
    for (let i = 1; i <= k.count; i++) {
      await upsertMatch({
        stage: k.stage,
        group: null,
        confirmed: false,
        homeLabel: `${k.stage} ${i} — TBD`,
        awayLabel: `${k.stage} ${i} — TBD`,
      });
    }
  }

  // Demo manual overrides so availability is visible out of the box.
  const overrides = [
    { fifaMatchNo: 1, availability: "AVAILABLE", minPrice: 145, currency: "USD", note: "Category 3 available" },
    { fifaMatchNo: 2, availability: "LIMITED", minPrice: 320, currency: "USD", note: "Few seats left" },
    { fifaMatchNo: 3, availability: "SOLD_OUT", currency: "USD", note: "Sold out on official portal" },
    { fifaMatchNo: 19, availability: "AVAILABLE", minPrice: 210, currency: "USD" },
    { fifaMatchNo: 37, availability: "LIMITED", minPrice: 480, currency: "USD" },
  ];
  for (const o of overrides) {
    const match = await prisma.match.findUnique({ where: { fifaMatchNo: o.fifaMatchNo } });
    if (!match) continue;
    await prisma.manualOverride.upsert({
      where: { matchId: match.id },
      create: { matchId: match.id, availability: o.availability, minPrice: o.minPrice ?? null, currency: o.currency ?? null, note: o.note ?? null, setBy: "seed" },
      update: { availability: o.availability, minPrice: o.minPrice ?? null, currency: o.currency ?? null, note: o.note ?? null, setBy: "seed" },
    });
  }

  const counts = {
    venues: await prisma.venue.count(),
    teams: await prisma.team.count(),
    matches: await prisma.match.count(),
    overrides: await prisma.manualOverride.count(),
  };
  console.log("Seeded:", counts);

  // Populate the observation stream + derived state from the seeded data.
  const { runRefresh } = await import("../lib/tickets/index");
  const result = await runRefresh();
  console.log("Initial refresh:", result);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
