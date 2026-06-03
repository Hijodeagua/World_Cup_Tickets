import { prisma } from "@/lib/db";
import { ManualProvider } from "./manual";
import { resolveState, type ResolvableObservation } from "./resolver";
import { BestEffortScraperProvider } from "./scraper";
import { SeatGeekProvider } from "./seatgeek";
import { TicketmasterProvider } from "./ticketmaster";
import type { MatchForFetch, ObservationInput, TicketProvider } from "./types";

export const providers: TicketProvider[] = [
  new ManualProvider(),
  new TicketmasterProvider(),
  new SeatGeekProvider(),
  new BestEffortScraperProvider(),
];

const LOCK_TTL_MS = 5 * 60 * 1000;
const MAX_JITTER_MS = 250;

// Adaptive polling: how stale an observation may be before a match is re-checked,
// based on how soon it kicks off. Closer matches change faster, so poll more often.
function minIntervalMs(kickoff: Date, now: Date): number {
  const untilKickoff = kickoff.getTime() - now.getTime();
  if (untilKickoff < 0) return Infinity; // played — stop polling
  const DAY = 24 * 60 * 60 * 1000;
  if (untilKickoff <= 7 * DAY) return 60 * 60 * 1000; // hourly
  if (untilKickoff <= 30 * DAY) return 6 * 60 * 60 * 1000; // 4x/day
  return DAY; // daily
}

async function acquireLock(now: Date): Promise<boolean> {
  const existing = await prisma.refreshLock.findUnique({ where: { id: "global" } });
  if (existing && existing.expiresAt > now) return false;
  await prisma.refreshLock.upsert({
    where: { id: "global" },
    create: { id: "global", lockedAt: now, expiresAt: new Date(now.getTime() + LOCK_TTL_MS) },
    update: { lockedAt: now, expiresAt: new Date(now.getTime() + LOCK_TTL_MS) },
  });
  return true;
}

