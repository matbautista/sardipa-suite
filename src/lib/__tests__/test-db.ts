import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Shared by *.test.ts files that need a real, freshly migrated SQLite
// database (currently just tenant-db.test.ts) rather than mocks — tenant-db
// is a Prisma Client extension, so the only faithful way to test it is
// against a real Prisma Client and a real database file.
//
// Not itself a *.test.ts file, so node's test runner won't try to run it.

const PROJECT_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../..");

export interface TestDatabase {
  url: string;
  dir: string;
}

/**
 * Creates a fresh SQLite file in a temp directory and applies every Prisma
 * migration to it synchronously, so it's ready to use as soon as this
 * returns. Callers must set `process.env.DATABASE_URL = db.url` themselves,
 * before dynamically importing anything that transitively imports
 * `@/lib/prisma` — that module reads `DATABASE_URL` once, at import time.
 */
export function setupTestDatabase(): TestDatabase {
  const dir = mkdtempSync(path.join(tmpdir(), "saripda-test-"));
  const url = `file:${path.join(dir, "test.db")}`;

  execFileSync(
    process.execPath,
    [path.join(PROJECT_ROOT, "node_modules/prisma/build/index.js"), "migrate", "deploy"],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DATABASE_URL: url },
      stdio: "ignore",
    }
  );

  return { url, dir };
}

export function teardownTestDatabase(db: TestDatabase): void {
  rmSync(db.dir, { recursive: true, force: true, maxRetries: 3 });
}
