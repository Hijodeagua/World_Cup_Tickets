import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export interface MatchFilters {
  team?: string; // team code
  city?: string;
  stage?: string;
  availableOnly?: boolean;
}

const matchInclude = {
  venue: true,
  homeTeam: true,
  awayTeam: true,
  currentState: true,
} satisfies Prisma.MatchInclude;

export type MatchWithRelations = Prisma.MatchGetPayload<{ include: typeof matchInclude }>;

export async function getMatches(filters: MatchFilters): Promise<MatchWithRelations[]> {
  const where: Prisma.MatchWhereInput = {};

  if (filters.team) {
    where.OR = [{ homeTeam: { code: filters.team } }, { awayTeam: { code: filters.team } }];
  }
  if (filters.city) where.venue = { city: filters.city };
  if (filters.stage) where.stage = filters.stage;
  if (filters.availableOnly) {
    where.currentState = { availability: { in: ["AVAILABLE", "LIMITED"] } };
  }

  return prisma.match.findMany({
    where,
    include: matchInclude,
    orderBy: { kickoff: "asc" },
  });
}

export async function getMatch(id: string): Promise<MatchWithRelations | null> {
  return prisma.match.findUnique({ where: { id }, include: matchInclude });
}

export async function getFilterOptions() {
  const [cities, teams] = await Promise.all([
    prisma.venue.findMany({ select: { city: true }, orderBy: { city: "asc" } }),
    prisma.team.findMany({ select: { code: true, name: true, flag: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    cities: cities.map((c) => c.city),
    teams,
    stages: ["GROUP", "R32", "R16", "QF", "SF", "THIRD", "FINAL"],
  };
}
