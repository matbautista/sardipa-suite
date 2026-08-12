#!/usr/bin/env node
// Assembles the self-contained, copy-paste-portable deployment folder
// (Section 8 of the plan / Section 10 phase 17). Run with: npm run package
//
// Builds on Next.js's `output: "standalone"` (next.config.ts), which
// produces `.next/standalone` — a traced server.js plus a minimal
// node_modules. That trace has real gaps this script has to fix up, found
// by actually inspecting a build's output rather than assuming the trace
// is complete:
//
//   - better-sqlite3 is a native addon (prebuilt .node binaries under
//     prebuilds/, not something `require()` static analysis can fully
//     follow). The Next.js server's own DB access goes through
//     @prisma/adapter-better-sqlite3's own nested, complete copy of
//     better-sqlite3 and works fine — but scripts/watchdog.mjs imports the
//     top-level `better-sqlite3` package directly (to write RestartEvent
//     rows without needing the full Prisma Client at runtime), and the
//     trace only copies that top-level package's package.json, not its
//     prebuilt binary. Confirmed by inspecting `.next/standalone/
//     node_modules/better-sqlite3` after a real build: no `prebuilds/`
//     directory. Fixed by copying the real package over it.
//   - The trace also swept up files that must never ship: this project's
//     own `.env` (real secrets) and a stray dev-uploaded document from
//     `./dev-storage` (a relative path referenced in source, apparently
//     enough for the tracer to include it defensively). Both confirmed
//     present in a real build's `.next/standalone` output. Deleted below;
//     a fresh `.env` with a newly generated AUTH_SECRET is written instead
//     — this is also where Section 7's "app-level encryption key ...
//     generated on first run and stored in a local .env file" actually
//     happens for a packaged release, since nothing else in this app
//     generates one.
//   - Same root cause bites a second way if a previous `release/` folder
//     is still sitting on disk when `next build` runs: the trace copies
//     it too — nested `.next/standalone/release/saripda-suite/...`, its
//     own `.env` and generated AUTH_SECRET included. Confirmed by
//     re-running this script back to back without clearing `release/`
//     first. Deleted below alongside the other two for the same reason.
//
// A fresh, already-migrated, empty database is created via `prisma
// migrate deploy` against a temp DATABASE_URL — not shipped inside the
// standalone trace at all — so the packaged app boots straight to
// /setup (Section 10 phase 3) on first run, same as any fresh install.
//
// This script itself needs the full dev toolchain (next build, prisma
// CLI) — it's meant to run on a build/dev machine, never on the target
// deployment PC.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STANDALONE_DIR = path.join(PROJECT_ROOT, ".next", "standalone");
const RELEASE_DIR = process.env.RELEASE_DIR
  ? path.resolve(process.env.RELEASE_DIR)
  : path.join(PROJECT_ROOT, "release", "saripda-suite");

function log(message) {
  console.log(`[package] ${message}`);
}

const IS_WINDOWS = process.platform === "win32";

// Windows can't exec a .cmd file (npm.cmd, npx.cmd) without a shell
// interpreter — same issue and fix as scripts/watchdog.mjs's own
// child-process spawning. shell:true with a single joined command string
// (not shell+args array, which Node deprecates as of DEP0190) is safe
// here since every argument this script passes is hardcoded, never
// end-user input.
function run(command, args, options = {}) {
  if (IS_WINDOWS) {
    execFileSync(`${command} ${args.join(" ")}`, { stdio: "inherit", cwd: PROJECT_ROOT, shell: true, ...options });
  } else {
    execFileSync(command, args, { stdio: "inherit", cwd: PROJECT_ROOT, ...options });
  }
}

