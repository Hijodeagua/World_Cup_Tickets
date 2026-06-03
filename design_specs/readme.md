# World Cup 2026 — Tickets & Projections (editorial direction)

Static, dependency-free scaffold. Two pages share one stylesheet and one data file.
Fonts load from Google Fonts (Newsreader + Archivo); everything else is local.

## Files
```
site/
  index.html        Matches — date-grouped ledger with live search / filters
  projections.html  Title odds — favorite card, title-odds chart, sortable heat-map
  styles.css        Shared design system (gold + serif). CSS variables at :root
  data.js           ALL content lives here → window.WC + window.WCfmt helpers
```

## How it works
- Both pages read from `window.WC` defined in `data.js`. No build step, no framework.
- `data.js` is the single source of truth — update fixtures, prices, and projection
  numbers there and both pages re-render on load. Field docs are inline at the top.
- Matches: search box, stage tabs (All / Group / Knockout), and an "on sale only"
  toggle all filter live and re-group by day. Empty states handled.
- Projections: click any column header to sort. Heat-cell opacity encodes probability;
  the Champion column also draws an inline bar. Favorite card + title-odds chart are
  derived from the data, not hardcoded.

## Intentionally left as bones (good first PRs for Claude Code)
- **Data is a 6-fixture / 11-team placeholder sample.** Wire `data.js` to the real
  feed (104 fixtures, 48 teams). The render code already scales to any length.
- **"Notify me" / "Track price" buttons** are inert — no handler yet.
- **"Source health" nav link** points to `#` — page not built.
- **No match-detail or knockout-bracket view** — nav + data model leave room for both.
- **No responsive breakpoints below ~720px** — layout is desktop-first.
- Times render in a fixed local format; no timezone switcher.
