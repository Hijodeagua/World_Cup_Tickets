import Link from "next/link";
import type { MatchWithRelations } from "@/lib/matches";
import { AVAILABILITY_BADGE, STAGE_LABELS, formatKickoff, formatPrice } from "@/lib/format";
import { isAvailability } from "@/lib/tickets/types";

export function AvailabilityBadge({ availability, stale }: { availability: string; stale?: boolean }) {
  const key = isAvailability(availability) ? availability : "UNKNOWN";
  const badge = AVAILABILITY_BADGE[key];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}>
      {badge.label}
      {stale && <span title="Data may be out of date">·stale</span>}
    </span>
  );
}

function side(team: { name: string; flag: string | null } | null, label: string | null): string {
  if (team) return `${team.flag ?? ""} ${team.name}`.trim();
  return label ?? "TBD";
}

export function MatchRow({ match, tz }: { match: MatchWithRelations; tz?: string }) {
  const state = match.currentState;
  const price = formatPrice(state?.minPrice ?? null, state?.currency ?? null);
  return (
    <Link
      href={`/matches/${match.id}`}
      className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4 transition hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span>{STAGE_LABELS[match.stage] ?? match.stage}</span>
          {match.group && <span>· Group {match.group}</span>}
          {!match.confirmed && <span className="italic">· provisional</span>}
        </div>
        <div className="truncate font-medium">
          {side(match.homeTeam, match.homeLabel)} <span className="text-neutral-400">vs</span> {side(match.awayTeam, match.awayLabel)}
        </div>
        <div className="text-sm text-neutral-500">
          {formatKickoff(match.kickoff, tz)} · {match.venue.stadium}, {match.venue.city}
        </div>
      </div>
      <div className="flex items-center gap-3 sm:flex-col sm:items-end">
        <AvailabilityBadge availability={state?.availability ?? "UNKNOWN"} stale={state?.isStale} />
        {price && <span className="text-sm font-semibold">from {price}</span>}
      </div>
    </Link>
  );
}
