"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

export function SiteNav() {
  const path = usePathname();
  const cls = (href: string) =>
    href === "/" ? (path === "/" || path.startsWith("/matches") ? "active" : "") : path.startsWith(href) ? "active" : "";
  return (
    <nav className="top-nav">
      <Link href="/" className={cls("/")}>
        Matches
      </Link>
      <Link href="/groups" className={cls("/groups")}>
        Groups
      </Link>
      <Link href="/predictions" className={cls("/predictions")}>
        Projections
      </Link>
      <Link href="/accuracy" className={cls("/accuracy")}>
        Accuracy
      </Link>
    </nav>
  );
}

/* ---- shared game type passed from the server ---- */
export type Outcome = "A" | "DRAW" | "B";

export interface Team {
  code: string;
  n: string;
  f: string;
}

export interface GamePrediction {
  pWinA: number; // 0..1 home win
  pDraw: number;
  pWinB: number; // 0..1 away win
  eloA: number;
  eloB: number;
  frozen: boolean; // stored snapshot (locked the night before kickoff)
  live: boolean; // computed on the fly (no stored row yet)
  mostLikely: Outcome;
  // The side more likely to win outright, ignoring the draw.
  winner: { side: "A" | "B"; p: number };
  topScore: { goalsA: number; goalsB: number } | null;
}

export interface GameFixture {
  id: string;
  date: string; // YYYY-MM-DD (Eastern Time)
  time: string; // HH:MM (Eastern Time, 24h)
  a: Team;
  b: Team;
  group: string | null;
  stageLabel: string;
  stage: "group" | "knockout";
  venue: string;
  city: string;
  completed: boolean;
  homeScore: number | null;
  awayScore: number | null;
  pred: GamePrediction | null;
}

const pc = (v: number) => (v <= 0 ? "0%" : v < 0.005 ? "<1%" : `${Math.round(v * 100)}%`);

function outcomeLabel(o: Outcome, a: Team, b: Team): string {
  return o === "A" ? `${a.n} win` : o === "B" ? `${b.n} win` : "Draw";
}

function dayParts(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return {
    dd: String(d.getDate()),
    wd: d.toLocaleDateString("en-US", { weekday: "long" }),
    mo: d.toLocaleDateString("en-US", { month: "long" }),
  };
}

// Days between two YYYY-MM-DD keys (b - a), ignoring time/zone.
function dayDelta(a: string, b: string) {
  const da = new Date(a + "T12:00:00").getTime();
  const db = new Date(b + "T12:00:00").getTime();
  return Math.round((db - da) / 86400000);
}

