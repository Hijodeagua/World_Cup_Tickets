import Link from "next/link";
import { prisma } from "@/lib/db";
import { getMatches, type MatchWithRelations } from "@/lib/matches";
import { KNOCKOUT_LINEAGE, bracketRounds, slotLabel } from "@/lib/bracket";
import { kickoffParts } from "@/lib/format";
import { favoredWinner, resolvePrediction } from "@/lib/predictions/matchPredictions";

export const dynamic = "force-dynamic";

const ROUND_TITLES = ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"];
const THIRD_PLACE_MATCH = 103;

interface Side {
  code: string | null;
  name: string;
  flag: string;
  score: number | null;
  winner: boolean;
  tbd: boolean;
}

function sides(m: MatchWithRelations): { a: Side; b: Side; pens: boolean } {
  const winnerCode =
    m.winnerCode ??
    (m.status === "COMPLETED" && m.homeScore != null && m.awayScore != null && m.homeScore !== m.awayScore
      ? m.homeScore > m.awayScore
        ? m.homeTeam?.code ?? null
        : m.awayTeam?.code ?? null
      : null);
  const lin = KNOCKOUT_LINEAGE.get(m.fifaMatchNo);
  const mk = (team: MatchWithRelations["homeTeam"], label: string | null, score: number | null, src: "home" | "away"): Side => ({
    code: team?.code ?? null,
    name: team?.name ?? label ?? slotLabel(lin?.[src]) ?? "TBD",
    flag: team?.flag ?? "",
    score,
    winner: !!team && !!winnerCode && team.code === winnerCode,
    tbd: !team,
  });
  return {
    a: mk(m.homeTeam, m.homeLabel, m.homeScore, "home"),
    b: mk(m.awayTeam, m.awayLabel, m.awayScore, "away"),
    pens: !!winnerCode && m.homeScore != null && m.homeScore === m.awayScore,
  };
}

export default async function BracketPage() {
  const [matches, stored] = await Promise.all([
    getMatches({}).then((ms) => ms.filter((m) => m.stage !== "GROUP")),
    prisma.matchPrediction.findMany(),
  ]);
  const byNo = new Map(matches.map((m) => [m.fifaMatchNo, m]));
  const predMap = new Map(stored.map((p) => [p.matchId, p]));
  const rounds = bracketRounds();
  const played = matches.filter((m) => m.status === "COMPLETED").length;

  const card = (no: number) => {
    const m = byNo.get(no);
    if (!m) return null;
    const { a, b, pens } = sides(m);
    const upcoming = m.status !== "COMPLETED" && !a.tbd && !b.tbd;
    const rp = upcoming ? resolvePrediction(predMap.get(m.id), a.code, b.code) : null;
    const fav = rp ? favoredWinner(rp) : null;
    const { date } = kickoffParts(m.kickoff);

    const side = (s: Side) => (
      <div className={`bk-side${s.winner ? " win" : ""}${s.tbd ? " tbd" : ""}`}>
        <span className="bk-team">
          {s.flag && <span className="bk-fl">{s.flag}</span>}
          <span className="bk-nm">{s.name}</span>
        </span>
        <span className="bk-sc">{s.score ?? ""}</span>
      </div>
    );

    return (
      <Link href={`/matches/${m.id}`} className="bk-card" key={no}>
        <div className="bk-meta">
          <span>
            M{m.fifaMatchNo} · {date.slice(5).replace("-", "/")} · {m.venue.city}
          </span>
          {pens && <span className="bk-pens">pens</span>}
        </div>
        {side(a)}
        {side(b)}
        {fav && (
          <div className="bk-model">
            Model: <b>{fav.side === "A" ? a.code : b.code}</b> {Math.round(fav.p * 100)}%
          </div>
        )}
      </Link>
    );
  };

  return (
    <>
      <section className="hero" style={{ borderBottom: "none", paddingBottom: 6 }}>
        <div className="kicker">Knockout rounds · refreshed nightly from the results feed</div>
        <h1 className="display">The Bracket</h1>
        <p>
          The real road to the final: every knockout slot fills in as results land — <b>{played} of 32 played</b> —
          and the winners advance overnight. Upcoming games carry the model&apos;s call; drawn games show the side
          that went through on penalties.
        </p>
      </section>

      <div className="bk-scroll">
        <div className="bk-grid">
          {rounds.map((nos, i) => (
            <div className="bk-round" key={ROUND_TITLES[i]}>
              <div className="bk-rh">{ROUND_TITLES[i]}</div>
              <div className="bk-col">
                {nos.map((no) => card(no))}
                {i === rounds.length - 1 && byNo.has(THIRD_PLACE_MATCH) && (
                  <div className="bk-third">
                    <div className="bk-rh">Third place</div>
                    {card(THIRD_PLACE_MATCH)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="meth" style={{ margin: "20px 0 0", maxWidth: 720 }}>
        Slots come straight from the results feed (actual teams, scores, shootout winners) plus the official
        FIFA bracket lineage for rounds the feed hasn&apos;t announced yet. The nightly refresh applies new
        results, advances the winners, and re-runs the Elo Monte Carlo projections on what&apos;s left of this
        bracket.
      </p>
      <div className="foot" />
    </>
  );
}
