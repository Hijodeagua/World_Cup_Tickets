import Link from "next/link";
import { notFound } from "next/navigation";
import { getMatch } from "@/lib/matches";
import { STAGE_LABELS, formatKickoff } from "@/lib/format";
import { getBlendedElo } from "@/lib/predictions/ratings";
import { simulateHeadToHead } from "@/lib/predictions/headToHead";
import { getMatchupOdds } from "@/lib/odds";
import { getRoster } from "@/lib/rosters";
import { MatchupSection } from "@/app/matchup";

export const dynamic = "force-dynamic";

function side(team: { name: string; flag: string | null } | null, label: string | null): string {
  if (team) return `${team.flag ?? ""} ${team.name}`.trim();
  return label ?? "TBD";
}

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = await getMatch(id);
  if (!match) notFound();

  const completed = match.status === "COMPLETED" && match.homeScore != null && match.awayScore != null;

  // Head-to-head matchup view: only when both teams are known (knockout slots
  // stay TBD until the group stage resolves) and both have an Elo rating.
  const eloHome = getBlendedElo(match.homeTeam?.code);
  const eloAway = getBlendedElo(match.awayTeam?.code);
  let matchup = null;
  if (match.homeTeam && match.awayTeam && eloHome != null && eloAway != null) {
    const h2h = simulateHeadToHead({
      eloA: eloHome,
      eloB: eloAway,
      codeA: match.homeTeam.code,
      codeB: match.awayTeam.code,
    });
    const [odds, rosterA, rosterB] = await Promise.all([
      getMatchupOdds(match.homeTeam.name, match.awayTeam.name),
      getRoster(match.homeTeam.code),
      getRoster(match.awayTeam.code),
    ]);
    matchup = {
      a: { name: match.homeTeam.name, flag: match.homeTeam.flag ?? "", elo: eloHome },
      b: { name: match.awayTeam.name, flag: match.awayTeam.flag ?? "", elo: eloAway },
      h2h,
      odds,
      rosterA,
      rosterB,
    };
  }

  return (
    <>
      <Link href="/" className="backlink">
        ← All matches
      </Link>

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="submeta" style={{ marginTop: 0 }}>
          <span className="grp">{STAGE_LABELS[match.stage] ?? match.stage}</span>
          {match.group && (
            <>
              <span className="dot">·</span>
              <span>Group {match.group}</span>
            </>
          )}
          {!match.confirmed && <span className="prov">· provisional (subject to change)</span>}
        </div>
        <h1 className="display" style={{ fontSize: 48, marginTop: 12 }}>
          {side(match.homeTeam, match.homeLabel)} <span className="x">v</span> {side(match.awayTeam, match.awayLabel)}
        </h1>
        <p style={{ color: "var(--mut)", marginTop: 14, fontSize: 15 }}>
          {formatKickoff(match.kickoff)} · {match.venue.stadium}, {match.venue.city}, {match.venue.country}
        </p>

        {completed && (
          <div
            style={{
              marginTop: 22,
              paddingTop: 18,
              borderTop: "1px solid var(--line)",
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <span
              className="status available"
              style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}
            >
              Full time
            </span>
            <span style={{ fontFamily: "Newsreader, serif", fontSize: 34 }}>
              {match.homeScore} – {match.awayScore}
            </span>
          </div>
        )}
      </div>

      {matchup && (
        <MatchupSection
          a={matchup.a}
          b={matchup.b}
          h2h={matchup.h2h}
          odds={matchup.odds}
          rosterA={matchup.rosterA}
          rosterB={matchup.rosterB}
        />
      )}

      <div className="foot" />
    </>
  );
}
