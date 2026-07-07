// Sync completed World Cup 2026 results from the Can-Tre-Beat-Vegas dataset.
//
// That repo's soccer/data/results.csv carries the full international results
// feed (martj42), including the 2026 World Cup fixtures — scores fill in as
// matches are played. This reads the WC-2026 rows, maps team names to our
// codes, aligns each to its fixture (fifaMatchNo) and writes
// data/results-2026.json: the group-stage scores, plus the knockout rows —
// actual teams, scores and the advancing side (shootouts.csv decides drawn
// games). The cron predictions endpoint then applies these to Match rows,
// advances the bracket and re-runs the projections conditioned on them.
//
// Usage:
//   npm run sync-results
//   RESULTS_CSV_PATH=/path/to/results.csv npm run sync-results

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseWorldCupKnockoutsCsv, parseWorldCupResultsCsv } from "../lib/results/parse";

const DEFAULT_SOURCE = "../Can-Tre-Beat-Vegas/soccer/data/results.csv";
const OUT_FILE = resolve(__dirname, "../data/results-2026.json");

function main() {
  const csvPath = resolve(process.cwd(), process.env.RESULTS_CSV_PATH ?? DEFAULT_SOURCE);
  let text: string;
  try {
    text = readFileSync(csvPath, "utf8");
  } catch {
    throw new Error(`Could not read results CSV at ${csvPath}. Set RESULTS_CSV_PATH or check out Can-Tre-Beat-Vegas alongside this repo.`);
  }

  // Shootouts live next to results.csv in the same dataset; best-effort — a
  // drawn knockout game without a shootout row just has no winner yet.
  const shootoutsPath = process.env.SHOOTOUTS_CSV_PATH ?? resolve(dirname(csvPath), "shootouts.csv");
  let shootouts: string | undefined;
  try {
    shootouts = readFileSync(shootoutsPath, "utf8");
  } catch {
    shootouts = undefined;
    console.warn(`sync-results: no shootouts CSV at ${shootoutsPath}; drawn knockout games will have no winner`);
  }

  const { results, unmatched } = parseWorldCupResultsCsv(text);
  const ko = parseWorldCupKnockoutsCsv(text, shootouts);

  const payload = {
    note: (JSON.parse(readFileSync(OUT_FILE, "utf8")) as { note: string }).note,
    updatedAt: new Date().toISOString(),
    results,
    knockouts: ko.knockouts,
  };
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
  console.log(`sync-results: wrote ${results.length} group result(s) + ${ko.knockouts.length} knockout row(s) to ${OUT_FILE}`);
  const allUnmatched = [...unmatched, ...ko.unmatched];
  if (allUnmatched.length) console.warn(`sync-results: ${allUnmatched.length} unmatched row(s): ${allUnmatched.slice(0, 5).join("; ")}${allUnmatched.length > 5 ? " …" : ""}`);
}

main();
