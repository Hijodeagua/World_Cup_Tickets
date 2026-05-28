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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Source health</h1>
        <p className="text-sm text-neutral-500">Early warning for broken ticket sources.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {perProvider.length === 0 && <p className="text-sm text-neutral-500">No runs recorded yet.</p>}
        {perProvider.map((p) => (
          <div key={p.providerId} className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{p.providerId}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  p.errorRate === 0
                    ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                    : p.errorRate < 0.5
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                      : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                }`}
              >
                {Math.round(p.errorRate * 100)}% errors
              </span>
            </div>
            <p className="mt-2 text-sm text-neutral-500">
              Last successful fetch: {p.lastSuccess ? formatKickoff(p.lastSuccess) : "never"}
            </p>
          </div>
        ))}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-500">Recent runs</h2>
        <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-100 text-xs uppercase text-neutral-500 dark:bg-neutral-800">
              <tr>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Checked</th>
                <th className="px-3 py-2">OK</th>
                <th className="px-3 py-2">Failed</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((r) => (
                <tr key={r.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="px-3 py-2 text-neutral-500">{formatKickoff(r.startedAt)}</td>
                  <td className="px-3 py-2">{r.providerId}</td>
                  <td className="px-3 py-2">{r.matchesChecked}</td>
                  <td className="px-3 py-2 text-green-700 dark:text-green-400">{r.successCount}</td>
                  <td className="px-3 py-2 text-red-700 dark:text-red-400">{r.failureCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
