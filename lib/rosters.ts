// Read-side helper for the editable squad snapshot (data/rosters.json).

import rostersData from "../data/rosters.json";

export type Position = "GK" | "DF" | "MF" | "FW";

export interface Player {
  name: string;
  position: Position;
  club: string;
  league: string;
  caps: number;
  goals: number;
  assists: number;
  firstCapYear: number;
}

const rosters = rostersData.rosters as Record<string, Player[]>;
export const ROSTERS_AS_OF = rostersData.asOf as string;

const POSITION_ORDER: Record<Position, number> = { GK: 0, DF: 1, MF: 2, FW: 3 };

// Returns the squad for a team code, sorted by position then caps (desc), or
// null when no roster has been entered for that team yet.
export function getRoster(code: string | null | undefined): Player[] | null {
  if (!code) return null;
  const squad = rosters[code];
  if (!squad || squad.length === 0) return null;
  return squad
    .slice()
    .sort((a, b) => POSITION_ORDER[a.position] - POSITION_ORDER[b.position] || b.caps - a.caps);
}
