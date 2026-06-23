import type { PrismaClient } from "@prisma/client";

// The Match result columns (status / homeScore / awayScore) and the
// MatchPrediction table are applied here at RUNTIME rather than in the build
// step. Vercel's build container can't reach the database, so `prisma db push`
// there breaks the build; these changes are additive and idempotent, so
// applying them on first use is safe.
//
// Runs at most once per server instance (memoized) and is a no-op once the
// columns exist. Call it before any query that reads Match scalar fields —
// Prisma selects every scalar by default, so this guards the match list and
// detail pages, the groups page, and the predictions cron alike.
//
// The SQL is fully static (no interpolation), and `ADD COLUMN IF NOT EXISTS`
// matches Prisma's `db push` for these fields.
let ensured: Promise<void> | null = null;

export function ensureMatchColumns(prisma: PrismaClient): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'SCHEDULED'`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "homeScore" INTEGER`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "awayScore" INTEGER`);
      // Frozen per-match predictions (lib/predictions/matchPredictions.ts). New
      // table, created here at runtime for the same reason as the columns above:
      // Vercel's build container can't reach the database, so this is idempotent
      // and additive. CREATE TABLE IF NOT EXISTS matches Prisma's `db push`.
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "MatchPrediction" (
        "matchId" TEXT NOT NULL,
        "fifaMatchNo" INTEGER NOT NULL,
        "homeCode" TEXT,
        "awayCode" TEXT,
        "eloA" INTEGER NOT NULL,
        "eloB" INTEGER NOT NULL,
        "pWinA" DOUBLE PRECISION NOT NULL,
        "pDraw" DOUBLE PRECISION NOT NULL,
        "pWinB" DOUBLE PRECISION NOT NULL,
        "iterations" INTEGER NOT NULL,
        "frozen" BOOLEAN NOT NULL DEFAULT false,
        "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "MatchPrediction_pkey" PRIMARY KEY ("matchId")
      )`);
      await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "MatchPrediction_fifaMatchNo_key" ON "MatchPrediction" ("fifaMatchNo")`);
    })().catch((e) => {
      ensured = null; // let a later call retry if this one failed
      throw e;
    });
  }
  return ensured;
}

// The TeamProjection.baselinePQualify column is applied here at runtime for the
// same reason as ensureMatchColumns: Vercel's build container can't reach the
// database, so additive, idempotent changes are applied on first use instead of
// in the build step. Call before reading/writing baseline projection odds.
let ensuredProjection: Promise<void> | null = null;

export function ensureProjectionColumns(prisma: PrismaClient): Promise<void> {
  if (!ensuredProjection) {
    ensuredProjection = (async () => {
      await prisma.$executeRawUnsafe(`ALTER TABLE "TeamProjection" ADD COLUMN IF NOT EXISTS "baselinePQualify" DOUBLE PRECISION`);
    })().catch((e) => {
      ensuredProjection = null; // let a later call retry if this one failed
      throw e;
    });
  }
  return ensuredProjection;
}
