import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureMatchColumns } from "@/lib/ensure-schema";
import { computeAndStoreProjections } from "@/lib/predictions/store";
import { refreshMatchPredictions } from "@/lib/predictions/matchPredictions";
import results2026 from "@/data/results-2026.json";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface StoredResult {
  fifaMatchNo: number;
  homeScore: number;
  awayScore: number;
}

// Triggered nightly by Vercel Cron (see vercel.json). Protected by CRON_SECRET.
// Three steps:
//   1. apply the latest committed results (data/results-2026.json, refreshed by
//      `npm run sync-results`) onto Match rows so the groups page standings are
//      current;
//   2. recompute the Elo Monte Carlo projections, now conditioned on those
//      results, and persist them (TeamProjection);
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
  const stored = (results2026.results as StoredResult[]) ?? [];
  let applied = 0;
  for (const r of stored) {
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
    resultsApplied: applied,
    resultsKnown: stored.length,
    teamsProjected: teams,
    predictions,
  });
}
