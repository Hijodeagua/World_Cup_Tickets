import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { refreshRosters } from "@/lib/rosters";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Triggered by Vercel Cron (see vercel.json). Protected by CRON_SECRET. Pulls
// each team's current squad from Wikipedia into the Player table; manual
// overrides in data/rosters.json are merged at read time.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const teams = await prisma.team.findMany({ select: { code: true, name: true }, orderBy: { name: "asc" } });
  const summaries = await refreshRosters(prisma, teams);
  const ok = summaries.filter((s) => s.ok).length;
  const players = summaries.reduce((n, s) => n + s.count, 0);
  return NextResponse.json({ ok: true, teams: teams.length, fetched: ok, players, summaries });
}
