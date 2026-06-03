import type { Metadata } from "next";
import "./globals.css";
import { SiteNav } from "./ui";

export const metadata: Metadata = {
  title: "World Cup 2026 — Matches & Ticket Availability",
  description: "Browse FIFA World Cup 2026 matches and see which still have tickets available.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <div className="wrap top-inner">
            <a className="brand" href="/">
              <span className="em" />
              World Cup 2026
            </a>
            <SiteNav />
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="site">
          <div className="wrap inner">
            Ticket availability is best-effort and may be stale. Always confirm on the official portal.
          </div>
        </footer>
      </body>
    </html>
  );
}
