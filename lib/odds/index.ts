// Pluggable match-odds source. Mirrors the ticket-provider philosophy: gated on
// an API key, never throws, and degrades to a clean "unavailable" result so the
// matchup forecast still renders (from our own simulation) when there's no key
// or no market coverage for a given fixture.
//
// Wire it up by setting THE_ODDS_API_KEY (free tier at https://the-odds-api.com).

const BASE_URL = "https://api.the-odds-api.com/v4/sports";
// The Odds API sport key for the men's World Cup. Adjust if the provider
// changes the slug closer to the tournament.
const SPORT_KEY = "soccer_fifa_world_cup";
const TIMEOUT_MS = 8_000;

export interface MarketOdds {
  available: boolean;
  reason?: string;
  source: string;
  bookmakerCount?: number;
  // De-vigged implied probabilities (0..1), normalised to sum to 1.
  implied?: { home: number; draw: number; away: number };
  // Average decimal odds across books, for display.
  decimal?: { home: number; draw: number; away: number };
}

interface OddsApiOutcome {
  name: string;
  price: number;
}
interface OddsApiEvent {
  home_team: string;
  away_team: string;
  bookmakers: { markets: { key: string; outcomes: OddsApiOutcome[] }[] }[];
}

const unavailable = (source: string, reason: string): MarketOdds => ({ available: false, source, reason });

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

export async function getMatchupOdds(homeTeam: string, awayTeam: string): Promise<MarketOdds> {
  const source = "the-odds-api";
  const apiKey = process.env.THE_ODDS_API_KEY;
  if (!apiKey) return unavailable(source, "THE_ODDS_API_KEY not configured");

  const params = new URLSearchParams({ apiKey, regions: "us,uk,eu", markets: "h2h", oddsFormat: "decimal" });
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/${SPORT_KEY}/odds?${params.toString()}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Cache across requests; odds don't move minute-to-minute and the free
      // tier is quota-limited.
      next: { revalidate: 1800 },
    });
  } catch (err) {
    return unavailable(source, err instanceof Error ? err.message : "fetch failed");
  }
  if (!res.ok) return unavailable(source, `http ${res.status}`);

  let events: OddsApiEvent[];
  try {
    events = (await res.json()) as OddsApiEvent[];
  } catch {
    return unavailable(source, "bad JSON");
  }

  const h = norm(homeTeam);
  const a = norm(awayTeam);
  const event = events.find((e) => {
    const eh = norm(e.home_team);
    const ea = norm(e.away_team);
    return (
      (eh.includes(h) || h.includes(eh) || ea.includes(h) || h.includes(ea)) &&
      (eh.includes(a) || a.includes(eh) || ea.includes(a) || a.includes(ea))
    );
  });
  if (!event) return unavailable(source, "no market coverage for this fixture");

  // Average decimal odds per outcome across all bookmakers.
  let homeSum = 0;
  let drawSum = 0;
  let awaySum = 0;
  let count = 0;
  for (const bk of event.bookmakers) {
    const market = bk.markets.find((m) => m.key === "h2h");
    if (!market) continue;
    const get = (team: string) =>
      market.outcomes.find((o) => norm(o.name).includes(norm(team)) || norm(team).includes(norm(o.name)))?.price;
    const draw = market.outcomes.find((o) => norm(o.name) === "draw")?.price;
    const home = get(event.home_team);
    const away = get(event.away_team);
    if (!home || !away || !draw) continue;
    homeSum += home;
    drawSum += draw;
    awaySum += away;
    count++;
  }
  if (count === 0) return unavailable(source, "no usable h2h market");

  // Map the API's home/away (its own designation) onto our home/away teams.
  const apiHomeIsOurHome = norm(event.home_team).includes(h) || h.includes(norm(event.home_team));
  const decHome = (apiHomeIsOurHome ? homeSum : awaySum) / count;
  const decAway = (apiHomeIsOurHome ? awaySum : homeSum) / count;
  const decDraw = drawSum / count;

  // De-vig: invert to raw probabilities, then normalise to sum to 1.
  const rawH = 1 / decHome;
  const rawD = 1 / decDraw;
  const rawA = 1 / decAway;
  const total = rawH + rawD + rawA;

  return {
    available: true,
    source,
    bookmakerCount: count,
    decimal: { home: round2(decHome), draw: round2(decDraw), away: round2(decAway) },
    implied: { home: rawH / total, draw: rawD / total, away: rawA / total },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
