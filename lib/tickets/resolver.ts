import { STALE_AFTER_MS, type Availability } from "./types";

export interface ResolvableObservation {
  providerId: string;
  observedAt: Date;
  availability: Availability;
  minPrice: number | null;
  medianPrice: number | null;
  currency: string | null;
  confidence: number;
  sourceTier: number;
  fetchSucceeded: boolean;
}

export interface ResolvedState {
  availability: Availability;
  minPrice: number | null;
  medianPrice: number | null;
  currency: string | null;
  sourceTier: number;
  confidence: number;
  winningProviderId: string | null;
  lastObservedAt: Date | null;
  isStale: boolean;
}

// Picks the authoritative current state from a match's recent observations.
// Prefers higher source tier, then confidence, then recency — but only among
// observations that actually carry a signal (succeeded + not UNKNOWN). Falls
// back to UNKNOWN when nothing usable exists. Flags staleness off the newest
// observation regardless of which one wins.
export function resolveState(observations: ResolvableObservation[], now = new Date()): ResolvedState {
  const newest = observations.reduce<Date | null>(
    (max, o) => (max === null || o.observedAt > max ? o.observedAt : max),
    null,
  );

  const usable = observations
    .filter((o) => o.fetchSucceeded && o.availability !== "UNKNOWN")
    .sort((a, b) => {
      if (b.sourceTier !== a.sourceTier) return b.sourceTier - a.sourceTier;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.observedAt.getTime() - a.observedAt.getTime();
    });

  const isStale = newest === null || now.getTime() - newest.getTime() > STALE_AFTER_MS;

  const winner = usable[0];
  if (!winner) {
    return {
      availability: "UNKNOWN",
      minPrice: null,
      medianPrice: null,
      currency: null,
      sourceTier: 0,
      confidence: 0,
      winningProviderId: null,
      lastObservedAt: newest,
      isStale,
    };
  }

  return {
    availability: winner.availability,
    minPrice: winner.minPrice,
    medianPrice: winner.medianPrice,
    currency: winner.currency,
    sourceTier: winner.sourceTier,
    confidence: winner.confidence,
    winningProviderId: winner.providerId,
    lastObservedAt: newest,
    isStale,
  };
}
