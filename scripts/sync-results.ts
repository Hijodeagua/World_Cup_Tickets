// Sync completed World Cup 2026 results from the Can-Tre-Beat-Vegas dataset.
//
// That repo's soccer/data/results.csv carries the full international results
// feed (martj42), including the 2026 World Cup fixtures — scores fill in as
// matches are played. This reads the played WC-2026 rows, maps team names to
// our codes, aligns each to its fixture (fifaMatchNo) and writes
// data/results-2026.json. The cron predictions endpoint then applies these
// scores to Match rows and re-runs the projections conditioned on them.
//
// Usage:
//   npm run sync-results
//   RESULTS_CSV_PATH=/path/to/results.csv SHOOTOUTS_CSV_PATH=/path/to/shootouts.csv npm run sync-results

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseWorldCupResultsCsv } from "../lib/results/parse";

const DEFAULT_SOURCE = "../Can-Tre-Beat-Vegas/soccer/data/results.csv";
const DEFAULT_SHOOTOUTS = "../Can-Tre-Beat-Vegas/soccer/data/shootouts.csv";
const OUT_FILE = resolve(__dirname, "../data/results-2026.json");

function main() {
  const csvPath = resolve(process.cwd(), process.env.RESULTS_CSV_PATH ?? DEFAULT_SOURCE);
  let text: string;
  try {
    text = readFileSync(csvPath, "utf8");
  } catch {
    throw new Error(`Could not read results CSV at ${csvPath}. Set RESULTS_CSV_PATH or check out Can-Tre-Beat-Vegas alongside this repo.`);
  }

  // Shootouts decide knockout draws; best-effort since the file may lag results.
  const shootoutsPath = resolve(process.cwd(), process.env.SHOOTOUTS_CSV_PATH ?? DEFAULT_SHOOTOUTS);
  let shootoutsText: string | undefined;
  try {
    shootoutsText = readFileSync(shootoutsPath, "utf8");
  } catch {
    console.warn(`sync-results: no shootouts CSV at ${shootoutsPath}; knockout draws will have unknown winners`);
  }

  const { results, knockoutResults, unmatched } = parseWorldCupResultsCsv(text, shootoutsText);

  const payload = {
    note: (JSON.parse(readFileSync(OUT_FILE, "utf8")) as { note: string }).note,
    updatedAt: new Date().toISOString(),
    results,
    knockoutResults,
  };
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
  console.log(`sync-results: wrote ${results.length} group + ${knockoutResults.length} knockout result(s) to ${OUT_FILE}`);
  if (unmatched.length) console.warn(`sync-results: ${unmatched.length} unmatched row(s): ${unmatched.slice(0, 5).join("; ")}${unmatched.length > 5 ? " …" : ""}`);
}

main();
