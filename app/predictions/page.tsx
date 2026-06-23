import { prisma } from "@/lib/db";
import { BLEND_WEIGHT_ONLINE } from "@/lib/predictions/elo";
import { ProjectionsTable, type ProjRow } from "../ui";

export const dynamic = "force-dynamic";

const PROJ_COLS = ["Win Grp", "Advance", "R16", "QF", "SF", "Final", "Champion"];
const fmtPct = (v: number) => (v <= 0 ? "—" : v < 1 ? "<1%" : `${Math.round(v)}%`);

export default async function PredictionsPage() {
  const [projections, teams] = await Promise.all([
    prisma.teamProjection.findMany({ orderBy: [{ pChampion: "desc" }, { pSF: "desc" }, { elo: "desc" }] }),
    prisma.team.findMany({ select: { code: true, name: true, flag: true } }),
  ]);
  const meta = new Map(teams.map((t) => [t.code, t]));
  const iterations = projections[0]?.iterations ?? 0;

  // probabilities are stored as fractions (0..1); the editorial views use 0..100.
  const rows: ProjRow[] = projections.map((p) => ({
    fl: meta.get(p.code)?.flag ?? "🏳️",
    nm: meta.get(p.code)?.name ?? p.code,
    g: p.group,
    e: p.elo,
    c: [p.pGroupWinner, p.pQualify, p.pR16, p.pQF, p.pSF, p.pFinal, p.pChampion].map((v) => v * 100),
  }));

  const fav = rows.slice().sort((a, b) => b.c[6] - a.c[6])[0];
  const maxC = Math.max(...rows.map((d) => d.c[6]), 1);
  const chart = rows.slice().sort((a, b) => b.c[6] - a.c[6]).slice(0, 7);

  return (
    <>
      <section className="hero" style={{ borderBottom: "none", paddingBottom: 6 }}>
        <div className="kicker">Elo Monte Carlo · {iterations.toLocaleString()} simulations</div>
        <h1 className="display">Road to the Final</h1>
        <p>
          Championship odds drawn from <b>{iterations.toLocaleString()} simulated tournaments</b>, blending an
          online World Football Elo with a Silver/SPI-style model (
          {Math.round(BLEND_WEIGHT_ONLINE * 100)}/{Math.round((1 - BLEND_WEIGHT_ONLINE) * 100)}). A projection —
          not a prediction.
        </p>
      </section>

      {fav && (
        <div className="topgrid">
          <div className="fav">
            <div className="lab">Projected favorite</div>
            <div className="who">
              <span className="fl">{fav.fl}</span>
              <span className="nm">{fav.nm}</span>
            </div>
            <div className="big">
              <span className="pct">
                {Math.round(fav.c[6])}
                <span style={{ fontSize: 24 }}>%</span>
              </span>
              <span className="cap">to lift the trophy</span>
            </div>
            <div className="sub">
              <div>
                <div className="n">{fmtPct(fav.c[5])}</div>
                <div className="l">Reach final</div>
              </div>
              <div>
                <div className="n">{fmtPct(fav.c[4])}</div>
                <div className="l">Reach semis</div>
              </div>
              <div>
                <div className="n">{fav.e}</div>
                <div className="l">Elo</div>
              </div>
            </div>
          </div>

          <div className="chart">
            <h3>Championship probability</h3>
            <div className="csub">Top contenders · share of simulations ending in a title</div>
            <div>
              {chart.map((d) => (
                <div className="bar" key={d.nm}>
                  <div className="bt">
                    <span className="fl">{d.fl}</span>
                    {d.nm}
                  </div>
                  <div className="track">
                    <div className="fill" style={{ width: `${Math.max(2, (d.c[6] / maxC) * 100)}%` }} />
                  </div>
                  <div className="bv">{fmtPct(d.c[6])}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="legend">
        <span className="tg">Round-by-round survival</span>
        <span className="sp" />
        <span>0%</span>
        <span className="grad" />
        <span>100%</span>
      </div>

      <ProjectionsTable rows={rows} cols={PROJ_COLS} />

      <p className="meth" style={{ margin: "20px 0 0", maxWidth: 720 }}>
        Method: group matches simulated with a Poisson goals model driven by Elo difference (host boost for
        USA/MEX/CAN); top two per group plus the eight best third-placed teams advance; the knockout bracket is
        Elo-seeded (not FIFA&apos;s exact slot table) and resolved as single elimination. &ldquo;Advance&rdquo; =
        reach the round of 32.
      </p>
      <div className="foot" />
    </>
  );
}
