import { prisma } from "@/lib/db";
import { computeStandings, type ResultInput } from "@/lib/predictions/standings";
import fixtures from "@/data/fixtures-2026.json";
import results2026 from "@/data/results-2026.json";

export const dynamic = "force-dynamic";

const fmtPct = (v: number) => (v <= 0 ? "—" : v < 0.01 ? "<1%" : `${Math.round(v * 100)}%`);

interface FixtureTeam {
  code: string;
  name: string;
  group: string;
  flag: string;
}
interface StoredResult {
  fifaMatchNo: number;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
}

export default async function GroupsPage() {
  // Standings come from the committed results file (the source of truth synced
  // from the Elo engine's dataset), so they reflect the latest results as soon
  // as it deploys — no dependency on the nightly cron having run. Projection
  // columns come from the stored Elo Monte Carlo (refreshed by the cron).
  const projections = await prisma.teamProjection.findMany();
  const proj = new Map(projections.map((p) => [p.code, p]));
  const iterations = projections[0]?.iterations ?? 0;

  const teams = fixtures.teams as FixtureTeam[];
  const meta = new Map(teams.map((t) => [t.code, t]));
  const teamsByGroup: Record<string, string[]> = {};
  for (const t of teams) (teamsByGroup[t.group] ??= []).push(t.code);

  // Map each played result to its group via fixture order (group matches are
  // seeded 1..72 in groupMatches order, so fifaMatchNo = index + 1).
  const groupMatches = fixtures.groupMatches as { group: string }[];
  const results = results2026.results as StoredResult[];
  const resultInputs: ResultInput[] = results.map((r) => ({
    group: groupMatches[r.fifaMatchNo - 1]?.group ?? null,
    homeCode: r.home,
    awayCode: r.away,
    homeScore: r.homeScore,
    awayScore: r.awayScore,
    status: "COMPLETED",
  }));
  const standings = computeStandings(resultInputs, teamsByGroup);

  const groups = Object.keys(standings).sort();
  const resultsByGroup = new Map<string, StoredResult[]>();
  for (const r of results) {
    const g = groupMatches[r.fifaMatchNo - 1]?.group;
    if (!g) continue;
    const arr = resultsByGroup.get(g) ?? [];
    arr.push(r);
    resultsByGroup.set(g, arr);
  }

  const name = (code: string) => meta.get(code)?.name ?? code;
  const flag = (code: string) => meta.get(code)?.flag ?? "🏳️";

  return (
    <>
      <section className="hero" style={{ borderBottom: "none", paddingBottom: 6 }}>
        <div className="kicker">Group stage · live standings &amp; Elo projections</div>
        <h1 className="display">The Groups</h1>
        <p>
          Twelve groups of four. Standings update from completed results; the <b>Win Grp</b> and <b>Advance</b>{" "}
          columns are Elo Monte Carlo projections
          {iterations ? <> ({iterations.toLocaleString()} simulations)</> : null}, recalculated after each result —
          played matches are fixed, the rest simulated. Top two of every group plus the eight best third-placed teams
          reach the round of 32.
        </p>
        <div className="meth">
          {results.length > 0 ? (
            <>{results.length} of 72 group matches played.</>
          ) : (
            <>No group matches played yet — standings show the pre-tournament field; projections are full simulations.</>
          )}{" "}
          Refreshed nightly (<code>/api/cron/predictions</code>).
        </div>
      </section>

      <div className="groups-wrap">
        {groups.map((g) => {
          const rows = standings[g];
          const played = resultsByGroup.get(g) ?? [];
          return (
            <section className="group-card" key={g}>
              <div className="group-h">
                <span className="gid">Group {g}</span>
                <span className="gmeta">{played.length}/6 played</span>
              </div>
              <table className="standings">
                <thead>
                  <tr>
                    <th className="l">Team</th>
                    <th>P</th>
                    <th>W</th>
                    <th>D</th>
                    <th>L</th>
                    <th>GF</th>
                    <th>GA</th>
                    <th>GD</th>
                    <th className="pts">Pts</th>
                    <th className="pcol">Win Grp</th>
                    <th className="pcol">Advance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const p = proj.get(r.code);
                    return (
                      <tr key={r.code} className={i < 2 ? "qual" : ""}>
                        <td className="l team-cell">
                          <span className="pos">{i + 1}</span>
                          <span className="fl">{flag(r.code)}</span>
                          <span className="nm">{name(r.code)}</span>
                        </td>
                        <td>{r.played}</td>
                        <td>{r.won}</td>
                        <td>{r.drawn}</td>
                        <td>{r.lost}</td>
                        <td>{r.gf}</td>
                        <td>{r.ga}</td>
                        <td>{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                        <td className="pts">{r.pts}</td>
                        <td className="pcol">{p ? fmtPct(p.pGroupWinner) : "—"}</td>
                        <td className="pcol">{p ? fmtPct(p.pQualify) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {played.length > 0 && (
                <div className="res-strip">
                  {played.map((m) => (
                    <span className="res" key={m.fifaMatchNo}>
                      <span className="rc">{m.home}</span>
                      <b>
                        {m.homeScore}–{m.awayScore}
                      </b>
                      <span className="rc">{m.away}</span>
                    </span>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <p className="meth" style={{ margin: "20px 0 0", maxWidth: 720 }}>
        Standings ranked by points, then goal difference, then goals for. Projection columns blend an online World
        Football Elo with the Can-Tre-Beat-Vegas international Elo engine (fresh-2006 start, tiered K-factors) as the
        model rating; a host boost applies to USA/MEX/CAN. A projection, not a prediction.
      </p>
      <div className="foot" />
    </>
  );
}
