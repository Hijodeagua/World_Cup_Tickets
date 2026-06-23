import { prisma } from "@/lib/db";
import { ensureMatchColumns } from "@/lib/ensure-schema";
import { computeStandings, type ResultInput } from "@/lib/predictions/standings";

export const dynamic = "force-dynamic";

const fmtPct = (v: number) => (v <= 0 ? "—" : v < 0.01 ? "<1%" : `${Math.round(v * 100)}%`);

export default async function GroupsPage() {
  await ensureMatchColumns(prisma);
  const [matches, teams, projections] = await Promise.all([
    prisma.match.findMany({
      where: { stage: "GROUP" },
      include: { homeTeam: true, awayTeam: true },
      orderBy: { kickoff: "asc" },
    }),
    prisma.team.findMany({ where: { group: { not: null } }, select: { code: true, name: true, flag: true, group: true } }),
    prisma.teamProjection.findMany(),
  ]);

  const meta = new Map(teams.map((t) => [t.code, t]));
  const proj = new Map(projections.map((p) => [p.code, p]));
  const iterations = projections[0]?.iterations ?? 0;

  // Teams per group (seeds standings so empty groups still show all four sides).
  const teamsByGroup: Record<string, string[]> = {};
  for (const t of teams) (teamsByGroup[t.group!] ??= []).push(t.code);

  const resultInputs: ResultInput[] = matches.map((m) => ({
    group: m.group,
    homeCode: m.homeTeam?.code ?? null,
    awayCode: m.awayTeam?.code ?? null,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    status: m.status,
  }));
  const standings = computeStandings(resultInputs, teamsByGroup);

  const completed = matches.filter((m) => m.status === "COMPLETED");
  const groups = Object.keys(standings).sort();

  // Completed results grouped, for the per-group results strip.
  const resultsByGroup = new Map<string, typeof matches>();
  for (const m of completed) {
    if (!m.group) continue;
    const arr = resultsByGroup.get(m.group) ?? [];
    arr.push(m);
    resultsByGroup.set(m.group, arr);
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
          played matches are fixed, the rest simulated. <b>Advance</b> shows each team&apos;s chance to reach the round
          of 32, with its tournament-start figure (<i>was&nbsp;X%</i>) in parentheses. Top two of every group plus the
          eight best third-placed teams reach the round of 32.
        </p>
        <div className="meth">
          {completed.length > 0 ? (
            <>{completed.length} of 72 group matches played.</>
          ) : (
            <>No group matches played yet — standings show the pre-tournament field; projections are full simulations.</>
          )}{" "}
          Refreshed nightly.
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
                        <td className="pcol">
                          {p ? fmtPct(p.pQualify) : "—"}
                          {p && p.baselinePQualify != null && (
                            <span className="was" title="Chance to advance at tournament start">
                              was {fmtPct(p.baselinePQualify)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {played.length > 0 && (
                <div className="res-strip">
                  {played.map((m) => (
                    <span className="res" key={m.id}>
                      <span className="rc">{m.homeTeam?.code ?? "?"}</span>
                      <b>
                        {m.homeScore}–{m.awayScore}
                      </b>
                      <span className="rc">{m.awayTeam?.code ?? "?"}</span>
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
