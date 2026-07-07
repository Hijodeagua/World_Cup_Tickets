# World Cup 2026 — Match Predictions

A website that predicts every FIFA World Cup 2026 match with an Elo Monte Carlo
model and grades those predictions against the real results.

## Why it's built this way

The model makes a call for every fixture — most likely outcome (win / draw /
loss) plus the full simulation split. To grade it honestly, a prediction is
**frozen the night before kickoff** and never recomputed once the game has been
played: data refreshes can update *upcoming* games but can't rewrite history.
That frozen snapshot is what the Accuracy page scores, so the grade reflects the
prediction the model actually made beforehand — no hindsight.

## Stack

- **Next.js 15** (App Router) + TypeScript + Tailwind CSS v4
- **Prisma** ORM — Postgres in every environment (local and production)
- **Vercel Cron** for the nightly results + predictions refresh

## Data model (`prisma/schema.prisma`)

- `Team`, `Venue`, `Match` — the schedule (104 matches, 16 host stadiums).
  `Match` also carries the result (`status`, `homeScore`, `awayScore`) once
  played, which drives the group standings and conditions the projections.
  Knockout rows additionally carry `winnerCode` — the side that advanced —
  because a drawn knockout game is decided on penalties, which the score
  can't express; this is what advances the bracket.
- `MatchPrediction` — the per-match win/draw/loss split (`pWinA`/`pDraw`/`pWinB`,
  blended Elo, iteration count). `frozen` is set the night before kickoff; a
  frozen row is **never recomputed**, preserving the pre-game prediction for
  grading on `/accuracy`.
- `TeamProjection` — per-team Elo Monte Carlo tournament odds (win group,
  advance, reach each round, champion). `baselinePQualify` snapshots the
  pre-tournament advance odds once and never overwrites them, so the groups page
  can show how a team's chances have moved since kickoff ("was X%").
- `Player` — auto-pulled squads (Wikipedia) with a manual override layer.

Outside models for the **Compare** page (`/compare`) live in
`data/external-models.json` (not the database): published World Cup 2026
**per-match** projections — win/draw/loss split and projected score — keyed by
`HOME-AWAY` team code. Currently Michael Caley's **PADDLIN'** (the loader
supports adding more). The outlets are subscriber-gated, so the values are
transcribed by hand (see the source URL in the file); every match/model is
optional and missing data degrades to a dash. Our own model is labelled the
**Fyfa_Rat Model** in those comparisons.

## Pages

- `/` — the match board: every fixture as a 3-column game card — matchup/info,
  **most likely outcome** with the simulation split, and the **most likely
  winner** with win probability — grouped under date headers. Starts at today and
  shows upcoming games forward; switch to **Past results** to navigate back
  through completed games (each graded ✓/✗ against the frozen call).
- `/groups` — the twelve groups: live standings (P/W/D/L, GF/GA/GD, points)
  computed from completed results, alongside the Elo **Win Grp** / **Advance**
  projections for each team (Advance shows the tournament-start figure in
  parentheses). Projections are recalculated after every result — played matches
  are fixed, the rest simulated (see below). Played results are read from the
  completed `Match` rows in the database (the same source as the standings), so
  the two never disagree.
- `/bracket` — the real knockout bracket, round of 32 through the final:
  every slot fills in with the actual teams as results land (updated by the
  nightly refresh), winners advance, drawn games show who went through on
  penalties, and upcoming ties carry the model's call. Slots the feed hasn't
  announced yet render their lineage label ("Winner Match 97").
- `/matches/[id]` — match detail with the final score (once played) and a
  **matchup view**: an Elo head-to-head forecast (win/draw/loss + average
  scoreline + the ten most likely scorelines), optional market lines, and both
  teams' rosters. Shown only when both teams are known.
- `/predictions` — Elo Monte Carlo title projections (see below).
- `/accuracy` — grades the model game by game: predicted outcome, actual result,
  ✓/✗, and a running accuracy score, with aggregate stats (overall %, accuracy by
  predicted outcome type, and a running-accuracy trend over time).
