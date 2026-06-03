// Manually pull squads from Wikipedia into the Player table.
//   npm run rosters            # all teams in the DB
//   npm run rosters MEX RSA    # only the given team codes
import { PrismaClient } from "@prisma/client";
import { refreshRosters } from "../lib/rosters";

const prisma = new PrismaClient();

async function main() {
  const filter = process.argv.slice(2).map((s) => s.toUpperCase());
  const all = await prisma.team.findMany({ select: { code: true, name: true }, orderBy: { name: "asc" } });
  const teams = filter.length ? all.filter((t) => filter.includes(t.code)) : all;
  if (teams.length === 0) {
    console.error("No matching teams found.");
    process.exit(1);
  }

  console.log(`Fetching rosters for ${teams.length} team(s) from Wikipedia...`);
  const summaries = await refreshRosters(prisma, teams);
  for (const s of summaries) {
    console.log(s.ok ? `  ✓ ${s.code}: ${s.count} players` : `  ✗ ${s.code}: ${s.reason}`);
  }
  const ok = summaries.filter((s) => s.ok).length;
  console.log(`Done: ${ok}/${teams.length} teams, ${summaries.reduce((n, s) => n + s.count, 0)} players.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
