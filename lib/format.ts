import type { Availability } from "./tickets/types";

export const STAGE_LABELS: Record<string, string> = {
  GROUP: "Group stage",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-final",
  SF: "Semi-final",
  THIRD: "Third place",
  FINAL: "Final",
};

export const AVAILABILITY_BADGE: Record<Availability, { label: string; className: string }> = {
  AVAILABLE: { label: "Available", className: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
  LIMITED: { label: "Limited", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  SOLD_OUT: { label: "Sold out", className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  UNKNOWN: { label: "Unknown", className: "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400" },
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

export function formatPrice(amount: number | null, currency: string | null): string | null {
  if (amount == null) return null;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency ?? "USD", maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount} ${currency ?? ""}`.trim();
  }
}
