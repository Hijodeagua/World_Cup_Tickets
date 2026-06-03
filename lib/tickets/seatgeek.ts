import {
  SOURCE_TIER,
  type Availability,
  type MatchForFetch,
  type ObservationInput,
  type ScrapeStatus,
  type TicketProvider,
} from "./types";

const PARSER_VERSION = "seatgeek-v1";
const API_URL = "https://api.seatgeek.com/2/events";
const TIMEOUT_MS = 10_000;
const DATE_WINDOW_MS = 36 * 60 * 60 * 1000; // +/- 36h around kickoff

// Tiered resale provider:
//   Tier 1 — SeatGeek Platform API (free client_id): structured JSON price data.
//   Tier 2 — schema.org JSON-LD fallback on the matched event page: parses the
//            standardized <script type="application/ld+json"> Offer block when
//            the API itself surfaces no price. JSON-LD is a published spec, so
//            this is far sturdier than CSS scraping and degrades cleanly.
//
// Gated on SEATGEEK_CLIENT_ID: with no id it degrades to a clean UNKNOWN so it's
// safe by default. Like Ticketmaster, World Cup coverage may be partial, in
// which case it records NO_DATA rather than guessing.
export class SeatGeekProvider implements TicketProvider {
  readonly id = "seatgeek";
  readonly sourceTier = SOURCE_TIER.RESALE_API;

  private get clientId(): string | undefined {
    return process.env.SEATGEEK_CLIENT_ID;
  }

