// Sync this site's `eloModel` ratings from the Can-Tre-Beat-Vegas Elo engine.
//
// The custom international Elo (fresh-2006 start, tiered K-factors) lives in
// that repo's soccer/model/elo.py and is the single source of truth for the
// model rating. `export_ratings.py` there dumps it to elo_ratings.json; this
// script maps those team-name-keyed ratings onto our team codes and writes
// them into data/elo-ratings.json as `eloModel`. We never recompute Elo here.
//
// The `eloOnline` column (eloratings.net-style) is left untouched, so the
// existing blend (lib/predictions/elo.ts) keeps combining the two sources.
//
// Usage:
//   npm run sync-elo
//   ELO_RATINGS_PATH=/path/to/elo_ratings.json npm run sync-elo
//
// Default source path assumes Can-Tre-Beat-Vegas is checked out alongside
// this repo (../Can-Tre-Beat-Vegas), as the nightly workflow arranges.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import fixtures from "../data/fixtures-2026.json";
import nameMap from "../data/team-name-map.json";

const DEFAULT_SOURCE = "../Can-Tre-Beat-Vegas/soccer/model/artifacts/elo_ratings.json";
const ELO_FILE = resolve(__dirname, "../data/elo-ratings.json");

interface EngineRating {
  team: string;
  elo: number;
  matches: number;
}
interface EngineExport {
  generatedAt: string;
  source: string;
  ratings: EngineRating[];
}

function loadEngineRatings(): EngineExport {
  const sourcePath = resolve(process.cwd(), process.env.ELO_RATINGS_PATH ?? DEFAULT_SOURCE);
  let raw: string;
  try {
    raw = readFileSync(sourcePath, "utf8");
  } catch {
    throw new Error(
      `Could not read engine ratings at ${sourcePath}.\n` +
        `Generate it first:  (in Can-Tre-Beat-Vegas)  python -m soccer.model.export_ratings\n` +
        `or point ELO_RATINGS_PATH at the elo_ratings.json artifact.`,
    );
  }
  return JSON.parse(raw) as EngineExport;
}

function main() {
  const engine = loadEngineRatings();
  const byName = new Map(engine.ratings.map((r) => [r.team, r]));
  const codeToName = (nameMap as { codeToEngineName: Record<string, string> }).codeToEngineName;

  const elo = JSON.parse(readFileSync(ELO_FILE, "utf8")) as {
    ratings: { code: string; eloOnline: number; eloModel: number }[];
    [k: string]: unknown;
  };
  const fixtureName = new Map((fixtures.teams as { code: string; name: string }[]).map((t) => [t.code, t.name]));
  const existing = new Map(elo.ratings.map((r) => [r.code, r]));

  const missing: string[] = [];
  let updated = 0;

  // Cover every team in the tournament, not just the ones already in the file.
  for (const t of fixtures.teams as { code: string; name: string }[]) {
    const engineName = codeToName[t.code] ?? fixtureName.get(t.code) ?? t.code;
    const rating = byName.get(engineName);
    if (!rating) {
      missing.push(`${t.code} (${engineName})`);
      continue;
    }
    const row = existing.get(t.code);
    const eloModel = Math.round(rating.elo);
    if (row) {
      row.eloModel = eloModel;
    } else {
      // New team with no prior online rating: seed eloOnline from the model too.
      const fresh = { code: t.code, eloOnline: eloModel, eloModel };
      elo.ratings.push(fresh);
      existing.set(t.code, fresh);
    }
    updated++;
  }

  elo.eloModelSource = {
    engine: engine.source,
    generatedAt: engine.generatedAt,
    syncedAt: new Date().toISOString(),
  };

  writeFileSync(ELO_FILE, JSON.stringify(elo, null, 2) + "\n");
  console.log(`sync-elo: updated eloModel for ${updated}/${(fixtures.teams as unknown[]).length} teams from ${engine.source}`);
  if (missing.length) console.warn(`sync-elo: no engine rating for ${missing.length} team(s): ${missing.join(", ")}`);
}

main();
