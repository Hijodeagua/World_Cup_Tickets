export type Position = "GK" | "DF" | "MF" | "FW";

// Fields are nullable because the auto source (Wikipedia) only reliably provides
// name/position/caps/goals/club; league, assists and debut year come from the
// manual override layer (or a richer source later).
export interface Player {
  name: string;
  position: Position;
  club: string | null;
  league: string | null;
  caps: number | null;
  goals: number | null;
  assists: number | null;
  firstCapYear: number | null;
  source?: string;
}

const POSITION_ORDER: Record<Position, number> = { GK: 0, DF: 1, MF: 2, FW: 3 };

export function sortSquad(players: Player[]): Player[] {
  return players
    .slice()
    .sort(
      (a, b) =>
        POSITION_ORDER[a.position] - POSITION_ORDER[b.position] || (b.caps ?? 0) - (a.caps ?? 0) || a.name.localeCompare(b.name),
    );
}

export function normalizePosition(raw: string | null | undefined): Position {
  const s = (raw ?? "").toUpperCase();
  if (s.includes("GK") || s.startsWith("G")) return "GK";
  if (s.includes("DF") || s.includes("DEF") || s.startsWith("D")) return "DF";
  if (s.includes("FW") || s.includes("FORWARD") || s.includes("ST") || s.startsWith("F")) return "FW";
  return "MF";
}
