import type { PrismaClient } from "@prisma/client";

// The Match result columns (status / homeScore / awayScore) are applied here at
// RUNTIME rather than in the build step. Vercel's build container can't reach
// the database, so `prisma db push` there breaks the build; and these columns
// are additive and nullable/defaulted, so adding them idempotently is safe.
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
    })().catch((e) => {
      ensured = null; // let a later call retry if this one failed
      throw e;
    });
  }
  return ensured;
}
