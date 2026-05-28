import { prisma } from "@/lib/db";
import {
  MANUAL_OVERRIDE_TTL_MS,
  SOURCE_TIER,
  type MatchForFetch,
  type ObservationInput,
  type TicketProvider,
  isAvailability,
} from "./types";

// Reads human-entered overrides. A stale override (older than the TTL) decays
// to UNKNOWN so it never silently overrides a fresh automated observation.
export class ManualProvider implements TicketProvider {
  readonly id = "manual";
  readonly sourceTier = SOURCE_TIER.MANUAL;

  async fetch(match: MatchForFetch): Promise<ObservationInput> {
    const started = Date.now();
    const override = await prisma.manualOverride.findUnique({
      where: { matchId: match.id },
    });

    if (!override || !isAvailability(override.availability)) {
      return {
        providerId: this.id,
        availability: "UNKNOWN",
        confidence: 0,
        sourceTier: SOURCE_TIER.UNKNOWN,
        fetchSucceeded: true,
        scrapeStatus: "NO_DATA",
        failureReason: override ? "invalid override availability" : "no override set",
        responseTimeMs: Date.now() - started,
      };
    }

    const ageMs = Date.now() - override.updatedAt.getTime();
    if (ageMs > MANUAL_OVERRIDE_TTL_MS) {
      return {
        providerId: this.id,
        availability: "UNKNOWN",
        confidence: 0,
        sourceTier: SOURCE_TIER.UNKNOWN,
        rawPayload: { decayedFrom: override.availability, ageMs },
        fetchSucceeded: true,
        scrapeStatus: "NO_DATA",
        failureReason: "manual override expired (TTL)",
        responseTimeMs: Date.now() - started,
      };
    }

    return {
      providerId: this.id,
      availability: override.availability,
      minPrice: override.minPrice,
      currency: override.currency,
      priceType: "FACE_VALUE",
      rawPayload: { note: override.note, setBy: override.setBy },
      confidence: 1,
      sourceTier: SOURCE_TIER.MANUAL,
      fetchSucceeded: true,
      scrapeStatus: "OK",
      responseTimeMs: Date.now() - started,
    };
  }
}
