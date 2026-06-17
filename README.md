# World Cup Tickets

A website that tracks FIFA World Cup 2026 matches and shows which still have
tickets available. Match browsing and ticket availability are co-equal features.

## Why it's built this way

Match schedules are public and easy. Live ticket availability is **not** — FIFA
has no free public ticketing API and its site is bot-protected. So availability
is modeled as a **pluggable provider** with autonomous scheduled fetching plus a
manual override, and ticket data is stored as an **append-only observation
stream**, never overwritten in place. This unlocks history, sell-out timing, and
source-reliability analysis, and keeps the site useful even when a source breaks.

## Stack

- **Next.js 15** (App Router) + TypeScript + Tailwind CSS v4
- **Prisma** ORM — Postgres in every environment (local and production)
- **Vercel Cron** for the autonomous availability refresh

## Data model (`prisma/schema.prisma`)

- `Team`, `Venue`, `Match` — the schedule (104 matches, 16 host stadiums).
  `Match` also carries the result (`status`, `homeScore`, `awayScore`) once
  played, which drives the group standings and conditions the projections.
- `TicketObservation` — **immutable**, one row per fetch attempt (success or
  failure), with prices, raw payload, confidence, source tier, and a structured
  `scrapeStatus` (OK / SOURCE_DOWN / LAYOUT_CHANGED / BLOCKED / NO_DATA / ERROR).
- `CurrentTicketState` — **derived** from the stream by the resolver.
- `ProviderRun` — per-run log; powers the source-health dashboard.
- `ManualOverride` — human-entered availability (subject to TTL decay).
- `RefreshLock` — prevents overlapping cron runs.

## Ticket providers (`lib/tickets/`)

- `ManualProvider` — reads `ManualOverride`; entries older than the TTL
  (`MANUAL_OVERRIDE_TTL_MS`) decay to UNKNOWN so they never silently beat a fresh
  automated read.
- `TicketmasterProvider` — **real integration** with the Ticketmaster Discovery
  API. Queries by team names + city + date window, maps event onsale status to
  availability and `priceRanges` to price. Gated on `TICKETMASTER_API_KEY`; with
  no key it degrades to a clean UNKNOWN. Note: FIFA sells most World Cup tickets
  on its own portal, so Discovery coverage of these matches may be partial — the
  provider records that as NO_DATA rather than guessing.
- `BestEffortScraperProvider` — placeholder slot for an official-portal source.
  Never throws; any failure becomes a structured observation. Implement
  `fetchRaw` to wire it up.
- `resolver.ts` — picks the authoritative state by source tier → confidence →
  recency, and flags staleness (`STALE_AFTER_MS`).
- `index.ts` — the refresh loop: adaptive polling (closer matches polled more
  often), run-lock, request jitter, observation writes, derived-state recompute,
  and `ProviderRun` logging.

## Pages

- `/` — match list with filters (team, host city, stage, "available only").
- `/groups` — the twelve groups: live standings (P/W/D/L, GF/GA/GD, points)
  computed from completed results, alongside the Elo **Win Grp** / **Advance**
  projections for each team. Projections are recalculated after every result —
  played matches are fixed, the rest simulated (see below).
- `/matches/[id]` — match detail, availability + price, buy link, recent
  observations, and a **matchup view**: an Elo head-to-head forecast
  (win/draw/loss + average scoreline + the ten most likely scorelines), optional
  market lines, and both teams' rosters. Shown only when both teams are known.
- `/predictions` — Elo Monte Carlo title projections (see below).
- `/admin/health` — source health (error rate, last successful fetch, recent runs).
- `/api/cron/refresh` — the ticket refresh endpoint (Bearer `CRON_SECRET`).
- `/api/cron/predictions` — applies the latest results to `Match` rows and
  recomputes the Elo projections (Bearer `CRON_SECRET`).

## Title projections (`lib/predictions/`)

A Monte Carlo simulation (default 20,000 tournaments) estimates each team's odds
to win its group, advance, and lift the trophy.

- `data/elo-ratings.json` — strength snapshot blending an online World Football
  Elo (`eloOnline`, hand-maintained) and the model rating (`eloModel`); blend
  weight in `lib/predictions/elo.ts`. **`eloModel` is not hand-edited** — it is
  the Can-Tre-Beat-Vegas international Elo engine's output, synced in by
  `npm run sync-elo` (see "Elo ratings source" below).
- `elo.ts` — Poisson goals model driven by Elo difference (host boost for the
  three host nations); yields W/D/L and goal differences for tiebreakers.
- `simulate.ts` — simulates the real group fixtures, ranks with tiebreakers,
  qualifies 12 winners + 12 runners-up + 8 best thirds, then runs an Elo-seeded
  single-elimination bracket. **Already-played group matches
  (`data/results-2026.json`) are fixed, not simulated**, so projections
  condition on real results.
- Recompute: `npm run predict` (optionally pass iterations, e.g.
  `npm run predict 50000`). The nightly job does this automatically.

## Elo ratings source (`Can-Tre-Beat-Vegas`)

