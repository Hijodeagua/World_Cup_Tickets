import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureMatchColumns } from "@/lib/ensure-schema";
import { computeAndStoreProjections } from "@/lib/predictions/store";
import { refreshMatchPredictions } from "@/lib/predictions/matchPredictions";
import { DEFAULT_RESULTS_CSV_URL, parseWorldCupResultsCsv, type ResultRow } from "@/lib/results/parse";
import results2026 from "@/data/results-2026.json";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Pull the freshest completed scores: fetch the live results feed, and fall back
// to the committed snapshot (data/results-2026.json) if the network is down or
// the feed is unparseable. This is what makes the nightly run reflect each new
// game without a manual `npm run sync-results` + redeploy.
async function loadResults(): Promise<{ rows: ResultRow[]; source: "live" | "committed"; unmatched: number }> {
  const url = process.env.RESULTS_CSV_URL ?? DEFAULT_RESULTS_CSV_URL;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
    const { results, unmatched } = parseWorldCupResultsCsv(await res.text());
    // Guard against an empty/garbled feed silently wiping progress: only trust
    // the live pull if it has at least as many results as the committed file.
    const committed = (results2026.results as ResultRow[]) ?? [];
    if (results.length < committed.length) {
      return { rows: committed, source: "committed", unmatched: 0 };
    }
    return { rows: results, source: "live", unmatched: unmatched.length };
  } catch {
    return { rows: (results2026.results as ResultRow[]) ?? [], source: "committed", unmatched: 0 };
  }
}

// Triggered nightly by Vercel Cron (see vercel.json). Protected by CRON_SECRET.
// Three steps, run every night so the site reflects the previous day's games:
//   1. apply the latest results (live feed, committed snapshot as fallback) onto
//      Match rows so the groups page standings are current;
//   2. recompute the Elo Monte Carlo projections — group-stage advancement and
//      full tournament-to-champion odds — conditioned on those results, and
//      persist them (TeamProjection). This runs every night regardless of
//      whether a new result landed;
//   3. refresh per-match predictions, freezing the ones inside the kickoff
//      window so past predictions are preserved exactly as they were made.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  await ensureMatchColumns(prisma);

  // 1. Apply results to Match rows (idempotent — only writes on change).
  const { rows, source, unmatched } = await loadResults();
  let applied = 0;
  for (const r of rows) {
    const match = await prisma.match.findUnique({ where: { fifaMatchNo: r.fifaMatchNo } });
    if (!match) continue;
    if (match.status === "COMPLETED" && match.homeScore === r.homeScore && match.awayScore === r.awayScore) continue;
    await prisma.match.update({
      where: { fifaMatchNo: r.fifaMatchNo },
      data: { status: "COMPLETED", homeScore: r.homeScore, awayScore: r.awayScore },
    });
    applied++;
  }

  // 2. Recompute the tournament projections conditioned on the results.
  const teams = await computeAndStoreProjections(prisma);

  // 3. Refresh per-match predictions and freeze any inside the kickoff window.
  //    Frozen rows are left untouched, so predictions for games already played
  //    keep the value they had the night before (drives /accuracy).
  const predictions = await refreshMatchPredictions(prisma, new Date());

  return NextResponse.json({
    ok: true,
    resultsSource: source,
    resultsApplied: applied,
    resultsKnown: rows.length,
    resultsUnmatched: unmatched,
    teamsProjected: teams,
    predictions,
  });
}
