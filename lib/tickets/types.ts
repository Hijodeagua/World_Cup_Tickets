// SQLite has no native enums, so these unions + const arrays are the single
// source of truth, validated in app code.

export const AVAILABILITY = ["AVAILABLE", "LIMITED", "SOLD_OUT", "UNKNOWN"] as const;
export type Availability = (typeof AVAILABILITY)[number];

export const SCRAPE_STATUS = [
  "OK",
  "SOURCE_DOWN",
  "LAYOUT_CHANGED",
  "BLOCKED",
  "NO_DATA",
  "ERROR",
] as const;
export type ScrapeStatus = (typeof SCRAPE_STATUS)[number];

export const PRICE_TYPE = ["FACE_VALUE", "RESALE", "UNKNOWN"] as const;
export type PriceType = (typeof PRICE_TYPE)[number];

// Source tiers — higher beats lower in the resolver.
export const SOURCE_TIER = {
  MANUAL: 100, // human override, highest trust
  OFFICIAL: 60, // official FIFA deep link
  RESALE_API: 40, // structured resale marketplace API
  SCRAPER: 20, // best-effort HTML scrape
  UNKNOWN: 0,
} as const;

// A manual override older than this is considered stale and decays to UNKNOWN
// rather than silently beating a fresh automated observation.
export const MANUAL_OVERRIDE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// Any current state whose newest observation is older than this is flagged stale.
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24 hours

// The shape every provider returns — always an observation, even on failure.
export interface ObservationInput {
  providerId: string;
  availability: Availability;
  minPrice?: number | null;
  medianPrice?: number | null;
  currency?: string | null;
  category?: string | null;
  quantity?: number | null;
  priceType?: PriceType | null;
  rawPayload?: unknown;
  confidence: number; // 0..1
  sourceTier: number;
  parserVersion?: string | null;
  fetchSucceeded: boolean;
  scrapeStatus: ScrapeStatus;
  failureReason?: string | null;
  responseTimeMs?: number | null;
}

export interface MatchForFetch {
  id: string;
  fifaMatchNo: number;
  kickoff: Date;
  stage: string;
}

export interface TicketProvider {
  readonly id: string;
  readonly sourceTier: number;
  fetch(match: MatchForFetch): Promise<ObservationInput>;
}

export function isAvailability(v: string): v is Availability {
  return (AVAILABILITY as readonly string[]).includes(v);
}
