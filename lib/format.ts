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

// Display kickoff in a given IANA timezone (defaults to the viewer's local zone
// on the client; pass an explicit zone on the server to avoid hydration drift).
export function formatKickoff(d: Date, timeZone?: string): string {
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

export function formatPrice(amount: number | null, currency: string | null): string | null {
  if (amount == null) return null;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency ?? "USD", maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount} ${currency ?? ""}`.trim();
  }
}
