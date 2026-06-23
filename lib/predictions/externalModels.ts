// Reads data/external-models.json — the published projections from two outside
// World Cup 2026 models (Michael Caley's PADDLIN' and Silver Bulletin's PELE) —
// so the groups page can show a "Calibration" comparison against our own model
// (labelled the "Fyfa_Rat Model") and /accuracy can grade all three game by game.
//
// The figures are subscriber-gated, so the JSON is filled in by hand; every
// field is optional and missing values degrade to a dash / are skipped. Nothing
// here throws on absent data.

import data from "../../data/external-models.json";
import type { Outcome } from "./matchPredictions";

export type ModelKey = "paddlin" | "pele";

export interface ModelMeta {
  key: ModelKey;
  name: string;
  author: string;
  source: string;
}

export interface ExternalTeamOdds {
  // Percentages (0..100) as published, or null when not yet entered.
  winGroup: number | null;
  advance: number | null;
  champion: number | null;
}

interface RawTeam {
  group: string;
  paddlin?: Partial<ExternalTeamOdds>;
  pele?: Partial<ExternalTeamOdds>;
}

const MODELS = data.models as Record<ModelKey, { name: string; author: string; source: string }>;
const TEAMS = data.teams as Record<string, RawTeam>;
const MATCH_PICKS = (data.matchPicks ?? {}) as Record<string, Partial<Record<ModelKey, Outcome | null>>>;

export const MODEL_KEYS: ModelKey[] = ["paddlin", "pele"];

export function modelMeta(key: ModelKey): ModelMeta {
  const m = MODELS[key];
  return { key, name: m.name, author: m.author, source: m.source };
}

// External odds for one team + model, or null fields when nothing is entered.
export function externalOdds(code: string | null | undefined, key: ModelKey): ExternalTeamOdds {
  const raw = code ? TEAMS[code]?.[key] : undefined;
  return {
    winGroup: raw?.winGroup ?? null,
    advance: raw?.advance ?? null,
    champion: raw?.champion ?? null,
  };
}

// True if any external advance figure has been entered for this team — used to
// decide whether the Calibration cell has anything to show.
export function hasAnyAdvance(code: string | null | undefined): boolean {
  return MODEL_KEYS.some((k) => externalOdds(code, k).advance != null);
}

// A model's predicted outcome for a given fixture (by fifaMatchNo), or null.
export function matchPick(fifaMatchNo: number, key: ModelKey): Outcome | null {
  return MATCH_PICKS[String(fifaMatchNo)]?.[key] ?? null;
}

// True if any external per-match picks exist at all — gates the model-comparison
// UI on /accuracy so it stays hidden until the data is filled in.
export function hasAnyMatchPicks(): boolean {
  return Object.values(MATCH_PICKS).some((m) => MODEL_KEYS.some((k) => m?.[k] != null));
}
