import { prisma } from "@/lib/db";
import { ensureMatchColumns } from "@/lib/ensure-schema";
import { formatKickoff } from "@/lib/format";
import { actualOutcome, mostLikelyOutcome, resolvePrediction, type Outcome } from "@/lib/predictions/matchPredictions";
import { simulateHeadToHead } from "@/lib/predictions/headToHead";
import { MODEL_KEYS, externalMatch, externalPick, hasAnyExternal, modelMeta } from "@/lib/predictions/externalModels";

export const dynamic = "force-dynamic";

// Single external model for now (PADDLIN'); the file/loader already support more.
const KEY = MODEL_KEYS[0];

const pct = (v: number) => `${Math.round(v)}%`;
const score1 = (n: number) => n.toFixed(1);
const outcomeText = (o: Outcome, a: string, b: string) => (o === "A" ? a : o === "B" ? b : "Draw");

export default async function ComparePage() {
  await ensureMatchColumns(prisma);
  const meta = KEY ? modelMeta(KEY) : null;

  const [matches, stored] = await Promise.all([
    prisma.match.findMany({
      where: { homeTeamId: { not: null }, awayTeamId: { not: null } },
      include: { homeTeam: true, awayTeam: true },
      orderBy: { kickoff: "asc" },
    }),
    prisma.matchPrediction.findMany(),
  ]);
  const predMap = new Map(stored.map((p) => [p.matchId, p]));

  interface Row {
    id: string;
    kickoff: Date;
    a: string;
    b: string;
    fa: string;
    fb: string;
    completed: boolean;
    homeScore: number | null;
    awayScore: number | null;
    actual: Outcome | null;
    // Our model.
    our: { wdl: [number, number, number]; pick: Outcome; proj: [number, number] };
    // External model.
    ext: { wdl: [number, number, number]; pick: Outcome; proj: [number, number] };
    agree: boolean;
  }

  const rows: Row[] = [];
  // Tallies for the summary band.
  let agreeCount = 0;
  let gradedTotal = 0;
  let ourCorrect = 0;
  let extCorrect = 0;

  for (const m of matches) {
    const ha = m.homeTeam?.code;
    const aw = m.awayTeam?.code;
    if (!KEY || !hasAnyExternal(ha, aw)) continue;
    const rp = resolvePrediction(predMap.get(m.id), ha, aw);
    const ext = externalMatch(ha, aw, KEY);
    const ep = externalPick(ha, aw, KEY);
    if (!rp || !ext || !ep) continue;

    // Our projected score = average goals from the same Elo + Poisson engine.
    const h2h = simulateHeadToHead({ eloA: rp.eloA, eloB: rp.eloB, codeA: ha, codeB: aw });
    const ourPick = mostLikelyOutcome(rp);
    const completed = m.status === "COMPLETED" && m.homeScore != null && m.awayScore != null;
    const actual = completed ? actualOutcome(m.homeScore!, m.awayScore!) : null;
    const agree = ourPick === ep.outcome;
    if (agree) agreeCount++;
    if (actual) {
      gradedTotal++;
      if (ourPick === actual) ourCorrect++;
      if (ep.outcome === actual) extCorrect++;
    }

    rows.push({
      id: m.id,
      kickoff: m.kickoff,
      a: m.homeTeam?.name ?? "TBD",
      b: m.awayTeam?.name ?? "TBD",
      fa: m.homeTeam?.flag ?? "🏳️",
      fb: m.awayTeam?.flag ?? "🏳️",
      completed,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      actual,
      our: { wdl: [rp.pWinA * 100, rp.pDraw * 100, rp.pWinB * 100], pick: ourPick, proj: [h2h.avgGoalsA, h2h.avgGoalsB] },
      ext: { wdl: [ext.pHome, ext.pDraw, ext.pAway], pick: ep.outcome, proj: [ext.projHome, ext.projAway] },
      agree,
    });
  }

  const total = rows.length;
  const agreePct = total ? (agreeCount / total) * 100 : 0;

  const modelCell = (r: Row, side: "our" | "ext") => {
    const d = r[side];
    const pickClass = r.actual ? (d.pick === r.actual ? "t-ok" : "t-bad") : "";
    return (
      <td className="cmp-cell">
        <div className={`cmp-pick ${pickClass}`}>
          {outcomeText(d.pick, r.a, r.b)}
          {r.actual && <span className="cmp-mark"> {d.pick === r.actual ? "✓" : "✗"}</span>}
        </div>
        <div className="cmp-wdl">
          {pct(d.wdl[0])} <span className="sep">/</span> {pct(d.wdl[1])} <span className="sep">/</span> {pct(d.wdl[2])}
        </div>
        <div className="cmp-proj">
          {score1(d.proj[0])}–{score1(d.proj[1])}
        </div>
      </td>
    );
  };

  return (
    <>
      <section className="hero" style={{ borderBottom: "none", paddingBottom: 6 }}>
        <div className="kicker">Model vs model · our call against the field</div>
        <h1 className="display">Compare</h1>
        <p>
          How the <b>Fyfa_Rat Model</b> stacks up against {meta ? <b>{meta.name}</b> : "an outside model"}
          {meta ? <> ({meta.author})</> : null} on every fixture both have called: the win / draw / loss split (H / D /
          A), each model&apos;s projected score, and — once a game is played — who got it right. A projection, not a
          prediction.
        </p>
      </section>

      {total === 0 ? (
        <div className="empty">
          <div className="e1">No matchups to compare yet</div>
          <div className="e2">
            Add a model&apos;s per-match projections to <code>data/external-models.json</code> and they&apos;ll line up
            here against ours.
          </div>
        </div>
      ) : (
        <>
          <div className="cmp-summary">
            <div className="cmp-stat">
              <div className="n">{pct(agreePct)}</div>
              <div className="l">Picks agree</div>
              <div className="s">
                {agreeCount} of {total} fixtures
              </div>
            </div>
            <div className="cmp-stat">
              <div className="n">{gradedTotal ? pct((ourCorrect / gradedTotal) * 100) : "—"}</div>
              <div className="l">Fyfa_Rat Model</div>
              <div className="s">{gradedTotal ? `${ourCorrect}/${gradedTotal} played` : "no results yet"}</div>
            </div>
            <div className="cmp-stat">
              <div className="n">{gradedTotal ? pct((extCorrect / gradedTotal) * 100) : "—"}</div>
              <div className="l">{meta?.name ?? "External"}</div>
              <div className="s">{gradedTotal ? `${extCorrect}/${gradedTotal} played` : "no results yet"}</div>
            </div>
          </div>

          <table className="data cmp-table">
            <thead>
              <tr>
                <th>Match</th>
                <th>Fyfa_Rat Model</th>
                <th>{meta?.name ?? "External"}</th>
                <th className="ctr">Agree?</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="fl">{r.fa}</span> {r.a} <span className="t-mut">v</span>{" "}
                    <span className="fl">{r.fb}</span> {r.b}
                    <div className="t-mut" style={{ fontSize: 12 }}>
                      {formatKickoff(r.kickoff)}
                      {r.completed && (
                        <>
                          {" · "}
                          <b>
                            {r.homeScore}–{r.awayScore}
                          </b>
                        </>
                      )}
                    </div>
                  </td>
                  {modelCell(r, "our")}
                  {modelCell(r, "ext")}
                  <td className="ctr">
                    <span className={`agree-chip ${r.agree ? "yes" : "no"}`}>{r.agree ? "Agree" : "Differ"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {meta && (
            <p className="meth" style={{ margin: "20px 0 0", maxWidth: 720 }}>
              H / D / A is the home-win / draw / away-win split. Projected score is each model&apos;s expected goals.{" "}
              {meta.name} figures are transcribed from{" "}
              <a href={meta.source} target="_blank" rel="noopener noreferrer">
                {meta.author}
              </a>
              ; our split comes from the Elo + Poisson head-to-head engine. Once a fixture is played, a ✓/✗ marks whether
              each model&apos;s most likely outcome matched the result.
            </p>
          )}
        </>
      )}
      <div className="foot" />
    </>
  );
}
