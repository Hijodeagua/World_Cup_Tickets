import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getMatch } from "@/lib/matches";
import { STAGE_LABELS, formatKickoff, formatPrice } from "@/lib/format";
import { getBlendedElo } from "@/lib/predictions/ratings";
import { simulateHeadToHead } from "@/lib/predictions/headToHead";
import { getMatchupOdds } from "@/lib/odds";
import { getRoster } from "@/lib/rosters";
import { MatchupSection } from "@/app/matchup";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  AVAILABLE: "available",
  LIMITED: "limited",
  SOLD_OUT: "soldout",
  UNKNOWN: "unk",
};
const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Available",
  LIMITED: "Limited",
  SOLD_OUT: "Sold out",
  UNKNOWN: "Not yet on sale",
};

function side(team: { name: string; flag: string | null } | null, label: string | null): string {
  if (team) return `${team.flag ?? ""} ${team.name}`.trim();
  return label ?? "TBD";
}

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = await getMatch(id);
  if (!match) notFound();

  const recent = await prisma.ticketObservation.findMany({
    where: { matchId: id },
    orderBy: { observedAt: "desc" },
    take: 10,
  });

  const state = match.currentState;
  const avail = state?.availability ?? "UNKNOWN";
  const price = formatPrice(state?.minPrice ?? null, state?.currency ?? null);

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
  const onSale = avail === "AVAILABLE" || avail === "LIMITED";

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

        <div
          style={{
            marginTop: 22,
            paddingTop: 18,
            borderTop: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <span className={`status ${STATUS_CLASS[avail]}`}>
            {STATUS_LABEL[avail]}
            {state?.isStale && <span className="stale"> · stale</span>}
          </span>
          {price && <span style={{ fontFamily: "Newsreader, serif", fontSize: 26 }}>from {price}</span>}
          {state?.lastObservedAt && (
            <span style={{ fontSize: 12.5, color: "var(--mut-2)" }}>last checked {formatKickoff(state.lastObservedAt)}</span>
          )}
          {onSale && (
            <a className="buy" href="https://www.fifa.com/en/tickets" target="_blank" rel="noreferrer noopener">
              Buy tickets →
            </a>
          )}
        </div>
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

      <h2 className="section-h">Recent observations</h2>
      {recent.length === 0 ? (
        <p style={{ color: "var(--mut-2)", fontSize: 14 }}>No observations recorded yet.</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>When</th>
              <th>Source</th>
              <th>Availability</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((o) => (
              <tr key={o.id}>
                <td className="t-mut">{formatKickoff(o.observedAt)}</td>
                <td>{o.providerId}</td>
                <td>{o.availability}</td>
                <td className="t-mut">
                  {o.fetchSucceeded ? o.scrapeStatus : `${o.scrapeStatus}: ${o.failureReason ?? ""}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="foot" />
    </>
  );
}
