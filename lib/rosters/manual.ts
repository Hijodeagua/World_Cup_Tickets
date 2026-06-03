// Manual override layer for rosters (data/rosters.json). Hand-entered squads or
// individual fields the auto source can't supply (assists, league, debut year).
// Merged on top of the auto-pulled DB rows at read time.

import rostersData from "../../data/rosters.json";
import { normalizePosition, type Player } from "./types";

interface RawPlayer {
  name: string;
  position?: string;
  club?: string | null;
  league?: string | null;
  caps?: number | null;
  goals?: number | null;
  assists?: number | null;
  firstCapYear?: number | null;
}

const raw = rostersData.rosters as Record<string, RawPlayer[]>;
export const ROSTERS_AS_OF = rostersData.asOf as string;

export function getManualRoster(code: string | null | undefined): Player[] | null {
  if (!code) return null;
  const squad = raw[code];
  if (!squad || squad.length === 0) return null;
  return squad.map((p) => ({
    name: p.name,
    position: normalizePosition(p.position),
    club: p.club ?? null,
    league: p.league ?? null,
    caps: p.caps ?? null,
    goals: p.goals ?? null,
    assists: p.assists ?? null,
    firstCapYear: p.firstCapYear ?? null,
    source: "manual",
  }));
}
