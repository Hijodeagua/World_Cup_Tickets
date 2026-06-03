import type { HeadToHead } from "@/lib/predictions/headToHead";
import type { MarketOdds } from "@/lib/odds";
import type { Player } from "@/lib/rosters";

export interface MatchupTeam {
  name: string;
  flag: string;
  elo: number;
}

const pct = (v: number) => (v <= 0 ? "0%" : v < 0.005 ? "<1%" : `${Math.round(v * 100)}%`);

function ForecastBar({ a, b, h2h, odds }: { a: MatchupTeam; b: MatchupTeam; h2h: HeadToHead; odds: MarketOdds }) {
  const segs = [
    { k: "a", w: h2h.pWinA, cls: "win-a", label: `${a.name} win` },
    { k: "d", w: h2h.pDraw, cls: "draw", label: "Draw" },
    { k: "b", w: h2h.pWinB, cls: "win-b", label: `${b.name} win` },
  ];
  return (
    <div className="mu-forecast">
      <div className="mu-bar" role="img" aria-label={`${a.name} ${pct(h2h.pWinA)}, draw ${pct(h2h.pDraw)}, ${b.name} ${pct(h2h.pWinB)}`}>
        {segs.map((s) => (
          <div key={s.k} className={`mu-seg ${s.cls}`} style={{ width: `${Math.max(0, s.w * 100)}%` }} title={`${s.label} ${pct(s.w)}`} />
        ))}
      </div>
      <div className="mu-legend3">
        <div className="l a">
          <span className="v">{pct(h2h.pWinA)}</span>
          <span className="k">{a.name}</span>
        </div>
        <div className="l d">
          <span className="v">{pct(h2h.pDraw)}</span>
          <span className="k">Draw</span>
        </div>
        <div className="l b">
          <span className="v">{pct(h2h.pWinB)}</span>
          <span className="k">{b.name}</span>
        </div>
      </div>

      <div className="mu-stats">
        <div>
          <div className="n">
            {h2h.avgGoalsA.toFixed(1)} – {h2h.avgGoalsB.toFixed(1)}
          </div>
          <div className="l">Average scoreline</div>
        </div>
        <div>
          <div className="n">
            {h2h.fairOdds.a} / {h2h.fairOdds.draw} / {h2h.fairOdds.b}
          </div>
          <div className="l">Model fair odds (dec.)</div>
        </div>
        <div>
          <div className="n">{h2h.iterations.toLocaleString()}</div>
          <div className="l">Simulations</div>
        </div>
      </div>

      <div className="mu-market">
        {odds.available && odds.implied ? (
          <>
            <span className="tag">Market</span>
            <span>
              {a.name} {pct(odds.implied.home)} · Draw {pct(odds.implied.draw)} · {b.name} {pct(odds.implied.away)}
            </span>
            <span className="src">
              {odds.bookmakerCount} book{odds.bookmakerCount === 1 ? "" : "s"} · de-vigged · {odds.source}
            </span>
          </>
        ) : (
          <span className="src">Market lines unavailable ({odds.reason}). Showing model only.</span>
        )}
      </div>
    </div>
  );
}

function Scorelines({ h2h }: { h2h: HeadToHead }) {
  return (
    <div className="mu-scores">
      <div className="mu-sub">Ten most likely scorelines</div>
      <div className="mu-chips">
        {h2h.topScorelines.map((s, i) => (
          <span className="chip" key={i}>
            <b>
              {s.goalsA}–{s.goalsB}
            </b>
            <span className="cpct">{pct(s.pct)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function RosterTable({ team, players }: { team: MatchupTeam; players: Player[] }) {
  return (
    <div className="roster">
      <div className="roster-h">
        <span className="fl">{team.flag}</span>
        <span className="nm">{team.name}</span>
        <span className="ct">{players.length} players</span>
      </div>
      <table className="data roster-tbl">
        <thead>
          <tr>
            <th>Player</th>
            <th>Pos</th>
            <th>Club</th>
            <th className="num">Caps</th>
            <th className="num">G</th>
            <th className="num">A</th>
            <th className="num">Since</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.name}>
              <td>{p.name}</td>
              <td className="t-mut">{p.position}</td>
              <td>
                {p.club} <span className="t-mut">· {p.league}</span>
              </td>
              <td className="num">{p.caps}</td>
              <td className="num">{p.goals}</td>
              <td className="num">{p.assists}</td>
              <td className="num t-mut">{p.firstCapYear}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MatchupSection({
  a,
  b,
  h2h,
  odds,
  rosterA,
  rosterB,
}: {
  a: MatchupTeam;
  b: MatchupTeam;
  h2h: HeadToHead;
  odds: MarketOdds;
  rosterA: Player[] | null;
  rosterB: Player[] | null;
}) {
  return (
    <>
      <h2 className="section-h">Matchup forecast</h2>
      <div className="panel mu-panel">
        <div className="mu-head">
          <span>
            <span className="fl">{a.flag}</span> {a.name} <span className="t-mut">· Elo {a.elo}</span>
          </span>
          <span className="x">v</span>
          <span>
            <span className="fl">{b.flag}</span> {b.name} <span className="t-mut">· Elo {b.elo}</span>
          </span>
        </div>
        <ForecastBar a={a} b={b} h2h={h2h} odds={odds} />
        <Scorelines h2h={h2h} />
      </div>

      {(rosterA || rosterB) && (
        <>
          <h2 className="section-h">Rosters</h2>
          <div className="rosters-grid">
            {rosterA ? (
              <RosterTable team={a} players={rosterA} />
            ) : (
              <div className="roster empty-roster">No squad entered for {a.name} yet.</div>
            )}
            {rosterB ? (
              <RosterTable team={b} players={rosterB} />
            ) : (
              <div className="roster empty-roster">No squad entered for {b.name} yet.</div>
            )}
          </div>
        </>
      )}
    </>
  );
}
