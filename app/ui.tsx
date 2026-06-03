"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";

export function SiteNav() {
  const path = usePathname();
  const cls = (href: string) =>
    href === "/" ? (path === "/" || path.startsWith("/matches") ? "active" : "") : path.startsWith(href) ? "active" : "";
  return (
    <nav className="top-nav">
      <a href="/" className={cls("/")}>
        Matches
      </a>
      <a href="/predictions" className={cls("/predictions")}>
        Projections
      </a>
      <a href="/admin/health" className={cls("/admin/health")}>
        Source health
      </a>
    </nav>
  );
}

/* ---- shared fixture type passed from the server ---- */
export interface Fixture {
  id: string;
  date: string; // YYYY-MM-DD (Eastern Time)
  time: string; // HH:MM (Eastern Time, 24h)
  a: { n: string; f: string };
  b: { n: string; f: string };
  group: string | null;
  stageLabel: string;
  stage: "group" | "knockout";
  venue: string;
  city: string;
  status: "available" | "limited" | "soldout" | "unk";
  price: number | null;
  stale: boolean;
  provisional: boolean;
}

const STATUS_LABEL: Record<Fixture["status"], string> = {
  available: "Available",
  limited: "Limited",
  soldout: "Sold out",
  unk: "Not yet on sale",
};

function dayParts(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return {
    dd: String(d.getDate()),
    wd: d.toLocaleDateString("en-US", { weekday: "long" }),
    mo: d.toLocaleDateString("en-US", { month: "long" }),
  };
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

function Row({ fx, q }: { fx: Fixture; q: string }) {
  const t = timeParts(fx.time);
  return (
    <a className="row" href={`/matches/${fx.id}`}>
      <div className="tcol">
        {t.h}
        <span className="ampm">{t.ap}</span>
      </div>
      <div className="match">
        <div className="teams">
          <span className="tm">
            <span className="flag">{fx.a.f}</span>
            <span className="nm">
              <Highlight text={fx.a.n} q={q} />
            </span>
          </span>
          <span className="x">v</span>
          <span className="tm">
            <span className="flag">{fx.b.f}</span>
            <span className="nm">
              <Highlight text={fx.b.n} q={q} />
            </span>
          </span>
        </div>
        <div className="submeta">
          <span className="grp">{fx.group ? `Group ${fx.group}` : fx.stageLabel}</span>
          <span className="dot">·</span>
          <span>
            <Highlight text={fx.venue} q={q} />, <Highlight text={fx.city} q={q} />
          </span>
          {fx.provisional && <span className="prov">· provisional</span>}
        </div>
      </div>
      <div className="pricecol">
        {fx.status === "unk" || fx.price == null ? (
          <>
            <div className={`status ${fx.status}`}>{STATUS_LABEL[fx.status]}</div>
            <div className="none">—</div>
            {fx.status === "unk" && (
              <button
                className="notify"
                onClick={(e) => {
                  e.preventDefault();
                }}
              >
                Notify me
              </button>
            )}
          </>
        ) : (
          <>
            <div className={`status ${fx.status}`}>
              {STATUS_LABEL[fx.status]}
              {fx.stale && <span className="stale"> · stale</span>}
            </div>
            <div className="amt">
              <small>from</small>${fx.price}
            </div>
          </>
        )}
      </div>
    </a>
  );
}

export function MatchLedger({ fixtures }: { fixtures: Fixture[] }) {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<"all" | "group" | "knockout">("all");
  const [availOnly, setAvailOnly] = useState(false);

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return fixtures.filter((fx) => {
      if (availOnly && (fx.status === "unk" || fx.status === "soldout")) return false;
      if (stage !== "all" && fx.stage !== stage) return false;
      if (qq) {
        const hay = `${fx.a.n} ${fx.b.n} ${fx.city} ${fx.venue}`.toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }, [fixtures, q, stage, availOnly]);

  const days = useMemo(() => {
    const byDay: Record<string, Fixture[]> = {};
    for (const fx of list) (byDay[fx.date] ??= []).push(fx);
    return Object.keys(byDay)
      .sort()
      .map((key) => ({ key, items: byDay[key].slice().sort((a, b) => a.time.localeCompare(b.time)) }));
  }, [list]);

  const tab = (id: "all" | "group" | "knockout", label: string) => (
    <button className={stage === id ? "on" : ""} onClick={() => setStage(id)}>
      {label}
    </button>
  );

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
          {tab("all", "All")}
          {tab("group", "Group")}
          {tab("knockout", "Knockout")}
        </div>
        <button
          className={`tb-avail${availOnly ? " on" : ""}`}
          aria-pressed={availOnly}
          onClick={() => setAvailOnly((v) => !v)}
        >
          <span className="sw" />
          On sale only
        </button>
      </div>

      <div>
        {days.length === 0 ? (
          <div className="empty">
            <div className="e1">No matches found</div>
            <div className="e2">
              {stage === "knockout"
                ? "Knockout fixtures are set once the group stage concludes."
                : "Try a different team, city, or filter."}
            </div>
          </div>
        ) : (
          days.map(({ key, items }) => {
            const d = dayParts(key);
            return (
              <div key={key}>
                <div className="day">
                  <div className="num">{d.dd}</div>
                  <div className="wd">
                    <span className="a">{d.wd}</span>
                    <span className="b">{d.mo}</span>
                  </div>
                  <div className="cnt">
                    {items.length} {items.length === 1 ? "fixture" : "fixtures"}
                  </div>
                </div>
                {items.map((fx) => (
                  <Row key={fx.id} fx={fx} q={q} />
                ))}
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
