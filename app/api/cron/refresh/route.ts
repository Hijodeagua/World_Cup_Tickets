import { NextResponse } from "next/server";
import { runRefresh } from "@/lib/tickets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Triggered by Vercel Cron (see vercel.json). Protected by CRON_SECRET: Vercel
// sends it as a Bearer token; for manual local triggering pass the same header.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const force = new URL(request.url).searchParams.get("force") === "1";
  const result = await runRefresh(new Date(), { force });
  return NextResponse.json({ ok: true, force, ...result });
}
