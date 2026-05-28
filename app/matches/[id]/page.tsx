import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getMatch } from "@/lib/matches";
import { STAGE_LABELS, formatKickoff, formatPrice } from "@/lib/format";
import { AvailabilityBadge } from "@/app/ui";

export const dynamic = "force-dynamic";

function side(team: { name: string; flag: string | null } | null, label: string | null): string {
  if (team) return `${team.flag ?? ""} ${team.name}`.trim();
  return label ?? "TBD";
}

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = await getMatch(id);
  if (!match) notFound();

  const recent = await prisma.ticketObservation.findMany({
    where: { matchId: id },
    orderBy: { observedAt: "desc" },
    take: 10,
  });

  const state = match.currentState;
  const price = formatPrice(state?.minPrice ?? null, state?.currency ?? null);

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-neutral-500 hover:underline">
        ← All matches
      </Link>

      <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span>{STAGE_LABELS[match.stage] ?? match.stage}</span>
          {match.group && <span>· Group {match.group}</span>}
          {!match.confirmed && <span className="italic">· provisional (subject to change)</span>}
        </div>
        <h1 className="mt-1 text-2xl font-bold">
          {side(match.homeTeam, match.homeLabel)} <span className="text-neutral-400">vs</span> {side(match.awayTeam, match.awayLabel)}
        </h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          {formatKickoff(match.kickoff)} · {match.venue.stadium}, {match.venue.city}, {match.venue.country}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <AvailabilityBadge availability={state?.availability ?? "UNKNOWN"} stale={state?.isStale} />
          {price && <span className="text-lg font-semibold">from {price}</span>}
          {state?.lastObservedAt && (
            <span className="text-xs text-neutral-500">last checked {formatKickoff(state.lastObservedAt)}</span>
          )}
          {(state?.availability === "AVAILABLE" || state?.availability === "LIMITED") && (
            <a
              href="https://www.fifa.com/en/tickets"
              target="_blank"
              rel="noreferrer noopener"
              className="ml-auto rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
            >
              Buy tickets →
            </a>
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-500">Recent observations</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-neutral-500">No observations recorded yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-100 text-xs uppercase text-neutral-500 dark:bg-neutral-800">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Availability</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((o) => (
                  <tr key={o.id} className="border-t border-neutral-200 dark:border-neutral-800">
                    <td className="px-3 py-2 text-neutral-500">{formatKickoff(o.observedAt)}</td>
                    <td className="px-3 py-2">{o.providerId}</td>
                    <td className="px-3 py-2">{o.availability}</td>
                    <td className="px-3 py-2 text-neutral-500">
                      {o.fetchSucceeded ? o.scrapeStatus : `${o.scrapeStatus}: ${o.failureReason ?? ""}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
