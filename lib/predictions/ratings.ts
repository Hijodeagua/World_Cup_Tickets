// Read-side helper for the editable Elo snapshot (data/elo-ratings.json).
// The simulation scripts read the file directly; pages use this to look up a
// single team's blended Elo for the head-to-head matchup view.

import elo from "../../data/elo-ratings.json";
import { blendElo } from "./elo";

const ratings = new Map(elo.ratings.map((r) => [r.code, r]));

export function getBlendedElo(code: string | null | undefined): number | null {
  if (!code) return null;
  const r = ratings.get(code);
  return r ? Math.round(blendElo(r.eloOnline, r.eloModel)) : null;
}