The model rating comes from the custom international Elo engine in the sibling
[Can-Tre-Beat-Vegas](https://github.com/Hijodeagua/Can-Tre-Beat-Vegas) repo
(`soccer/model/elo.py`: fresh-2006 start, tiered K-factors, margin-of-victory
multiplier). We do **not** re-implement Elo here — we consume that engine's
output so a single implementation backs both projects.

- That repo's `python -m soccer.model.export_ratings` dumps the full Elo table
  to `soccer/model/artifacts/elo_ratings.json`.
- `npm run sync-elo` reads that artifact (path via `ELO_RATINGS_PATH`, default
  `../Can-Tre-Beat-Vegas/...`), maps engine team names to our codes
  (`data/team-name-map.json`) and writes `eloModel` into `data/elo-ratings.json`
  with provenance (`eloModelSource`).
- `npm run sync-results` reads completed WC-2026 scores from that repo's
  `soccer/data/results.csv` and writes `data/results-2026.json`.

Caveat: the knockout bracket is **Elo-seeded**, not FIFA's exact slot/third-place
table — a projection, not a prediction.

## Matchup view (`lib/predictions/headToHead.ts`, `lib/odds/`, `lib/rosters.ts`)

The per-match page runs the same Elo + Poisson engine as the title projections
on just the two teams:

- `headToHead.ts` — derives win/draw/loss and the average scoreline from a large
  run (default 10,000) for stable percentages, while surfacing the **ten most
  likely exact scorelines** for human-readable texture. Deterministic per
  matchup (seeded from the two Elos). Host nations get the same home boost as the
  tournament sim.
- `lib/odds/` — a **pluggable, env-gated odds source** (The Odds API) mirroring
  the ticket-provider design: with `THE_ODDS_API_KEY` set it fetches h2h lines,
  averages across books, and de-vigs to implied probabilities shown beside the
  model; with no key (or no market coverage) it degrades cleanly and the forecast
  shows the model only. Never throws.
- `data/rosters.json` — editable squad snapshot (caps, goals, assists, position,
  club, league, debut year), one entry per team code. Seeded with real squads for
  the demo-matchup teams; add the rest the same way and the roster view renders
  them automatically. Teams without a roster show a graceful empty state.

## Local setup

Requires a Postgres database. Use any local or hosted instance (local Docker,
Neon, Vercel Postgres, etc.) and put its connection string in `DATABASE_URL`.

```bash
npm install
cp .env.example .env          # set DATABASE_URL (Postgres) + CRON_SECRET (+ optional TICKETMASTER_API_KEY)
npm run db:push               # create the schema in your Postgres database
npm run db:seed               # seed schedule + demo overrides, run first refresh
npm run dev                   # http://localhost:3000
```

Set `TICKETMASTER_API_KEY` (free from https://developer.ticketmaster.com) to
activate the live Ticketmaster provider; otherwise it stays a no-op.

Trigger a refresh manually:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/refresh
```

## Production (Vercel)

1. Set `DATABASE_URL` to your production Postgres connection string. The
   datasource `provider` is already `postgresql`, so no schema change is needed.
2. Set `CRON_SECRET`. `vercel.json` schedules three crons: the hourly ticket
   refresh, a weekly roster pull, and a **nightly predictions refresh**
   (`/api/cron/predictions`, 08:00 UTC) that applies new results and recomputes
   projections.

## Nightly Elo + projections refresh

Keeping the groups page and projections current is a nightly pipeline:

1. **GitHub Actions** (`.github/workflows/nightly-elo.yml`, 07:00 UTC) checks
   out this repo and Can-Tre-Beat-Vegas, runs the Python Elo engine
   (`fetch_results` → `export_ratings`) to **recalculate ratings from
   newly-played games**, then `npm run sync-elo` + `npm run sync-results` and
   commits the refreshed `data/elo-ratings.json` and `data/results-2026.json`.
   (Needs a `CANTRE_REPO_TOKEN` secret with read access to that repo.)
2. **Vercel Cron** (`/api/cron/predictions`, 08:00 UTC) then reads the committed
   data, writes the results onto `Match` rows (driving the standings) and
   recomputes the Elo Monte Carlo projections conditioned on them.

To run the whole chain locally (with Can-Tre-Beat-Vegas checked out alongside):

```bash
(cd ../Can-Tre-Beat-Vegas && python -m soccer.model.export_ratings)
npm run sync-elo && npm run sync-results
npm run predict        # recompute projections from the synced data
```

> **Schema note:** this integration adds `status`/`homeScore`/`awayScore` to
> `Match`. After pulling, run `npm run db:push` to apply them.

## Data accuracy note

`data/fixtures-2026.json` holds the **official** group-stage fixtures (FIFA Match
Schedule v17): the real 12 groups, team assignments, dates, host venues and
kickoff times for all 72 group matches, plus the real venue/date/time for all 32
knockout matches. Times are stored per the source as Eastern Time (`timeET`) and
converted to UTC at seed time (EDT, UTC-4, in June/July 2026); the UI renders
them in the viewer's local zone. Knockout matches keep their real slot
(venue/date/time) but teams stay TBD until group results are known — the
`/predictions` page projects who fills them.

The seed upserts by `fifaMatchNo`, so re-running picks up corrections, and
seed-time validation fails loudly on malformed fixtures (wrong group sizes,
unknown team/venue references, a team not playing exactly 3 group games, or a
stadium double-booked on a day).

## Out of scope (v1)

Notifications/price alerts and price-history charts are intentionally deferred,
but the observation stream is designed so they layer on top later without schema
changes.