  async fetch(match: MatchForFetch): Promise<ObservationInput> {
    const started = Date.now();
    if (!this.clientId) {
      return this.degraded(started, true, SOURCE_TIER.UNKNOWN, "NO_DATA", "SEATGEEK_CLIENT_ID not configured");
    }

    // --- Tier 1: SeatGeek Platform API ---
    const params = new URLSearchParams({
      client_id: this.clientId,
      type: "sports",
      q: [match.homeTeam, match.awayTeam].filter(Boolean).join(" ") || "FIFA World Cup",
      "datetime_utc.gte": isoSeconds(new Date(match.kickoff.getTime() - DATE_WINDOW_MS)),
      "datetime_utc.lte": isoSeconds(new Date(match.kickoff.getTime() + DATE_WINDOW_MS)),
      per_page: "10",
      sort: "datetime_utc.asc",
    });
    const secret = process.env.SEATGEEK_CLIENT_SECRET;
    if (secret) params.set("client_secret", secret);

    let res: Response;
    try {
      res = await fetch(`${API_URL}?${params.toString()}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const status: ScrapeStatus = /timeout|abort|econn|enotfound|network/i.test(reason) ? "SOURCE_DOWN" : "ERROR";
      return this.degraded(started, false, SOURCE_TIER.UNKNOWN, status, reason);
    }

    if (res.status === 429) return this.degraded(started, false, SOURCE_TIER.UNKNOWN, "BLOCKED", "rate limited (429)");
    if (res.status === 401 || res.status === 403)
      return this.degraded(started, false, SOURCE_TIER.UNKNOWN, "BLOCKED", `auth/forbidden (${res.status})`);
    if (res.status >= 500) return this.degraded(started, false, SOURCE_TIER.UNKNOWN, "SOURCE_DOWN", `upstream ${res.status}`);
    if (!res.ok) return this.degraded(started, false, SOURCE_TIER.UNKNOWN, "ERROR", `http ${res.status}`);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return this.degraded(started, false, SOURCE_TIER.UNKNOWN, "LAYOUT_CHANGED", "response was not valid JSON");
    }

    const events = (body as { events?: SeatGeekEvent[] })?.events;
    if (!Array.isArray(events) || events.length === 0) {
      return this.degraded(started, true, SOURCE_TIER.UNKNOWN, "NO_DATA", "no matching events on SeatGeek");
    }

    const event = events[0];
    const stats = event.stats ?? {};
    const minPrice = firstNumber(stats.lowest_price, stats.lowest_price_good_deals);
    const medianPrice = firstNumber(stats.median_price, stats.average_price);
    const availability = mapAvailability(event.status, stats.listing_count, minPrice);

    if (minPrice != null) {
      return {
        providerId: this.id,
        availability,
        minPrice,
        medianPrice,
        currency: "USD", // SeatGeek prices are USD
        priceType: "RESALE",
        quantity: typeof stats.listing_count === "number" ? stats.listing_count : null,
        rawPayload: { tier: "api", eventId: event.id, status: event.status, url: event.url, stats },
        confidence: availability === "UNKNOWN" ? 0.2 : 0.75,
        sourceTier: this.sourceTier,
        parserVersion: PARSER_VERSION,
        fetchSucceeded: true,
        scrapeStatus: "OK",
        responseTimeMs: Date.now() - started,
      };
    }

    // --- Tier 2: JSON-LD fallback on the event page ---
    if (event.url) {
      const ld = await this.fetchJsonLdOffer(event.url).catch(() => null);
      if (ld?.minPrice != null) {
        return {
          providerId: this.id,
          availability: ld.availability ?? availability,
          minPrice: ld.minPrice,
          currency: ld.currency ?? "USD",
          priceType: "RESALE",
          rawPayload: { tier: "jsonld", eventId: event.id, url: event.url, offer: ld.raw },
          confidence: 0.5,
          sourceTier: SOURCE_TIER.SCRAPER,
          parserVersion: PARSER_VERSION,
          fetchSucceeded: true,
          scrapeStatus: "OK",
          responseTimeMs: Date.now() - started,
        };
      }
    }

    // Event matched but neither tier yielded a price.
    return {
      providerId: this.id,
      availability,
      minPrice: null,
      currency: "USD",
      priceType: "RESALE",
      rawPayload: { tier: "api", eventId: event.id, status: event.status, url: event.url, stats },
      confidence: availability === "UNKNOWN" ? 0.2 : 0.6,
      sourceTier: this.sourceTier,
      parserVersion: PARSER_VERSION,
      // No price, but we did positively identify the event and its on/off-sale
      // status — that is a usable availability signal, so this is not a failure.
      fetchSucceeded: availability !== "UNKNOWN",
      scrapeStatus: availability === "UNKNOWN" ? "NO_DATA" : "OK",
      failureReason: availability === "UNKNOWN" ? "event matched but no price or status" : null,
      responseTimeMs: Date.now() - started,
    };
  }

  // Fetch a public event page and extract a schema.org Offer/AggregateOffer.
  // Reads standardized structured data only; returns null on any miss so the
  // caller degrades cleanly.
  private async fetchJsonLdOffer(url: string): Promise<JsonLdOffer | null> {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; WorldCupTickets/1.0)" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const html = await res.text();

    for (const block of extractJsonLdBlocks(html)) {
      const offer = findOffer(block);
      if (offer) return offer;
    }
    return null;
  }

  private degraded(
    started: number,
    fetchSucceeded: boolean,
    sourceTier: number,
    scrapeStatus: ScrapeStatus,
    failureReason: string,
  ): ObservationInput {
    return {
      providerId: this.id,
      availability: "UNKNOWN",
      confidence: 0,
      sourceTier,
      parserVersion: PARSER_VERSION,
      fetchSucceeded,
      scrapeStatus,
      failureReason,
      responseTimeMs: Date.now() - started,
    };
  }
}

interface SeatGeekEvent {
  id?: number;
  url?: string;
  status?: string;
  stats?: {
    lowest_price?: number | null;
    lowest_price_good_deals?: number | null;
    average_price?: number | null;
    median_price?: number | null;
    highest_price?: number | null;
    listing_count?: number | null;
  };
}

interface JsonLdOffer {
  minPrice: number | null;
  currency: string | null;
  availability: Availability | null;
  raw: unknown;
}

function isoSeconds(d: Date): string {
  // SeatGeek expects naive UTC: YYYY-MM-DDThh:mm:ss
  return d.toISOString().slice(0, 19);
}

function firstNumber(...vals: (number | null | undefined)[]): number | null {
  for (const v of vals) if (typeof v === "number" && v > 0) return v;
  return null;
}

// SeatGeek doesn't expose a clean sold-out flag, so derive availability from
// the event status plus live listing count.
function mapAvailability(status: string | undefined, listingCount: number | null | undefined, minPrice: number | null): Availability {
  if (status === "cancelled" || status === "postponed") return "SOLD_OUT";
  if (typeof listingCount === "number") {
    if (listingCount === 0) return "SOLD_OUT";
    if (listingCount <= 10) return "LIMITED";
    return "AVAILABLE";
  }
  if (minPrice != null) return "AVAILABLE";
  return "UNKNOWN";
}

function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(m[1].trim()));
    } catch {
      // Skip malformed blocks.
    }
  }
  return blocks;
}

// Walk a parsed JSON-LD value looking for the first Offer/AggregateOffer with a
// usable price. Handles @graph arrays and nested offers.
function findOffer(node: unknown, depth = 0): JsonLdOffer | null {
  if (depth > 6 || node == null) return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findOffer(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;

  const type = obj["@type"];
  const isOffer = type === "Offer" || type === "AggregateOffer" || (Array.isArray(type) && type.some((t) => /Offer/.test(String(t))));
  if (isOffer) {
    const price = parsePrice(obj["lowPrice"] ?? obj["price"]);
    if (price != null) {
      return {
        minPrice: price,
        currency: typeof obj["priceCurrency"] === "string" ? (obj["priceCurrency"] as string) : null,
        availability: mapSchemaAvailability(obj["availability"]),
        raw: obj,
      };
    }
  }

  // Recurse into common nested holders (@graph, offers, etc.).
  for (const key of ["@graph", "offers", "makesOffer", "itemOffered"]) {
    if (key in obj) {
      const found = findOffer(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function parsePrice(v: unknown): number | null {
  if (typeof v === "number" && v > 0) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function mapSchemaAvailability(v: unknown): Availability | null {
  if (typeof v !== "string") return null;
  const s = v.toLowerCase();
  if (s.includes("soldout") || s.includes("outofstock")) return "SOLD_OUT";
  if (s.includes("limited")) return "LIMITED";
  if (s.includes("instock") || s.includes("available")) return "AVAILABLE";
  return null;
}
