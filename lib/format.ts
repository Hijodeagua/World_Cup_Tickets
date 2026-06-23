export const STAGE_LABELS: Record<string, string> = {
  GROUP: "Group stage",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-final",
  SF: "Semi-final",
  THIRD: "Third place",
  FINAL: "Final",
};

export const DEFAULT_TIMEZONE = "America/New_York";

export function formatKickoff(d: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(d);
}

// Split a Date into a YYYY-MM-DD date string and a 24h HH:MM time string in the
// given timezone (defaults to ET). Used to feed the date-grouped match ledger.
export function kickoffParts(d: Date, timeZone: string = DEFAULT_TIMEZONE): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${hour}:${get("minute")}` };
}

export function formatPct(p: number): string {
  if (p <= 0) return "—";
  if (p < 0.01) return "<1%";
  return `${Math.round(p * 100)}%`;
}
