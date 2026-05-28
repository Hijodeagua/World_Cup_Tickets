import {
  SOURCE_TIER,
  type MatchForFetch,
  type ObservationInput,
  type ScrapeStatus,
  type TicketProvider,
} from "./types";

const PARSER_VERSION = "scraper-v1";

// Best-effort automated source. It NEVER throws: any failure becomes an
// observation with fetchSucceeded=false and a structured scrapeStatus so the
// ProviderRun log can distinguish "down" vs "blocked" vs "layout changed" vs
// "genuinely no data". Wire a real source by implementing `fetchRaw`.
export class BestEffortScraperProvider implements TicketProvider {
  readonly id = "scraper";
  readonly sourceTier = SOURCE_TIER.SCRAPER;

  async fetch(match: MatchForFetch): Promise<ObservationInput> {
    const started = Date.now();
    try {
      const raw = await this.fetchRaw(match);
      if (raw == null) {
        return this.fail(started, "NO_DATA", "source returned no data");
      }
      // A real parser would map `raw` -> availability/prices here.
      return this.fail(started, "NO_DATA", "no parser configured for source yet");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return this.fail(started, this.classify(reason), reason);
    }
  }

  // Replace with a real fetch (official deep link or resale API/page).
  // Returns null today so the provider degrades cleanly to UNKNOWN.
  protected async fetchRaw(_match: MatchForFetch): Promise<unknown | null> {
    return null;
  }

  private classify(reason: string): ScrapeStatus {
    const r = reason.toLowerCase();
    if (r.includes("403") || r.includes("blocked") || r.includes("captcha")) return "BLOCKED";
    if (r.includes("timeout") || r.includes("econn") || r.includes("enotfound")) return "SOURCE_DOWN";
    if (r.includes("selector") || r.includes("parse")) return "LAYOUT_CHANGED";
    return "ERROR";
  }

  private fail(started: number, scrapeStatus: ScrapeStatus, failureReason: string): ObservationInput {
    return {
      providerId: this.id,
      availability: "UNKNOWN",
      confidence: 0,
      sourceTier: SOURCE_TIER.UNKNOWN,
      parserVersion: PARSER_VERSION,
      fetchSucceeded: false,
      scrapeStatus,
      failureReason,
      responseTimeMs: Date.now() - started,
    };
  }
}
