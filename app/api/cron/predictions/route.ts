import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureMatchColumns } from "@/lib/ensure-schema";
import { applyKnockoutsToDb } from "@/lib/bracket";
import { computeAndStoreProjections } from "@/lib/predictions/store";
import { refreshMatchPredictions } from "@/lib/predictions/matchPredictions";
import {
  DEFAULT_RESULTS_CSV_URL,
  DEFAULT_SHOOTOUTS_CSV_URL,
  parseWorldCupKnockoutsCsv,
  parseWorldCupResultsCsv,
  type KnockoutRow,
  type ResultRow,
} from "@/lib/results/parse";
import results2026 from "@/data/results-2026.json";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

// Pull the freshest scores: fetch the live results feed (plus the shootouts
// feed, which decides drawn knockout games), and fall back to the committed
// snapshot (data/results-2026.json) if the network is down or the feed is
// unparseable. This is what makes the nightly run reflect each new game —
// group standings AND the knockout bracket — without a manual
// `npm run sync-results` + redeploy.
async function loadResults(): Promise<{
  rows: ResultRow[];
  knockouts: KnockoutRow[];
  source: "live" | "committed";
  unmatched: number;
}> {
  const committed = {
    rows: (results2026.results as ResultRow[]) ?? [],
    knockouts: ((results2026 as { knockouts?: KnockoutRow[] }).knockouts as KnockoutRow[]) ?? [],
    source: "committed" as const,
    unmatched: 0,
  };
  try {
    const url = process.env.RESULTS_CSV_URL ?? DEFAULT_RESULTS_CSV_URL;
    const text = await fetchText(url);
    const { results, unmatched } = parseWorldCupResultsCsv(text);
    // Guard against an empty/garbled feed silently wiping progress: only trust
    // the live pull if it has at least as many results as the committed file.
    if (results.length < committed.rows.length) return committed;

    // Shootouts are best-effort: without them a drawn knockout game simply has
    // no winner yet and the bracket holds that slot until the next night.
    let shootouts: string | undefined;
    try {
      shootouts = await fetchText(process.env.SHOOTOUTS_CSV_URL ?? DEFAULT_SHOOTOUTS_CSV_URL);
    } catch {
      shootouts = undefined;
    }
    const ko = parseWorldCupKnockoutsCsv(text, shootouts);
    if (ko.knockouts.length < committed.knockouts.length) return committed;

    return {
      rows: results,
      knockouts: ko.knockouts,
      source: "live",
      unmatched: unmatched.length + ko.unmatched.length,
    };
  } catch {
    return committed;
  }
}

// Triggered nightly by Vercel Cron (see vercel.json). Protected by CRON_SECRET.
// Four steps, run every night so the site reflects the previous day's games:
//   1. apply the latest group results (live feed, committed snapshot as
//      fallback) onto Match rows so the groups page standings are current;
//   2. update the knockout bracket: write each knockout match's actual teams
//      and result (shootout winners included) onto its Match row, and fill
//      later-round slots from the winners via the bracket lineage — this is
//      what keeps the bracket advancing after the group stage;
//   3. recompute the Elo Monte Carlo projections — conditioned on the group
//      results and, once the round of 32 is set, on the REAL bracket — and
//      persist them (TeamProjection). This runs every night regardless of
//      whether a new result landed;
//   4. refresh per-match predictions (knockout games get one as soon as their
//      teams are known), freezing the ones inside the kickoff window so past
//      predictions are preserved exactly as they were made.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  await ensureMatchColumns(prisma);

  // 1. Apply group results to Match rows (idempotent — only writes on change).
  const { rows, knockouts, source, unmatched } = await loadResults();
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

  // 2. Advance the knockout bracket: actual teams, scores and winners onto the
  //    knockout Match rows, later rounds filled from winners via the lineage.
  const bracket = await applyKnockoutsToDb(prisma, knockouts);

  // 3. Recompute the tournament projections conditioned on the results (and
  //    the real bracket once it exists).
  const teams = await computeAndStoreProjections(prisma);

  // 4. Refresh per-match predictions and freeze any inside the kickoff window.
  //    Frozen rows are left untouched, so predictions for games already played
  //    keep the value they had the night before (drives /accuracy).
  const predictions = await refreshMatchPredictions(prisma, new Date());

  return NextResponse.json({
    ok: true,
    resultsSource: source,
    resultsApplied: applied,
    resultsKnown: rows.length,
    resultsUnmatched: unmatched,
    knockoutsKnown: knockouts.length,
    bracket,
    teamsProjected: teams,
    predictions,
  });
}
