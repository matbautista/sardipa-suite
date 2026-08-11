#!/usr/bin/env node
// Backup script (Section 8 of the plan / Section 10 phase 17): "schedule a
// regular copy of the app folder plus every storage location drive to a
// separate backup destination — this is also just a file copy, no DB
// export tooling needed."
//
// "The app folder" is scoped down here to just its *stateful* parts — the
// database file and .env — not a literal copy of the whole folder
// (node_modules, code): those are reproducible from source control / the
// release package, so backing them up on every run would just be waste.
// The database file, .env (Section 7: "losing this file means re-entering
// mailbox credentials, so it's worth including in the backup routine"),
// and every StorageLocation's actual documents are the only things that
// can't be regenerated.
//
// Deliberately plain Node.js + better-sqlite3 directly, same reasoning as
// scripts/watchdog.mjs: this has to run standalone in the packaged
// deployment folder without the full Prisma Client/dev toolchain.
//
// Usage: node scripts/backup.mjs <destination-path>
//   or:  BACKUP_DEST=<destination-path> node scripts/backup.mjs
// Run from the app's own folder (or set APP_DIR). Intended to be called on
// a schedule (Windows Task Scheduler / cron) pointed at an *encrypted*
// backup destination (Section 8) — this script doesn't and can't verify
// that the destination is actually encrypted; that's a one-time OS-level
// setup step on whatever drive BACKUP_DEST points at.

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const APP_DIR = process.env.APP_DIR ? path.resolve(process.env.APP_DIR) : process.cwd();
const BACKUP_DEST = process.env.BACKUP_DEST ?? process.argv[2];

if (!BACKUP_DEST) {
  console.error("Usage: node scripts/backup.mjs <destination-path>  (or set BACKUP_DEST)");
  process.exit(1);
}

function log(message) {
  console.log(`[backup ${new Date().toISOString()}] ${message}`);
}

function dbPathFromEnvFile() {
  const envPath = path.join(APP_DIR, ".env");
  const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const match = envContent.match(/^DATABASE_URL\s*=\s*"?file:(.+?)"?\s*$/m);
  const relative = match ? match[1] : "./agency-crm.db";
  return path.resolve(APP_DIR, relative);
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    log(`  (skipped — path doesn't exist or isn't reachable right now: ${src})`);
    return;
  }
  fs.cpSync(src, dest, { recursive: true });
}

async function main() {
  const dbPath = dbPathFromEnvFile();
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found at ${dbPath} — check APP_DIR / DATABASE_URL.`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destRoot = path.resolve(BACKUP_DEST, `saripda-backup-${timestamp}`);
  fs.mkdirSync(destRoot, { recursive: true });

  log(`Backing up to ${destRoot}`);

  // Online backup API rather than a raw file copy — safe to run while the
  // app is live and writing (WAL mode + this API together avoid ever
  // capturing a torn/inconsistent snapshot, unlike copying the .db file's
  // bytes directly while a write could be mid-flight).
  log("Backing up database (online backup API, safe while the app is running)...");
  const db = new Database(dbPath, { readonly: true });
  const storageLocations = db.prepare("SELECT id, label, path FROM StorageLocation").all();
  await db.backup(path.join(destRoot, "agency-crm.db"));
  db.close();

  const envPath = path.join(APP_DIR, ".env");
  if (fs.existsSync(envPath)) {
    log("Backing up .env...");
    fs.copyFileSync(envPath, path.join(destRoot, ".env"));
  }

  log(`Backing up ${storageLocations.length} storage location(s)...`);
  for (const location of storageLocations) {
    const safeLabel = location.label.replace(/[^a-z0-9_-]+/gi, "_");
    const target = path.join(destRoot, "documents", `${safeLabel}-${location.id}`);
    log(`  ${location.label} (${location.path}) -> ${target}`);
    copyDirRecursive(location.path, target);
  }

  log("Backup complete.");
  log("Reminder (Section 8): the backup destination itself must be encrypted —");
  log("an encrypted external drive, or an encrypted archive if the media isn't");
  log("trusted. An unencrypted backup undoes the host's own full-disk encryption.");
}

main().catch((error) => {
  console.error(`[backup] failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
