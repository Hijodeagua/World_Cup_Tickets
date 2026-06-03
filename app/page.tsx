import { getMatches } from "@/lib/matches";
import { STAGE_LABELS, kickoffParts } from "@/lib/format";
import { MatchLedger, type Fixture } from "./ui";

export const dynamic = "force-dynamic";

const AVAIL_STATUS: Record<string, Fixture["status"]> = {
  AVAILABLE: "available",
  LIMITED: "limited",
  SOLD_OUT: "soldout",
  UNKNOWN: "unk",
};

function side(team: { name: string; flag: string | null } | null, label: string | null) {
  if (team) return { n: team.name, f: team.flag ?? "" };
  return { n: label ?? "TBD", f: "" };
}

export default async function HomePage() {
  const matches = await getMatches({});

  const fixtures: Fixture[] = matches.map((m) => {
    const { date, time } = kickoffParts(m.kickoff);
    const state = m.currentState;
    const status = AVAIL_STATUS[state?.availability ?? "UNKNOWN"] ?? "unk";
    return {
      id: m.id,
      date,
      time,
      a: side(m.homeTeam, m.homeLabel),
      b: side(m.awayTeam, m.awayLabel),
      group: m.group,
      stageLabel: STAGE_LABELS[m.stage] ?? m.stage,
      stage: m.stage === "GROUP" ? "group" : "knockout",
      venue: m.venue.stadium,
      city: m.venue.city,
      status,
      price: state?.minPrice ?? null,
      stale: Boolean(state?.isStale),
      provisional: !m.confirmed,
    };
  });

  return (
    <>
      <section className="hero">
        <div className="kicker">Tickets &amp; availability</div>
        <h1 className="display">The Fixtures</h1>
        <p>
          <b>{fixtures.length} matches</b> across sixteen host cities, June through July. Prices reflect the
          verified resale floor and refresh hourly. All times in Eastern Time (ET).
        </p>
      </section>

      <MatchLedger fixtures={fixtures} />
    </>
  );
}
