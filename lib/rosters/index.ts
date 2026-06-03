import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { getManualRoster } from "./manual";
import { fetchWikipediaRoster } from "./wikipedia";
import { normalizePosition, sortSquad, type Player } from "./types";

export type { Player, Position } from "./types";
export { ROSTERS_AS_OF } from "./manual";

const key = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");

// A team's roster = auto-pulled rows (DB) with the manual JSON layer merged on
// top: manual non-null fields override the auto values, and manual-only players
// are added. Returns null when neither layer has anything for the team.
export async function getRoster(code: string | null | undefined): Promise<Player[] | null> {
  if (!code) return null;

  const rows = await prisma.player.findMany({ where: { teamCode: code } });
  const byKey = new Map<string, Player>();
  for (const r of rows) {
    byKey.set(key(r.name), {
      name: r.name,
      position: normalizePosition(r.position),
      club: r.club,
      league: r.league,
      caps: r.caps,
      goals: r.goals,
      assists: r.assists,
      firstCapYear: r.firstCapYear,
      source: r.source,
    });
  }

  for (const p of getManualRoster(code) ?? []) {
    const existing = byKey.get(key(p.name));
    if (!existing) {
      byKey.set(key(p.name), p);
      continue;
    }
    byKey.set(key(p.name), {
      ...existing,
      position: p.position,
      club: p.club ?? existing.club,
      league: p.league ?? existing.league,
      caps: p.caps ?? existing.caps,
      goals: p.goals ?? existing.goals,
      assists: p.assists ?? existing.assists,
      firstCapYear: p.firstCapYear ?? existing.firstCapYear,
      source: existing.source ? `${existing.source}+manual` : "manual",
    });
  }

  const merged = [...byKey.values()];
  return merged.length ? sortSquad(merged) : null;
}

export interface RosterRefreshSummary {
  code: string;
  ok: boolean;
  count: number;
  reason?: string;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetch each team's squad from Wikipedia and replace that team's auto rows.
// Manual overrides live in JSON, not the DB, so they're untouched. Polite delay
// between requests to respect Wikipedia's API policy.
export async function refreshRosters(
  db: PrismaClient,
  teams: { code: string; name: string }[],
  opts: { delayMs?: number } = {},
): Promise<RosterRefreshSummary[]> {
  const delayMs = opts.delayMs ?? 1500;
  const summaries: RosterRefreshSummary[] = [];

  for (const team of teams) {
    const result = await fetchWikipediaRoster(team.code, team.name);
    if (!result.ok) {
      summaries.push({ code: team.code, ok: false, count: 0, reason: result.reason });
      await delay(delayMs);
      continue;
    }
    await db.$transaction([
      db.player.deleteMany({ where: { teamCode: team.code, source: "wikipedia" } }),
      db.player.createMany({
        data: result.players.map((p) => ({
          teamCode: team.code,
          name: p.name,
          position: p.position,
          club: p.club,
          caps: p.caps,
          goals: p.goals,
          source: "wikipedia",
        })),
      }),
    ]);
    summaries.push({ code: team.code, ok: true, count: result.players.length });
    await delay(delayMs);
  }
  return summaries;
}