async function releaseLock(): Promise<void> {
  await prisma.refreshLock
    .update({ where: { id: "global" }, data: { expiresAt: new Date(0) } })
    .catch(() => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RefreshResult {
  skipped?: "locked";
  matchesChecked: number;
  observationsWritten: number;
  statesUpdated: number;
  runs: { providerId: string; success: number; failure: number }[];
}

// One refresh pass: select due matches (adaptive), fetch every provider, persist
// immutable observations, recompute derived state, and log a ProviderRun per provider.
export async function runRefresh(now = new Date(), opts: { force?: boolean } = {}): Promise<RefreshResult> {
  if (!(await acquireLock(now))) return { skipped: "locked", matchesChecked: 0, observationsWritten: 0, statesUpdated: 0, runs: [] };

  try {
    const candidates = await prisma.match.findMany({
      where: { kickoff: { gt: now } },
      select: {
        id: true,
        fifaMatchNo: true,
        kickoff: true,
        stage: true,
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
        venue: { select: { city: true, country: true } },
        observations: { orderBy: { observedAt: "desc" }, take: 1, select: { observedAt: true } },
      },
    });

    const due: MatchForFetch[] = candidates
      .filter((m) => {
        if (opts.force) return true;
        const last = m.observations[0]?.observedAt;
        if (!last) return true;
        return now.getTime() - last.getTime() >= minIntervalMs(m.kickoff, now);
      })
      .map((m) => ({
        id: m.id,
        fifaMatchNo: m.fifaMatchNo,
        kickoff: m.kickoff,
        stage: m.stage,
        homeTeam: m.homeTeam?.name ?? null,
        awayTeam: m.awayTeam?.name ?? null,
        venueCity: m.venue.city,
        venueCountry: m.venue.country,
      }));

    const runStats = new Map<string, { success: number; failure: number; failures: unknown[] }>();
    for (const p of providers) runStats.set(p.id, { success: 0, failure: 0, failures: [] });

    let observationsWritten = 0;
    const affected = new Set<string>();

    for (const match of due) {
      for (const provider of providers) {
        let obs: ObservationInput;
        try {
          obs = await provider.fetch(match);
        } catch (err) {
          obs = {
            providerId: provider.id,
            availability: "UNKNOWN",
            confidence: 0,
            sourceTier: 0,
            fetchSucceeded: false,
            scrapeStatus: "ERROR",
            failureReason: err instanceof Error ? err.message : String(err),
          };
        }

        await prisma.ticketObservation.create({
          data: {
            matchId: match.id,
            providerId: obs.providerId,
            availability: obs.availability,
            minPrice: obs.minPrice ?? null,
            medianPrice: obs.medianPrice ?? null,
            currency: obs.currency ?? null,
            category: obs.category ?? null,
            quantity: obs.quantity ?? null,
            priceType: obs.priceType ?? null,
            rawPayload: obs.rawPayload == null ? null : JSON.stringify(obs.rawPayload),
            confidence: obs.confidence,
            sourceTier: obs.sourceTier,
            parserVersion: obs.parserVersion ?? null,
            fetchSucceeded: obs.fetchSucceeded,
            scrapeStatus: obs.scrapeStatus,
            failureReason: obs.failureReason ?? null,
            responseTimeMs: obs.responseTimeMs ?? null,
          },
        });
        observationsWritten++;
        affected.add(match.id);

        const stat = runStats.get(provider.id)!;
        if (obs.fetchSucceeded && obs.scrapeStatus === "OK") stat.success++;
        else {
          stat.failure++;
          stat.failures.push({ matchId: match.id, scrapeStatus: obs.scrapeStatus, reason: obs.failureReason });
        }

        if (MAX_JITTER_MS > 0) await sleep(Math.random() * MAX_JITTER_MS);
      }
    }

    const statesUpdated = await recomputeStates([...affected], now);

    for (const provider of providers) {
      const stat = runStats.get(provider.id)!;
      await prisma.providerRun.create({
        data: {
          providerId: provider.id,
          completedAt: new Date(),
          matchesChecked: due.length,
          matchesUpdated: stat.success + stat.failure,
          successCount: stat.success,
          failureCount: stat.failure,
          failures: stat.failures.length ? JSON.stringify(stat.failures) : null,
        },
      });
    }

    return {
      matchesChecked: due.length,
      observationsWritten,
      statesUpdated,
      runs: providers.map((p) => {
        const s = runStats.get(p.id)!;
        return { providerId: p.id, success: s.success, failure: s.failure };
      }),
    };
  } finally {
    await releaseLock();
  }
}

// Recompute CurrentTicketState from the latest observation per provider.
export async function recomputeStates(matchIds: string[], now = new Date()): Promise<number> {
  let updated = 0;
  for (const matchId of matchIds) {
    const recent = await prisma.ticketObservation.findMany({
      where: { matchId },
      orderBy: { observedAt: "desc" },
      take: providers.length * 3,
    });

    // Keep only the newest observation per provider.
    const latestByProvider = new Map<string, (typeof recent)[number]>();
    for (const o of recent) if (!latestByProvider.has(o.providerId)) latestByProvider.set(o.providerId, o);

    const resolvable: ResolvableObservation[] = [...latestByProvider.values()].map((o) => ({
      providerId: o.providerId,
      observedAt: o.observedAt,
      availability: o.availability as ResolvableObservation["availability"],
      minPrice: o.minPrice,
      medianPrice: o.medianPrice,
      currency: o.currency,
      confidence: o.confidence,
      sourceTier: o.sourceTier,
      fetchSucceeded: o.fetchSucceeded,
    }));

    const state = resolveState(resolvable, now);
    await prisma.currentTicketState.upsert({
      where: { matchId },
      create: { matchId, ...state },
      update: state,
    });
    updated++;
  }
  return updated;
}
