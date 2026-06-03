import { prisma } from "@/lib/db";
import { formatKickoff } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const providerIds = (await prisma.providerRun.findMany({ distinct: ["providerId"], select: { providerId: true } })).map(
    (r) => r.providerId,
  );

  const perProvider = await Promise.all(
    providerIds.map(async (providerId) => {
      const lastRun = await prisma.providerRun.findFirst({ where: { providerId }, orderBy: { startedAt: "desc" } });
      const lastSuccess = await prisma.ticketObservation.findFirst({
        where: { providerId, fetchSucceeded: true, scrapeStatus: "OK" },
        orderBy: { observedAt: "desc" },
        select: { observedAt: true },
      });
      const checked = lastRun?.matchesUpdated ?? 0;
      const failed = lastRun?.failureCount ?? 0;
      const errorRate = checked > 0 ? failed / checked : 0;
      return { providerId, lastRun, lastSuccess: lastSuccess?.observedAt ?? null, errorRate };
    }),
  );

  const recentRuns = await prisma.providerRun.findMany({ orderBy: { startedAt: "desc" }, take: 15 });

  return (
    <>
      <section className="hero" style={{ paddingBottom: 6 }}>
        <div className="kicker">Operations</div>
        <h1 className="display" style={{ fontSize: 56 }}>
          Source health
        </h1>
        <p>Early warning for broken ticket sources — error rate, last successful fetch, and recent runs.</p>
      </section>

      <div className="health-grid">
        {perProvider.length === 0 && <p style={{ color: "var(--mut-2)", fontSize: 14 }}>No runs recorded yet.</p>}
        {perProvider.map((p) => {
          const pill = p.errorRate === 0 ? "ok" : p.errorRate < 0.5 ? "warn" : "bad";
          return (
            <div key={p.providerId} className="health-card">
              <div className="hh">
                <span className="pid">{p.providerId}</span>
                <span className={`pill ${pill}`}>{Math.round(p.errorRate * 100)}% errors</span>
              </div>
              <p className="meta">Last successful fetch: {p.lastSuccess ? formatKickoff(p.lastSuccess) : "never"}</p>
            </div>
          );
        })}
      </div>

      <h2 className="section-h">Recent runs</h2>
      <table className="data">
        <thead>
          <tr>
            <th>Started</th>
            <th>Source</th>
            <th>Checked</th>
            <th>OK</th>
            <th>Failed</th>
          </tr>
        </thead>
        <tbody>
          {recentRuns.map((r) => (
            <tr key={r.id}>
              <td className="t-mut">{formatKickoff(r.startedAt)}</td>
              <td>{r.providerId}</td>
              <td>{r.matchesChecked}</td>
              <td className="t-ok">{r.successCount}</td>
              <td className="t-bad">{r.failureCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="foot" />
    </>
  );
}
