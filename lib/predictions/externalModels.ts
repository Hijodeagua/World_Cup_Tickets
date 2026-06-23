// Reads data/external-models.json — published per-match World Cup 2026
// projections from outside models (currently Michael Caley's PADDLIN') — so the
// Compare page (/compare) can put our own model (the "Fyfa_Rat Model") side by
// side with them: win/draw/loss split, projected score, and game-by-game grading.
//
// The figures are subscriber-gated, so the JSON is transcribed by hand; every
// match/model is optional and missing data degrades to a dash. Nothing throws.

import data from "../../data/external-models.json";
import type { Outcome } from "./matchPredictions";

export type ModelKey = string;

export interface ModelMeta {
  key: ModelKey;
  name: string;
  author: string;
  source: string;
}

export interface ExternalMatch {
  // Win/draw/loss as published percentages (0..100), home team's perspective.
  pHome: number;
  pDraw: number;
  pAway: number;
  // Projected score (expected goals).
  projHome: number;
  projAway: number;
}

const MODELS = data.models as Record<ModelKey, { name: string; author: string; source: string }>;
const MATCHES = data.matches as Record<string, Record<ModelKey, ExternalMatch | undefined>>;

// Every model defined in the file, in declaration order.
export const MODEL_KEYS: ModelKey[] = Object.keys(MODELS);

export function modelMeta(key: ModelKey): ModelMeta {
  const m = MODELS[key];
  return { key, name: m.name, author: m.author, source: m.source };
}

// One model's projection for a fixture (keyed home-away), or null when absent.
export function externalMatch(
  homeCode: string | null | undefined,
  awayCode: string | null | undefined,
  key: ModelKey,
): ExternalMatch | null {
  if (!homeCode || !awayCode) return null;
  return MATCHES[`${homeCode}-${awayCode}`]?.[key] ?? null;
}

// The model's most likely outcome for a fixture (argmax of W/D/L), or null.
export function externalPick(
  homeCode: string | null | undefined,
  awayCode: string | null | undefined,
  key: ModelKey,
): { outcome: Outcome; p: number } | null {
  const e = externalMatch(homeCode, awayCode, key);
  if (!e) return null;
  if (e.pHome >= e.pDraw && e.pHome >= e.pAway) return { outcome: "A", p: e.pHome };
  if (e.pAway >= e.pDraw && e.pAway >= e.pHome) return { outcome: "B", p: e.pAway };
  return { outcome: "DRAW", p: e.pDraw };
}

// True if any model has a projection for this fixture — gates a Compare row.
export function hasAnyExternal(homeCode: string | null | undefined, awayCode: string | null | undefined): boolean {
  return MODEL_KEYS.some((k) => externalMatch(homeCode, awayCode, k) != null);
}
