import { prisma } from "@/lib/db";
import { ensureMatchColumns } from "@/lib/ensure-schema";
import { STAGE_LABELS, formatKickoff } from "@/lib/format";
import { actualOutcome, mostLikelyOutcome, resolvePrediction, type Outcome } from "@/lib/predictions/matchPredictions";
import { MODEL_KEYS, hasAnyMatchPicks, matchPick, modelMeta, type ModelKey } from "@/lib/predictions/externalModels";

export const dynamic = "force-dynamic";

const outcomeText = (o: Outcome, a: string, b: string) => (o === "A" ? `${a} win` : o === "B" ? `${b} win` : "Draw");
const classLabel: Record<Outcome, string> = { A: "Home win", DRAW: "Draw", B: "Away win" };

export default async function AccuracyPage() {
  await ensureMatchColumns(prisma);

  const [matches, stored] = await Promise.all([
    prisma.match.findMany({
      where: { status: "COMPLETED" },
      include: { homeTeam: true, awayTeam: true },
      orderBy: { kickoff: "asc" },
    }),
    prisma.matchPrediction.findMany(),
  ]);
  const predMap = new Map(stored.map((p) => [p.matchId, p]));

  // Grade each completed match that has a prediction and a final score.
  interface Graded {
    id: string;
    kickoff: Date;
    a: string;
    b: string;
    fa: string;
    fb: string;
    stageLabel: string;
    homeScore: number;
    awayScore: number;
    predicted: Outcome;
    conf: number; // probability the model assigned to its pick
    actual: Outcome;
    correct: boolean;
    frozen: boolean;
    runningPct: number;
    // Outside models' calls for this fixture (null where no pick is on file).
    ext: Record<ModelKey, { pick: Outcome; correct: boolean } | null>;
  }

  const graded: Graded[] = [];
  let correctCount = 0;
  const byClass: Record<Outcome, { correct: number; total: number }> = {
    A: { correct: 0, total: 0 },
    DRAW: { correct: 0, total: 0 },
    B: { correct: 0, total: 0 },
  };

  for (const m of matches) {
    if (m.homeScore == null || m.awayScore == null) continue;
    const rp = resolvePrediction(predMap.get(m.id), m.homeTeam?.code, m.awayTeam?.code);
    if (!rp) continue;
    const predicted = mostLikelyOutcome(rp);
    const actual = actualOutcome(m.homeScore, m.awayScore);
    const correct = predicted === actual;
    const conf = predicted === "A" ? rp.pWinA : predicted === "B" ? rp.pWinB : rp.pDraw;
    if (correct) correctCount++;
    byClass[predicted].total++;
    if (correct) byClass[predicted].correct++;

    const ext: Record<ModelKey, { pick: Outcome; correct: boolean } | null> = { paddlin: null, pele: null };
    for (const k of MODEL_KEYS) {
      const pick = matchPick(m.fifaMatchNo, k);
      if (pick) ext[k] = { pick, correct: pick === actual };
    }

    graded.push({
      id: m.id,
      kickoff: m.kickoff,
      a: m.homeTeam?.name ?? "TBD",
      b: m.awayTeam?.name ?? "TBD",
      fa: m.homeTeam?.flag ?? "🏳️",
      fb: m.awayTeam?.flag ?? "🏳️",
      stageLabel: STAGE_LABELS[m.stage] ?? m.stage,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      predicted,
      conf,
      actual,
      correct,
      frozen: rp.frozen,
      runningPct: 0,
      ext,
    });
  }

  // Head-to-head vs the outside models: for each model, accuracy over the games
  // it actually called, plus our own accuracy over that same set (a fair,
  // like-for-like comparison). Stays empty until picks are entered.
  const showModels = hasAnyMatchPicks();
  const h2h: Record<ModelKey, { model: number; ours: number; total: number }> = {
    paddlin: { model: 0, ours: 0, total: 0 },
    pele: { model: 0, ours: 0, total: 0 },
  };
  for (const g of graded) {
    for (const k of MODEL_KEYS) {
      const e = g.ext[k];
      if (!e) continue;
      h2h[k].total++;
      if (e.correct) h2h[k].model++;
      if (g.correct) h2h[k].ours++;
    }
  }

  // Running accuracy after each game (chronological).
  let run = 0;
  graded.forEach((g, i) => {
    if (g.correct) run++;
    g.runningPct = (run / (i + 1)) * 100;
  });

  const total = graded.length;
  const overall = total > 0 ? (correctCount / total) * 100 : 0;
  const last5 = graded.slice(-5);
  const last5Pct = last5.length ? (last5.filter((g) => g.correct).length / last5.length) * 100 : 0;

  // Sparkline of running accuracy.
  const W = 520;
  const H = 90;
  const pad = 6;
  const pts = graded
    .map((g, i) => {
      const x = total <= 1 ? pad : pad + (i / (total - 1)) * (W - 2 * pad);
      const y = H - pad - (g.runningPct / 100) * (H - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const pct = (v: number) => `${Math.round(v)}%`;

  const classCard = (o: Outcome) => {
    const c = byClass[o];
    const p = c.total ? (c.correct / c.total) * 100 : 0;
    return (
      <div className="acc-stat" key={o}>
        <div className="l">{classLabel[o]} predicted</div>
        <div className="n">{c.total ? pct(p) : "—"}</div>
        <div className="s">
          {c.correct}/{c.total} correct
        </div>
      </div>
    );
  };

  return (
    <>
      <section className="hero" style={{ borderBottom: "none", paddingBottom: 6 }}>
        <div className="kicker">Model grading · Elo vs reality</div>
        <h1 className="display">Accuracy</h1>
        <p>
          Every completed match, graded against the prediction the model made <b>before kickoff</b>. Each call is the
          most likely outcome from the frozen win/draw/loss split — no hindsight, no re-running after the result is in.
        </p>
      </section>

      {total === 0 ? (
        <div className="empty">
          <div className="e1">No completed matches yet</div>
          <div className="e2">Predictions will be graded here as soon as results start coming in.</div>
        </div>
      ) : (
        <>
          <div className="acc-grid">
            <div className="acc-hero">
              <div className="l">Overall accuracy</div>
              <div className="big">
                <span className="pct">
                  {Math.round(overall)}
                  <span style={{ fontSize: 24 }}>%</span>
                </span>
                <span className="cap">
                  {correctCount} of {total} correct
                </span>
              </div>
              <div className="acc-sub">
                <div>
                  <div className="n">{pct(last5Pct)}</div>
                  <div className="l">Last {last5.length}</div>
                </div>
                <div>
                  <div className="n">{total}</div>
                  <div className="l">Games graded</div>
                </div>
              </div>
            </div>
            {classCard("A")}
            {classCard("DRAW")}
            {classCard("B")}
          </div>

          <div className="acc-trend">
            <div className="th">
              <span className="tg">Accuracy over time</span>
              <span className="csub">Running hit-rate after each completed match</span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="spark" preserveAspectRatio="none">
              <line x1={pad} y1={H - pad - 0.5 * (H - 2 * pad)} x2={W - pad} y2={H - pad - 0.5 * (H - 2 * pad)} className="spark-mid" />
              <polyline points={pts} className="spark-line" />
            </svg>
            <div className="acc-dots">
              {graded.map((g) => (
                <span key={g.id} className={`dot ${g.correct ? "ok" : "miss"}`} title={`${g.a} v ${g.b}: ${g.correct ? "correct" : "missed"}`} />
              ))}
            </div>
          </div>

          {showModels && (
            <div className="acc-compare">
              <div className="th">
                <span className="tg">How we compare</span>
                <span className="csub">Hit-rate over the games each model called — Fyfa_Rat Model vs the public models</span>
              </div>
              <div className="cmp-grid">
                {MODEL_KEYS.filter((k) => h2h[k].total > 0).map((k) => {
                  const m = modelMeta(k);
                  const h = h2h[k];
                  const them = (h.model / h.total) * 100;
                  const us = (h.ours / h.total) * 100;
                  const lead = us - them;
                  return (
                    <div className="cmp-card" key={k}>
                      <div className="cmp-h">
                        <a href={m.source} target="_blank" rel="noopener noreferrer">
                          {m.name}
                        </a>{" "}
                        <span className="t-mut">· {m.author}</span>
                      </div>
                      <div className="cmp-row">
                        <span className="cmp-l">Fyfa_Rat Model</span>
                        <span className="cmp-v">{pct(us)}</span>
                      </div>
                      <div className="cmp-row">
                        <span className="cmp-l">{m.name}</span>
                        <span className="cmp-v">{pct(them)}</span>
                      </div>
                      <div className={`cmp-lead ${lead >= 0 ? "ok" : "miss"}`}>
                        {lead === 0 ? "Level" : `${lead > 0 ? "We lead" : "They lead"} by ${pct(Math.abs(lead))}`}
                        <span className="t-mut"> · {h.total} games</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <h2 className="section-h">Game by game</h2>
          <table className="data acc-table">
            <thead>
              <tr>
                <th>Match</th>
                <th>Stage</th>
                <th>Predicted</th>
                <th>Result</th>
                <th>Call</th>
                {showModels && MODEL_KEYS.map((k) => <th key={k}>{modelMeta(k).name}</th>)}
                <th className="num">Running</th>
              </tr>
            </thead>
            <tbody>
              {graded
                .slice()
                .reverse()
                .map((g) => (
                  <tr key={g.id}>
                    <td>
                      <span className="fl">{g.fa}</span> {g.a} <span className="t-mut">v</span>{" "}
                      <span className="fl">{g.fb}</span> {g.b}
                      <div className="t-mut" style={{ fontSize: 12 }}>
                        {formatKickoff(g.kickoff)}
                        {!g.frozen && <span title="No frozen snapshot — graded against a live estimate"> · est.</span>}
                      </div>
                    </td>
                    <td className="t-mut">{g.stageLabel}</td>
                    <td>
                      {outcomeText(g.predicted, g.a, g.b)}
                      <span className="t-mut" style={{ fontSize: 12 }}> · {pct(g.conf * 100)}</span>
                    </td>
                    <td>
                      <b>
                        {g.homeScore}–{g.awayScore}
                      </b>{" "}
                      <span className="t-mut">{outcomeText(g.actual, g.a, g.b)}</span>
                    </td>
                    <td className={g.correct ? "t-ok" : "t-bad"}>{g.correct ? "✓ Correct" : "✗ Missed"}</td>
                    {showModels &&
                      MODEL_KEYS.map((k) => {
                        const e = g.ext[k];
                        return (
                          <td key={k} className={e ? (e.correct ? "t-ok" : "t-bad") : "t-mut"}>
                            {e ? (e.correct ? "✓" : "✗") : "—"}
                          </td>
                        );
                      })}
                    <td className="num">{pct(g.runningPct)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
      <div className="foot" />
    </>
  );
}
