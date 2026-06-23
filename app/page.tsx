import { prisma } from "@/lib/db";
import { getMatches } from "@/lib/matches";
import { STAGE_LABELS, kickoffParts } from "@/lib/format";
import { favoredWinner, mostLikelyOutcome, resolvePrediction } from "@/lib/predictions/matchPredictions";
import { MatchBoard, type GameFixture } from "./ui";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // getMatches() ensures the Match result columns + MatchPrediction table exist.
  const matches = await getMatches({});
  const stored = await prisma.matchPrediction.findMany();
  const predMap = new Map(stored.map((p) => [p.matchId, p]));

  // "Today" in Eastern Time, to match the kickoff date grouping.
  const todayKey = kickoffParts(new Date()).date;

  const fixtures: GameFixture[] = matches.map((m) => {
    const { date, time } = kickoffParts(m.kickoff);
    const a = { code: m.homeTeam?.code ?? "", n: m.homeTeam?.name ?? m.homeLabel ?? "TBD", f: m.homeTeam?.flag ?? "" };
    const b = { code: m.awayTeam?.code ?? "", n: m.awayTeam?.name ?? m.awayLabel ?? "TBD", f: m.awayTeam?.flag ?? "" };

    const rp = resolvePrediction(predMap.get(m.id), m.homeTeam?.code, m.awayTeam?.code);
    const pred = rp
      ? {
          pWinA: rp.pWinA,
          pDraw: rp.pDraw,
          pWinB: rp.pWinB,
          eloA: rp.eloA,
          eloB: rp.eloB,
          frozen: rp.frozen,
          live: rp.live,
          mostLikely: mostLikelyOutcome(rp),
          winner: favoredWinner(rp),
          topScore: rp.topScoreline,
        }
      : null;

    return {
      id: m.id,
      date,
      time,
      a,
      b,
      group: m.group,
      stageLabel: STAGE_LABELS[m.stage] ?? m.stage,
      stage: m.stage === "GROUP" ? "group" : "knockout",
      venue: m.venue.stadium,
      city: m.venue.city,
      completed: m.status === "COMPLETED",
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      pred,
    };
  });

  const upcoming = fixtures.filter((f) => f.date >= todayKey).length;
  const played = fixtures.filter((f) => f.completed).length;

  return (
    <>
      <section className="hero">
        <div className="kicker">Elo Monte Carlo · win / draw / loss</div>
        <h1 className="display">The Matches</h1>
        <p>
          Every World Cup 2026 fixture with a model call: the <b>most likely outcome</b> and the full simulation
          breakdown. Predictions are frozen the night before kickoff, so past games keep the call the model actually
          made. {played > 0 ? <><b>{played} played</b>, </> : null}
          <b>{upcoming} still to come</b>. All times Eastern (ET).
        </p>
      </section>

      <MatchBoard fixtures={fixtures} todayKey={todayKey} />
    </>
  );
}
