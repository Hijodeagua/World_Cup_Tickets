import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { SiteNav } from "./ui";

export const metadata: Metadata = {
  title: "World Cup 2026 — Match Predictions",
  description: "Elo Monte Carlo predictions for every FIFA World Cup 2026 match, graded against the results.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <div className="wrap top-inner">
            <Link className="brand" href="/">
              <span className="em" />
              World Cup 2026
            </Link>
            <SiteNav />
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="site">
          <div className="wrap inner">
            Predictions are an Elo Monte Carlo model — a projection, not a guarantee. Frozen the night before each
            kickoff and graded on the Accuracy page.
          </div>
        </footer>
      </body>
    </html>
  );
}
