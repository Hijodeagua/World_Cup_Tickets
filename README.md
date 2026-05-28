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
- **Prisma** ORM — SQLite for local dev, Postgres for production
- **Vercel Cron** for the autonomous availability refresh

## Data model (`prisma/schema.prisma`)

- `Team`, `Venue`, `Match` — the schedule (104 matches, 16 host stadiums).
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
- `BestEffortScraperProvider` — pluggable automated source. Never throws; any
  failure becomes a structured observation. Implement `fetchRaw` to wire a real
  source (official deep link or resale API).
- `resolver.ts` — picks the authoritative state by source tier → confidence →
  recency, and flags staleness (`STALE_AFTER_MS`).
- `index.ts` — the refresh loop: adaptive polling (closer matches polled more
  often), run-lock, request jitter, observation writes, derived-state recompute,
  and `ProviderRun` logging.

## Pages

- `/` — match list with filters (team, host city, stage, "available only").
- `/matches/[id]` — match detail, availability + price, buy link, recent
  observations.
- `/admin/health` — source health (error rate, last successful fetch, recent runs).
- `/api/cron/refresh` — the refresh endpoint (Bearer `CRON_SECRET`).

## Local setup

```bash
npm install
cp .env.example .env          # SQLite + a CRON_SECRET
npm run db:push               # create the SQLite schema
npm run db:seed               # seed schedule + demo overrides, run first refresh
npm run dev                   # http://localhost:3000
```

Trigger a refresh manually:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/refresh
```

## Production (Vercel)

1. Set `DATABASE_URL` to a Postgres connection string and change the datasource
   `provider` in `prisma/schema.prisma` to `postgresql`.
2. Set `CRON_SECRET`. `vercel.json` already schedules the hourly cron; the loop
   internally throttles per-match via adaptive polling.

## Data accuracy note

`data/fixtures-2026.json` holds the **official** group-stage fixtures (FIFA Match
Schedule v17): the real 12 groups, team assignments, dates and host venues for
all 72 group matches. Kickoff **times** are not in that source, so each day's
matches are staggered across afternoon/evening slots and should be treated as
approximate until confirmed. Knockout matches (Round of 32 onward) remain
provisional placeholders since the teams depend on group results.

The seed upserts by `fifaMatchNo`, so re-running picks up corrections, and
seed-time validation fails loudly on malformed fixtures (wrong group sizes,
unknown team/venue references, a team not playing exactly 3 group games, or a
stadium double-booked on a day).

## Out of scope (v1)

Notifications/price alerts and price-history charts are intentionally deferred,
but the observation stream is designed so they layer on top later without schema
changes.
