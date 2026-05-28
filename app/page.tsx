import { getFilterOptions, getMatches } from "@/lib/matches";
import { STAGE_LABELS } from "@/lib/format";
import { MatchRow } from "./ui";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pick(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length ? s : undefined;
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const filters = {
    team: pick(sp.team),
    city: pick(sp.city),
    stage: pick(sp.stage),
    availableOnly: pick(sp.available) === "1",
  };

  const [matches, options] = await Promise.all([getMatches(filters), getFilterOptions()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Matches & ticket availability</h1>
        <p className="text-sm text-neutral-500">
          {matches.length} match{matches.length === 1 ? "" : "es"} shown. Times in your local timezone.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <label className="flex flex-col text-xs font-medium text-neutral-500">
          Team
          <select name="team" defaultValue={filters.team ?? ""} className="mt-1 rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700">
            <option value="">All teams</option>
            {options.teams.map((t) => (
              <option key={t.code} value={t.code}>
                {t.flag} {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs font-medium text-neutral-500">
          Host city
          <select name="city" defaultValue={filters.city ?? ""} className="mt-1 rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700">
            <option value="">All cities</option>
            {options.cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs font-medium text-neutral-500">
          Stage
          <select name="stage" defaultValue={filters.stage ?? ""} className="mt-1 rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700">
            <option value="">All stages</option>
            {options.stages.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s] ?? s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="available" value="1" defaultChecked={filters.availableOnly} />
          Available only
        </label>
        <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-white dark:text-neutral-900">
          Apply
        </button>
        <a href="/" className="text-sm text-neutral-500 hover:underline">
          Reset
        </a>
      </form>

      {matches.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-700">
          No matches match these filters.
        </p>
      ) : (
        <div className="grid gap-3">
          {matches.map((m) => (
            <MatchRow key={m.id} match={m} />
          ))}
        </div>
      )}
    </div>
  );
}
