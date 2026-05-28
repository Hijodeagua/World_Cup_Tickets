import {
  SOURCE_TIER,
  type Availability,
  type MatchForFetch,
  type ObservationInput,
  type ScrapeStatus,
  type TicketProvider,
} from "./types";

const PARSER_VERSION = "ticketmaster-discovery-v1";
const BASE_URL = "https://app.ticketmaster.com/discovery/v2/events.json";
const TIMEOUT_MS = 10_000;
const DATE_WINDOW_MS = 36 * 60 * 60 * 1000; // +/- 36h around kickoff

// Real integration with Ticketmaster's public Discovery API (free key required).
// Gated on TICKETMASTER_API_KEY: with no key it degrades to a clean UNKNOWN so
// it's safe by default. Note: FIFA sells most World Cup tickets through its own
// portal, so Discovery coverage of these matches may be partial — the provider
// is built to record exactly that (NO_DATA) rather than guess.
export class TicketmasterProvider implements TicketProvider {
  readonly id = "ticketmaster";
  readonly sourceTier = SOURCE_TIER.RESALE_API;

  private get apiKey(): string | undefined {
    return process.env.TICKETMASTER_API_KEY;
  }

  async fetch(match: MatchForFetch): Promise<ObservationInput> {
    const started = Date.now();
    if (!this.apiKey) {
      return this.degraded(started, true, "NO_DATA", "TICKETMASTER_API_KEY not configured");
    }

    const params = new URLSearchParams({
      apikey: this.apiKey,
      classificationName: "Soccer",
      keyword: [match.homeTeam, match.awayTeam].filter(Boolean).join(" ") || "FIFA World Cup",
      startDateTime: new Date(match.kickoff.getTime() - DATE_WINDOW_MS).toISOString().slice(0, 19) + "Z",
      endDateTime: new Date(match.kickoff.getTime() + DATE_WINDOW_MS).toISOString().slice(0, 19) + "Z",
      size: "20",
      sort: "date,asc",
    });
    if (match.venueCity) params.set("city", match.venueCity);

    let res: Response;
    try {
      res = await fetch(`${BASE_URL}?${params.toString()}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const status: ScrapeStatus = /timeout|abort|econn|enotfound|network/i.test(reason) ? "SOURCE_DOWN" : "ERROR";
      return this.degraded(started, false, status, reason);
    }

    if (res.status === 429) return this.degraded(started, false, "BLOCKED", "rate limited (429)");
    if (res.status === 401 || res.status === 403) return this.degraded(started, false, "BLOCKED", `auth/forbidden (${res.status})`);
    if (res.status >= 500) return this.degraded(started, false, "SOURCE_DOWN", `upstream ${res.status}`);
    if (!res.ok) return this.degraded(started, false, "ERROR", `http ${res.status}`);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return this.degraded(started, false, "LAYOUT_CHANGED", "response was not valid JSON");
    }

    const events = (body as { _embedded?: { events?: unknown[] } })?._embedded?.events;
    if (!Array.isArray(events) || events.length === 0) {
      return this.degraded(started, true, "NO_DATA", "no matching events on Ticketmaster");
    }

    const event = events[0] as {
      id?: string;
      url?: string;
      dates?: { status?: { code?: string } };
      priceRanges?: { min?: number; currency?: string }[];
    };
    const statusCode = event.dates?.status?.code;
    const availability = mapStatus(statusCode);

    let minPrice: number | null = null;
    let currency: string | null = null;
    if (Array.isArray(event.priceRanges) && event.priceRanges.length) {
      const mins = event.priceRanges.map((p) => p.min).filter((x): x is number => typeof x === "number");
      if (mins.length) minPrice = Math.min(...mins);
      currency = event.priceRanges[0].currency ?? null;
    }

    return {
      providerId: this.id,
      availability,
      minPrice,
      currency,
      priceType: "RESALE",
      rawPayload: { eventId: event.id, statusCode, url: event.url, priceRanges: event.priceRanges },
      confidence: availability === "UNKNOWN" ? 0.2 : 0.7,
      sourceTier: this.sourceTier,
      parserVersion: PARSER_VERSION,
      fetchSucceeded: true,
      scrapeStatus: "OK",
      responseTimeMs: Date.now() - started,
    };
  }

  private degraded(started: number, fetchSucceeded: boolean, scrapeStatus: ScrapeStatus, failureReason: string): ObservationInput {
    return {
      providerId: this.id,
      availability: "UNKNOWN",
      confidence: 0,
      sourceTier: SOURCE_TIER.UNKNOWN,
      parserVersion: PARSER_VERSION,
      fetchSucceeded,
      scrapeStatus,
      failureReason,
      responseTimeMs: Date.now() - started,
    };
  }
}

function mapStatus(code: string | undefined): Availability {
  switch (code) {
    case "onsale":
      return "AVAILABLE";
    case "offsale":
    case "cancelled":
    case "postponed":
    case "rescheduled":
      return "SOLD_OUT";
    default:
      return "UNKNOWN";
  }
}
