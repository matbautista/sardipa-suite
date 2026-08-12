import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// Reliability foundations (Section 9 of the plan).
//
// journal_mode=WAL is set once, permanently, via a migration
// (prisma/migrations/20260809032226_enable_wal_mode) rather than here —
// unlike busy_timeout, it's a durable property of the database file, not a
// per-connection setting.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// busy_timeout: how long SQLite itself waits/retries internally before
// giving up on a locked database and surfacing an error. better-sqlite3
// calls this option "timeout" (it maps straight to sqlite3_busy_timeout);
// 5000ms is also better-sqlite3's own default — set explicitly so it's
// documented and deliberately tunable, not an unstated default.
const BUSY_TIMEOUT_MS = 5000;

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
  timeout: BUSY_TIMEOUT_MS,
});

const basePrisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = basePrisma;
}

// Retry-with-backoff on top of busy_timeout (Section 9's "Database
// resilience"): busy_timeout already makes SQLite wait up to 5s internally
// before failing, so hitting this path at all means contention outlasted
// that whole window — genuinely rare for an office-sized team. A handful of
// short extra attempts covers that rare case; if all of them still fail,
// the caller sees Prisma error P1008 ("Operation has timed out"), which the
// UI layer turns into "The system is busy — please try again in a moment."
// Verified empirically (not guessed): P1008 is the real error Prisma
// surfaces for exhausted SQLite lock contention through this driver
// adapter, not a raw SQLITE_BUSY code.
const RETRY_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [100, 300, 900];

function isLockTimeout(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P1008"
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const prisma = basePrisma.$extends({
  name: "busy-retry",
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        let lastError: unknown;
        for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
          try {
            return await query(args);
          } catch (error) {
            lastError = error;
            if (!isLockTimeout(error) || attempt === RETRY_ATTEMPTS - 1) {
              throw error;
            }
            await sleep(RETRY_DELAYS_MS[attempt]);
          }
        }
        throw lastError;
      },
    },
  },
});
