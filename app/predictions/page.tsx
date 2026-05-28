import { prisma } from "@/lib/db";
import { formatPct } from "@/lib/format";
import { BLEND_WEIGHT_ONLINE } from "@/lib/predictions/elo";

export const dynamic = "force-dynamic";

export default async function PredictionsPage() {
  const [projections, teams] = await Promise.all([
    prisma.teamProjection.findMany({ orderBy: [{ pChampion: "desc" }, { pSF: "desc" }, { elo: "desc" }] }),
    prisma.team.findMany({ select: { code: true, name: true, flag: true } }),
  ]);
  const meta = new Map(teams.map((t) => [t.code, t]));
  const iterations = projections[0]?.iterations ?? 0;
  const favorite = projections[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Title projections</h1>
        <p className="text-sm text-neutral-500">
          Elo Monte Carlo over {iterations.toLocaleString()} simulated tournaments, blending an online World
          Football Elo and a Silver/SPI-style model ({Math.round(BLEND_WEIGHT_ONLINE * 100)}/
          {Math.round((1 - BLEND_WEIGHT_ONLINE) * 100)}). A projection, not a prediction — update
          `data/elo-ratings.json` and run `npm run predict` to refresh.
        </p>
      </div>

      {favorite && (
        <div className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Projected favorite</div>
          <div className="mt-1 text-2xl font-bold">
            {meta.get(favorite.code)?.flag} {meta.get(favorite.code)?.name ?? favorite.code}
          </div>
          <div className="text-sm text-neutral-500">
            {formatPct(favorite.pChampion)} to win · {formatPct(favorite.pFinal)} to reach the final · Elo {favorite.elo}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-100 text-xs uppercase text-neutral-500 dark:bg-neutral-800">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Team</th>
              <th className="px-3 py-2">Grp</th>
              <th className="px-3 py-2 text-right">Elo</th>
              <th className="px-3 py-2 text-right">Win grp</th>
              <th className="px-3 py-2 text-right">Advance</th>
              <th className="px-3 py-2 text-right">R16</th>
              <th className="px-3 py-2 text-right">QF</th>
              <th className="px-3 py-2 text-right">SF</th>
              <th className="px-3 py-2 text-right">Final</th>
              <th className="px-3 py-2 text-right font-semibold">Champion</th>
            </tr>
          </thead>
          <tbody>
            {projections.map((p, i) => (
              <tr key={p.code} className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="px-3 py-2 text-neutral-400">{i + 1}</td>
                <td className="px-3 py-2 font-medium">
                  {meta.get(p.code)?.flag} {meta.get(p.code)?.name ?? p.code}
                </td>
                <td className="px-3 py-2 text-neutral-500">{p.group}</td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{p.elo}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatPct(p.pGroupWinner)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatPct(p.pQualify)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatPct(p.pR16)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatPct(p.pQF)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatPct(p.pSF)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatPct(p.pFinal)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatPct(p.pChampion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-neutral-500">
        Method: group matches simulated with a Poisson goals model driven by Elo difference (host boost for USA/MEX/CAN);
        top two per group plus the eight best third-placed teams advance; the knockout bracket is Elo-seeded (not FIFA&apos;s
        exact slot table) and resolved as single elimination. &ldquo;Advance&rdquo; = reach the round of 32.
      </p>
    </div>
  );
}
