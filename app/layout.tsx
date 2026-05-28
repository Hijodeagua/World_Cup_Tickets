import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "World Cup 2026 — Matches & Ticket Availability",
  description: "Browse FIFA World Cup 2026 matches and see which still have tickets available.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-lg font-bold tracking-tight">
              ⚽ World Cup 2026
            </Link>
            <nav className="flex gap-4 text-sm text-neutral-600 dark:text-neutral-400">
              <Link href="/" className="hover:text-neutral-900 dark:hover:text-neutral-100">
                Matches
              </Link>
              <Link href="/admin/health" className="hover:text-neutral-900 dark:hover:text-neutral-100">
                Source health
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-neutral-500">
          Ticket availability is best-effort and may be stale. Always confirm on the official portal.
        </footer>
      </body>
    </html>
  );
}