function timeParts(t: string) {
  let [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return { h: `${h}:${String(m).padStart(2, "0")}`, ap };
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/* ---- a single 3-column game card ---- */
function GameCard({ fx, q }: { fx: GameFixture; q: string }) {
  const t = timeParts(fx.time);
  const { a, b, pred } = fx;

  // Actual + grade, for completed games.
  const actual: Outcome | null =
    fx.completed && fx.homeScore != null && fx.awayScore != null
      ? fx.homeScore > fx.awayScore
        ? "A"
        : fx.homeScore < fx.awayScore
          ? "B"
          : "DRAW"
      : null;
  const correct = pred && actual ? pred.mostLikely === actual : null;

  const winnerTeam = pred ? (pred.winner.side === "A" ? a : b) : null;

  return (
    <Link className="gcard" href={`/matches/${fx.id}`}>
      {/* Left: matchup / game info */}
      <div className="gc-info">
        <div className="gc-teams">
          <span className="tm">
            <span className="flag">{a.f}</span>
            <span className="nm">
              <Highlight text={a.n} q={q} />
            </span>
            {actual && <span className={`sc ${actual === "A" ? "w" : ""}`}>{fx.homeScore}</span>}
          </span>
          <span className="x">v</span>
          <span className="tm">
            <span className="flag">{b.f}</span>
            <span className="nm">
              <Highlight text={b.n} q={q} />
            </span>
            {actual && <span className={`sc ${actual === "B" ? "w" : ""}`}>{fx.awayScore}</span>}
          </span>
        </div>
        <div className="gc-meta">
          <span className="grp">{fx.group ? `Group ${fx.group}` : fx.stageLabel}</span>
          <span className="dot">·</span>
          <span className="tt">
            {t.h}
            <span className="ap">{t.ap}</span>
          </span>
          <span className="dot">·</span>
          <span>
            <Highlight text={fx.city} q={q} />
          </span>
        </div>
      </div>

      {/* Middle: most likely outcome + simulation breakdown */}
      <div className="gc-outcome">
        {pred ? (
          <>
            <div className="gc-cap">Most likely outcome</div>
            <div className="gc-headline">{outcomeLabel(pred.mostLikely, a, b)}</div>
            <div className="gc-bar" role="img" aria-label={`${a.n} ${pc(pred.pWinA)}, draw ${pc(pred.pDraw)}, ${b.n} ${pc(pred.pWinB)}`}>
              <span className="seg win-a" style={{ width: `${pred.pWinA * 100}%` }} />
              <span className="seg draw" style={{ width: `${pred.pDraw * 100}%` }} />
              <span className="seg win-b" style={{ width: `${pred.pWinB * 100}%` }} />
            </div>
            <div className="gc-split">
              <span className={pred.mostLikely === "A" ? "on" : ""}>
                {a.code} {pc(pred.pWinA)}
              </span>
              <span className={pred.mostLikely === "DRAW" ? "on" : ""}>Draw {pc(pred.pDraw)}</span>
              <span className={pred.mostLikely === "B" ? "on" : ""}>
                {b.code} {pc(pred.pWinB)}
              </span>
            </div>
          </>
        ) : (
          <div className="gc-tbd">Teams to be decided</div>
        )}
      </div>

      {/* Right: most likely score */}
      <div className="gc-winner">
        {pred && winnerTeam ? (
          <>
            <div className="gc-cap">Most likely score</div>
            <div className="gc-win-team">
              <span className="flag">{winnerTeam.f}</span>
              <span className="nm">{winnerTeam.n}</span>
            </div>
            {pred.topScore ? (
              <div className="gc-win-pct">
                {pred.topScore.goalsA}–{pred.topScore.goalsB}
                <span className="lab">most common result</span>
              </div>
            ) : (
              <div className="gc-win-pct">
                {pc(pred.winner.p)}
                <span className="lab">to win</span>
              </div>
            )}
            {actual && (
              <div className={`gc-grade ${correct ? "ok" : "miss"}`}>{correct ? "✓ Correct" : "✗ Missed"}</div>
            )}
            {!actual && pred.frozen && <div className="gc-lock">Locked</div>}
          </>
        ) : (
          <div className="gc-tbd">—</div>
        )}
      </div>
    </Link>
  );
}

/* ---- the home page board: date sections of game cards ---- */
type View = "upcoming" | "past" | "all";

export function MatchBoard({ fixtures, todayKey }: { fixtures: GameFixture[]; todayKey: string }) {
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("upcoming");
  const [stage, setStage] = useState<"all" | "group" | "knockout">("all");

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return fixtures.filter((fx) => {
      const past = fx.date < todayKey;
      if (view === "upcoming" && past) return false;
      if (view === "past" && !past) return false;
      if (stage !== "all" && fx.stage !== stage) return false;
      if (qq) {
        const hay = `${fx.a.n} ${fx.b.n} ${fx.city} ${fx.venue}`.toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }, [fixtures, q, view, stage, todayKey]);

  const days = useMemo(() => {
    const byDay: Record<string, GameFixture[]> = {};
    for (const fx of list) (byDay[fx.date] ??= []).push(fx);
    const keys = Object.keys(byDay).sort();
    // Past view reads newest-first (navigating backward through history);
    // upcoming / all read soonest-first.
    if (view === "past") keys.reverse();
    return keys.map((key) => ({
      key,
      items: byDay[key].slice().sort((a, b) => a.time.localeCompare(b.time)),
    }));
  }, [list, view]);

  const vtab = (id: View, label: string) => (
    <button key={id} className={view === id ? "on" : ""} onClick={() => setView(id)}>
      {label}
    </button>
  );
  const stab = (id: "all" | "group" | "knockout", label: string) => (
    <button key={id} className={stage === id ? "on" : ""} onClick={() => setStage(id)}>
      {label}
    </button>
  );

  function sectionLabel(key: string) {
    const delta = dayDelta(todayKey, key);
    if (delta === 0) return { lead: "Today", sub: dayParts(key).wd };
    if (delta === 1) return { lead: "Tomorrow", sub: dayParts(key).wd };
    if (delta === -1) return { lead: "Yesterday", sub: dayParts(key).wd };
    const d = dayParts(key);
    return { lead: d.wd, sub: `${d.mo} ${d.dd}` };
  }

  return (
    <>
      <div className="toolbar">
        <div className="tb-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a team or host city…"
            autoComplete="off"
          />
        </div>
        <div className="tb-tabs">
          {vtab("upcoming", "Upcoming")}
          {vtab("past", "Past results")}
          {vtab("all", "All")}
        </div>
        <div className="tb-tabs">
          {stab("all", "All")}
          {stab("group", "Group")}
          {stab("knockout", "Knockout")}
        </div>
      </div>

      <div>
        {days.length === 0 ? (
          <div className="empty">
            <div className="e1">No matches found</div>
            <div className="e2">
              {view === "past"
                ? "No completed or past-dated matches match this filter yet."
                : view === "upcoming"
                  ? "No upcoming matches match this filter — try Past results."
                  : "Try a different team, city, or filter."}
            </div>
          </div>
        ) : (
          days.map(({ key, items }) => {
            const s = sectionLabel(key);
            const played = items.filter((i) => i.completed).length;
            return (
              <div key={key}>
                <div className="gday">
                  <div className="gd-lead">{s.lead}</div>
                  <div className="gd-sub">{s.sub}</div>
                  <div className="gd-cnt">
                    {played > 0 && view !== "upcoming" ? `${played}/${items.length} played` : `${items.length} ${items.length === 1 ? "game" : "games"}`}
                  </div>
                </div>
                <div className="gcards">
                  {items.map((fx) => (
                    <GameCard key={fx.id} fx={fx} q={q} />
                  ))}
                </div>
              </div>
            );
          })
        )}
        <div className="foot" />
      </div>
    </>
  );
}

/* ---- projections heat table (sortable) ---- */
export interface ProjRow {
  fl: string;
  nm: string;
  g: string;
  e: number;
  c: number[]; // [WinGrp, Advance, R16, QF, SF, Final, Champion]
}

const fmtPct = (v: number) => (v <= 0 ? "—" : v < 1 ? "<1%" : `${Math.round(v)}%`);

export function ProjectionsTable({ rows, cols }: { rows: ProjRow[]; cols: string[] }) {
  const [sortKey, setSortKey] = useState("c6");
  const [sortDir, setSortDir] = useState(-1);
  const maxC = useMemo(() => Math.max(...rows.map((d) => d.c[6]), 1), [rows]);

  const val = (d: ProjRow, k: string): number | string => {
    if (k === "nm") return d.nm;
    if (k === "g") return d.g;
    if (k === "e") return d.e;
    return d.c[+k.slice(1)];
  };

  const sorted = useMemo(() => {
    return rows.slice().sort((a, b) => {
      const va = val(a, sortKey);
      const vb = val(b, sortKey);
      if (typeof va === "string") return sortDir * va.localeCompare(vb as string);
      return sortDir * ((va as number) - (vb as number));
    });
  }, [rows, sortKey, sortDir]);

  const onSort = (k: string) => {
    if (k === sortKey) setSortDir((d) => d * -1);
    else {
      setSortKey(k);
      setSortDir(k === "nm" ? 1 : -1);
    }
  };

  const tint = (v: number) => `rgba(227,183,101,${(Math.pow(v / 100, 0.85) * 0.26).toFixed(3)})`;
  const txtcol = (v: number) => (v >= 60 ? "#f3e4c4" : v >= 25 ? "#d8cfbf" : "var(--mut)");

  const th = (k: string, label: string) => (
    <th key={k} className={k === sortKey ? "sorted" : ""} onClick={() => onSort(k)}>
      {label}
      <span className="ar">{k === sortKey ? (sortDir < 0 ? "▼" : "▲") : ""}</span>
    </th>
  );

  return (
    <table className="proj">
      <thead>
        <tr>
          <th className="l">#</th>
          <th className="l">Team</th>
          {th("g", "Grp")}
          {th("e", "Elo")}
          {cols.map((c, i) => th(`c${i}`, c))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((d, idx) => (
          <tr key={d.nm}>
            <td className="rk">{idx + 1}</td>
            <td className="team">
              <div className="tw">
                <span className="fl">{d.fl}</span>
                <span className="nm">{d.nm}</span>
              </div>
            </td>
            <td className="grp">{d.g}</td>
            <td className="elo">{d.e}</td>
            {d.c.map((v, i) =>
              i === 6 ? (
                <td key={i} className="cell champ">
                  <div className="fillbar" style={{ width: `${Math.max(4, (v / maxC) * 100)}%` }} />
                  <span className="v">{fmtPct(v)}</span>
                </td>
              ) : (
                <td key={i} className="cell" style={{ background: tint(v) }}>
                  <span className="v" style={{ color: txtcol(v) }}>
                    {fmtPct(v)}
                  </span>
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