- `/compare` — model vs model: puts the **Fyfa_Rat Model** next to an outside
  model (PADDLIN') on every fixture both have called — win/draw/loss split,
  projected score, whether the two agree, and (once played) which got it right,
  plus summary hit-rates. Reads `data/external-models.json`.
- `/api/cron/predictions` — applies the latest results to `Match` rows,
  advances the knockout bracket (actual teams, scores, shootout winners, plus
  later-round slots via the bracket lineage), recomputes the Elo projections,
  and refreshes/freezes per-match predictions (Bearer `CRON_SECRET`).
- `/api/cron/rosters` — weekly squad pull (Bearer `CRON_SECRET`).

## Per-match predictions (`lib/predictions/matchPredictions.ts`)

Each fixture's win/draw/loss split comes from the same Elo + Poisson head-to-head
engine as the matchup view. Upcoming games are computed **live** from the current
ratings; the nightly cron snapshots and **freezes** each prediction once it is
within 24h of kickoff (or already played), so the frozen value is exactly what
the model said the night before. `/accuracy` grades the frozen call against the
result.

## Title projections (`lib/predictions/`)

A Monte Carlo simulation (default 100,000 tournaments) estimates each team's odds
to win its group, advance, and lift the trophy. (Monte Carlo error falls as
1/√N, so ~100k keeps champion odds stable to a few tenths of a percent while
finishing in a few seconds — well inside the cron's 120s budget; beyond ~250k the
precision gain isn't worth the time.)

- `data/elo-ratings.json` — strength snapshot blending an online World Football
  Elo (`eloOnline`, hand-maintained) and the model rating (`eloModel`); blend
  weight in `lib/predictions/elo.ts`. **`eloModel` is not hand-edited** — it is
  the Can-Tre-Beat-Vegas international Elo engine's output, synced in by
  `npm run sync-elo` (see "Elo ratings source" below).
- `elo.ts` — Poisson goals model driven by Elo difference (host boost for the
  three host nations); yields W/D/L and goal differences for tiebreakers.
- `simulate.ts` — simulates the real group fixtures, ranks with tiebreakers,
  qualifies 12 winners + 12 runners-up + 8 best thirds, then runs the knockout
  as single elimination. **Already-played matches
  (`data/results-2026.json`) are fixed, not simulated**, so projections
  condition on real results — and **once the real round of 32 is set, the
  simulation runs the actual bracket** (`lib/bracket.ts` +
  `data/bracket-2026.json`): played knockout games are fixed to their real
  winner (shootouts included via `winnerCode`), unplayed ties are simulated,
  and undecided slots chain through the official lineage. Before the group
  stage is done, the bracket falls back to Elo seeding.
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
- `npm run sync-results` reads WC-2026 scores from that repo's
  `soccer/data/results.csv` (plus `shootouts.csv` for drawn knockout games) and
  writes `data/results-2026.json` — group results and knockout rows alike.

Caveat: **before** the group stage is decided, the simulated knockout bracket
is **Elo-seeded**, not FIFA's exact slot/third-place table. Once the real round
of 32 exists, the simulation and the `/bracket` page follow the actual bracket.

## Knockout bracket (`lib/bracket.ts`, `data/bracket-2026.json`)

The bracket advances nightly from two sources:

1. **The results feed** is ground truth for who occupies each slot: a knockout
   row appears with its actual teams as soon as the pairing is set ("NA"
   scores until played), and completed games carry the score plus — for draws
   — the shootout winner from `shootouts.csv`. Feed rows are matched to
   fixtures 73–104 by stadium (feed city → venue, tolerant of the feed's
   loose city naming) and date (±1 day).
2. **The bracket lineage** (`data/bracket-2026.json`, from the official FIFA
   match schedule) says which matches feed each round-of-16-onward slot, so
   winners advance into next-round slots the feed hasn't announced yet, and
   empty slots get a label ("Winner Match 97"). Round-of-32 slots are not
   modeled from the group tables (FIFA's third-place allocation depends on
   which eight thirds qualify) — they come from the feed.

`applyKnockoutsToDb` writes the resolved bracket onto the `Match` rows —
teams, scores, `winnerCode` — so the match board, the `/bracket` page, the
projections and the per-match predictions (knockout games get a frozen
prediction as soon as their teams are known) all follow the real tournament.
It only ever fills slots, never clears them, so a feed hiccup can't blank out
the bracket.

## Matchup view (`lib/predictions/headToHead.ts`, `lib/odds/`, `lib/rosters.ts`)

The per-match page runs the same Elo + Poisson engine as the title projections
on just the two teams:

- `headToHead.ts` — derives win/draw/loss and the average scoreline from a large
  run (default 50,000) for stable percentages, while surfacing the **ten most
  likely exact scorelines** for human-readable texture. Deterministic per
  matchup (seeded from the two Elos). Host nations get the same home boost as the
  tournament sim.
- `lib/odds/` — a **pluggable, env-gated odds source** (The Odds API): with
  `THE_ODDS_API_KEY` set it fetches h2h lines,
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
cp .env.example .env          # set DATABASE_URL (Postgres) + CRON_SECRET
npm run db:push               # create the schema in your Postgres database
npm run db:seed               # seed schedule, results, projections + predictions
npm run dev                   # http://localhost:3000
```

Trigger the nightly predictions refresh manually:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/worldcup/api/cron/predictions
```

## Production (Vercel)

1. Set `DATABASE_URL` to your production Postgres connection string. The
   datasource `provider` is already `postgresql`, so no schema change is needed.
2. Set `CRON_SECRET`. `vercel.json` schedules two crons: a weekly roster pull and
   a **nightly predictions refresh** (`/api/cron/predictions`, 08:00 UTC) that
   applies new results, recomputes projections, and freezes per-match predictions
   inside the kickoff window.

## Nightly Elo + projections refresh

Keeping the groups page and projections current is a nightly pipeline:

1. **GitHub Actions** (`.github/workflows/nightly-elo.yml`, 07:00 UTC) checks
   out `main` and Can-Tre-Beat-Vegas, runs the Python Elo engine
   (`fetch_results` → `export_ratings`) to **recalculate ratings from
   newly-played games**, then `npm run sync-elo` + `npm run sync-results` and
   commits the refreshed `data/elo-ratings.json` and `data/results-2026.json`
   back to `main`. (No extra secrets: Can-Tre-Beat-Vegas is public, so the
   default `GITHUB_TOKEN` checks it out.)
2. **Vercel Cron** (`/api/cron/predictions`, 08:00 UTC) then writes the results
   onto `Match` rows (driving the standings), **advances the knockout bracket**
   (teams, scores and shootout winners onto matches 73–104, later rounds filled
   from the winners via the lineage), and recomputes the Elo Monte Carlo
   projections — conditioned on the results and, once the round of 32 is set,
   on the **real bracket**. This runs **every night regardless** of whether a
   new result landed. For the results it pulls the **live** feed directly
   (`RESULTS_CSV_URL` + `SHOOTOUTS_CSV_URL`, default martj42), so a new game is
   reflected the next night even if step 1's commit hasn't landed; the
   committed `data/results-2026.json` is the offline fallback.

To run the whole chain locally (with Can-Tre-Beat-Vegas checked out alongside):

```bash
(cd ../Can-Tre-Beat-Vegas && python -m soccer.model.export_ratings)
npm run sync-elo && npm run sync-results
npm run predict        # recompute projections from the synced data
```

> **Schema note:** `status`/`homeScore`/`awayScore`/`winnerCode` on `Match` and
> the `MatchPrediction` table are applied automatically at runtime —
> `lib/ensure-schema.ts` runs idempotent `ADD COLUMN IF NOT EXISTS` /
> `CREATE TABLE IF NOT EXISTS` (memoized, once per server instance) before any
> read, so no build-time DB access or manual migration is needed. `npm run
> db:push` still applies them up front for a local DB.

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

Calibration plots (predicted vs. observed frequency) and per-confidence-bucket
accuracy are deferred; the frozen `MatchPrediction` rows carry the probabilities
needed to add them later without schema changes.