function main() {
  log("Building (npm run build)...");
  run("npm", ["run", "build"]);

  if (!fs.existsSync(STANDALONE_DIR)) {
    throw new Error(`Expected ${STANDALONE_DIR} after build — is output: "standalone" set in next.config.ts?`);
  }

  // Safety check before any rm -rf-shaped operation below: RELEASE_DIR must
  // resolve inside this project's own release/ folder (or an explicit
  // override), never something unrelated a typo'd RELEASE_DIR could hit.
  const defaultReleaseParent = path.join(PROJECT_ROOT, "release");
  if (!RELEASE_DIR.startsWith(defaultReleaseParent) && !process.env.RELEASE_DIR) {
    throw new Error(`Refusing to write outside ${defaultReleaseParent} without an explicit RELEASE_DIR override.`);
  }

  log(`Resetting release folder: ${RELEASE_DIR}`);
  fs.rmSync(RELEASE_DIR, { recursive: true, force: true });
  fs.mkdirSync(RELEASE_DIR, { recursive: true });

  log("Copying standalone server output...");
  fs.cpSync(STANDALONE_DIR, RELEASE_DIR, { recursive: true });

  log("Copying static assets and public/...");
  fs.cpSync(path.join(PROJECT_ROOT, ".next", "static"), path.join(RELEASE_DIR, ".next", "static"), { recursive: true });
  fs.cpSync(path.join(PROJECT_ROOT, "public"), path.join(RELEASE_DIR, "public"), { recursive: true });

  log("Removing files the trace shouldn't have included (leaked .env, stray dev-storage upload, a stale nested release/)...");
  fs.rmSync(path.join(RELEASE_DIR, ".env"), { force: true });
  fs.rmSync(path.join(RELEASE_DIR, "dev-storage"), { recursive: true, force: true });
  fs.rmSync(path.join(RELEASE_DIR, "release"), { recursive: true, force: true });

  log("Replacing the traced better-sqlite3 (missing its prebuilt binary) with the real package...");
  const releaseBetterSqlite3 = path.join(RELEASE_DIR, "node_modules", "better-sqlite3");
  fs.rmSync(releaseBetterSqlite3, { recursive: true, force: true });
  fs.cpSync(path.join(PROJECT_ROOT, "node_modules", "better-sqlite3"), releaseBetterSqlite3, { recursive: true });

  log("Ensuring the process supervisor script is present...");
  fs.mkdirSync(path.join(RELEASE_DIR, "scripts"), { recursive: true });
  fs.cpSync(path.join(PROJECT_ROOT, "scripts", "watchdog.mjs"), path.join(RELEASE_DIR, "scripts", "watchdog.mjs"));

  const dbFileName = "agency-crm.db";
  const dbPath = path.join(RELEASE_DIR, dbFileName);
  log(`Applying migrations to a fresh, empty ${dbFileName}...`);
  run("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  });

  log("Writing a fresh .env (new AUTH_SECRET — see this file's header comment)...");
  const authSecret = crypto.randomBytes(32).toString("base64");
  fs.writeFileSync(
    path.join(RELEASE_DIR, ".env"),
    `# Generated by scripts/package-release.mjs on ${new Date().toISOString()} — do not commit.\n` +
      `DATABASE_URL="file:./${dbFileName}"\n` +
      `AUTH_SECRET="${authSecret}"\n` +
      `\n` +
      `# Process supervisor / storage-health tuning — optional, sensible defaults.\n` +
      `# See scripts/watchdog.mjs and src/lib/storage-health.ts, and Section 9 of\n` +
      `# insurance-crm-plan.md for the reasoning.\n` +
      `# WATCHDOG_HEALTH_CHECK_FAIL_WINDOW_MS=75000\n` +
      `# WATCHDOG_RESTART_LOOP_THRESHOLD=3\n` +
      `# STORAGE_LOW_SPACE_THRESHOLD_BYTES=524288000\n` +
      `# STORAGE_LOW_SPACE_USED_PERCENT=90\n` +
      `# STORAGE_HEALTH_CHECK_INTERVAL_MS=300000\n`
  );

  log("Writing start scripts...");
  // WATCHDOG_START_COMMAND/ARGS point the supervisor at `node server.js`
  // directly — the packaged node_modules has no `next` CLI binary, only
  // what server.js itself needs (Section 8: "run with `node server.js`").
  fs.writeFileSync(
    path.join(RELEASE_DIR, "start.bat"),
    `@echo off\r\n` +
      `set WATCHDOG_START_COMMAND=node\r\n` +
      `set WATCHDOG_START_ARGS=server.js\r\n` +
      `node scripts\\watchdog.mjs\r\n`
  );
  fs.writeFileSync(
    path.join(RELEASE_DIR, "start.sh"),
    `#!/bin/sh\n` +
      `export WATCHDOG_START_COMMAND=node\n` +
      `export WATCHDOG_START_ARGS=server.js\n` +
      `exec node scripts/watchdog.mjs\n`
  );
  fs.chmodSync(path.join(RELEASE_DIR, "start.sh"), 0o755);

  log("");
  log(`Done. Release folder: ${RELEASE_DIR}`);
  log("Before go-live (Section 8): a secondary drive for documents, full-disk");
  log("encryption on the host + every storage-location drive + backup destination,");
  log("a static IP set at the OS/router level, and that same IP entered on the");
  log("System Configuration page (Super Admin > System configuration) once running.");
  log("See DEPLOYMENT.md for the full checklist.");
}

main();
