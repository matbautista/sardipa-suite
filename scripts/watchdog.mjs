#!/usr/bin/env node
// Process supervisor / auto-restart wrapper (Section 9 of the plan,
// Section 10 phase 2). Spawns the app, polls /api/health, and restarts the
// app if health checks fail continuously for a configurable window or if
// the process crashes outright. Restart-loop protection stops it from
// restarting forever if the underlying problem isn't something a restart
// can fix.
//
// Deliberately plain Node.js (no TypeScript, no Prisma Client) so it works
// standalone in the packaged deployment folder (Section 8) without needing
// tsx or the generated Prisma Client's TS sources at runtime — it talks to
// SQLite directly via better-sqlite3, which is already a project
// dependency, for the one thing it needs to write: RestartEvent rows (and,
// on restart-loop, a SystemAlert row).
//
// Run with: node scripts/watchdog.mjs
// Configuration is via environment variables, all optional (see DEFAULTS).
//
// KNOWN LIMITATION (Windows): to stop this cleanly — so it also stops the
// app it's supervising, rather than orphaning it — use Ctrl+C in the
// console it's running in (SIGINT), not Task Manager "End Task" or a bare
// `taskkill /F`. Verified empirically: Windows refuses a non-forceful
// `taskkill` against a headless Node process outright ("can only be
// terminated forcefully"), and force-killing just this process leaves its
// child (the actual app server) running and still holding the port —
// Windows doesn't tie child process lifetime to the parent's without a Job
// Object, which Node doesn't expose without a native addon. A real
// production deployment should run this under a proper Windows service
// wrapper (e.g. NSSM) that understands process trees, rather than a bare
// console window. POSIX (systemd, Docker, etc.) doesn't have this problem —
// SIGTERM to this process is delivered and handled normally.

import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";

// Load .env from the current directory before anything reads process.env
// below — found missing during phase 17's actual deployment testing: this
// script previously never loaded .env at all (unlike `next dev`/`next
// build`/`next start`, which load it internally), so DATABASE_URL silently
// fell back to DEFAULTS.DATABASE_URL below whenever it didn't happen to
// match. That was invisible in dev (the default, "file:./dev.db", happens
// to match the dev database's own name) but broke silently in the packaged
// release (scripts/package-release.mjs's database is "agency-crm.db") —
// RestartEvent/SystemAlert writes below all failed with "no such table"
// against a wrong, auto-created empty file, caught by their own try/catch
// and logged as non-fatal, so nothing crashed but restart history and the
// restart-loop alert were silently never actually recorded. Uses Node's
// built-in loader (no dotenv dependency, matching this script's existing
// "must run standalone in the packaged folder" constraint); doesn't
// override any variable already set in the real environment, same as
// dotenv's own convention.
try {
  process.loadEnvFile();
} catch {
  // No .env present — fine if every needed var is already set in the
  // real environment (e.g. a container/service manager injecting them).
}

const IS_WINDOWS = process.platform === "win32";

// Spawns the `next` binary directly rather than going through `npm run
// start` — `npm run <script>` always execs the actual command through an
// intermediate shell (sh -c on POSIX, cmd.exe on Windows), so the process
// we'd get back from spawn() would be that shell, not the Next.js server
// itself. Killing the wrong process would leave an orphaned server behind,
// still holding the port, invisible to future restarts. Going directly to
// the binary avoids one layer of that; killChild() below still uses
// whole-process-tree killing as the robust fallback regardless.
const NEXT_BIN = path.join("node_modules", ".bin", IS_WINDOWS ? "next.cmd" : "next");

const DEFAULTS = {
  // What to run and where to reach it.
  START_COMMAND: NEXT_BIN,
  START_ARGS: "start",
  HEALTH_CHECK_URL: "http://127.0.0.1:3000/api/health",
  DATABASE_URL: "file:./dev.db",

  // How long to let the app boot before the first health check.
  STARTUP_GRACE_MS: 10_000,
  // How often to poll /api/health.
  HEALTH_CHECK_INTERVAL_MS: 15_000,
  // How long health checks must keep failing before we restart (Section 9:
  // "e.g. 60-90 seconds").
  HEALTH_CHECK_FAIL_WINDOW_MS: 75_000,
  // Restart-loop protection (Section 9: "e.g. 3 restarts in 10 minutes").
  RESTART_LOOP_WINDOW_MS: 10 * 60_000,
  RESTART_LOOP_THRESHOLD: 3,
  // How long to wait for graceful shutdown (SIGTERM) before SIGKILL.
  SHUTDOWN_GRACE_MS: 5_000,
};

const config = {
  startCommand: process.env.WATCHDOG_START_COMMAND ?? DEFAULTS.START_COMMAND,
  startArgs: (process.env.WATCHDOG_START_ARGS ?? DEFAULTS.START_ARGS).split(","),
  healthCheckUrl: process.env.WATCHDOG_HEALTH_CHECK_URL ?? DEFAULTS.HEALTH_CHECK_URL,
  databaseUrl: process.env.DATABASE_URL ?? DEFAULTS.DATABASE_URL,
  startupGraceMs: Number(process.env.WATCHDOG_STARTUP_GRACE_MS ?? DEFAULTS.STARTUP_GRACE_MS),
  healthCheckIntervalMs: Number(process.env.WATCHDOG_HEALTH_CHECK_INTERVAL_MS ?? DEFAULTS.HEALTH_CHECK_INTERVAL_MS),
  healthCheckFailWindowMs: Number(
    process.env.WATCHDOG_HEALTH_CHECK_FAIL_WINDOW_MS ?? DEFAULTS.HEALTH_CHECK_FAIL_WINDOW_MS
  ),
  restartLoopWindowMs: Number(process.env.WATCHDOG_RESTART_LOOP_WINDOW_MS ?? DEFAULTS.RESTART_LOOP_WINDOW_MS),
  restartLoopThreshold: Number(process.env.WATCHDOG_RESTART_LOOP_THRESHOLD ?? DEFAULTS.RESTART_LOOP_THRESHOLD),
  shutdownGraceMs: Number(process.env.WATCHDOG_SHUTDOWN_GRACE_MS ?? DEFAULTS.SHUTDOWN_GRACE_MS),
};

function log(message) {
  console.log(`[watchdog ${new Date().toISOString()}] ${message}`);
}

function dbPathFromUrl(url) {
  return url.replace(/^file:/, "");
}

function recordRestartEvent(reason) {
  const db = new Database(dbPathFromUrl(config.databaseUrl));
  try {
    db.pragma("busy_timeout = 5000");
    db.prepare(`INSERT INTO RestartEvent (id, restartedAt, reason) VALUES (?, ?, ?)`).run(
      randomUUID(),
      new Date().toISOString(),
      reason
    );
  } finally {
    db.close();
  }
}

function recordRestartLoopAlert() {
  const db = new Database(dbPathFromUrl(config.databaseUrl));
  try {
    db.pragma("busy_timeout = 5000");
    // Avoid spamming duplicate alerts if this keeps happening — one
    // unresolved restart_loop alert is enough to be "persistent,
    // hard-to-miss" (Section 9); it doesn't need to multiply.
    const existing = db
      .prepare(`SELECT id FROM SystemAlert WHERE type = 'restart_loop' AND resolvedAt IS NULL LIMIT 1`)
      .get();
    if (existing) {
      log("Restart-loop alert already active — not creating a duplicate.");
      return;
    }
    db.prepare(
      `INSERT INTO SystemAlert (id, agencyId, type, message, createdAt) VALUES (?, NULL, 'restart_loop', ?, ?)`
    ).run(
      randomUUID(),
      `The app was restarted ${config.restartLoopThreshold} times within ${Math.round(
        config.restartLoopWindowMs / 60_000
      )} minutes and the supervisor has stopped auto-restarting it. This usually means a restart won't fix the underlying problem (e.g. a corrupted database or a full disk) — it needs manual attention.`,
      new Date().toISOString()
    );
  } finally {
    db.close();
  }
}

class Watchdog {
  constructor() {
    this.child = null;
    this.restartTimestamps = [];
    this.unhealthySince = null;
    this.healthCheckTimer = null;
    this.shuttingDown = false;
    this.startupGraceUntil = 0;
    // Set right before *we* kill the child (restart or shutdown), so the
    // "exit" listener below can tell "we did this on purpose" apart from
    // an actual crash — without it, killChild()'s own kill would also
    // trip the "unexpected exit" handler, triggering a second, overlapping
    // restart for every one we meant to do (caught via testing: this
    // produced cascading EADDRINUSE failures as two `next start`
    // instances both tried to bind :3000 at once).
    this.expectingExit = false;
  }

  start() {
    log(`Starting: ${config.startCommand} ${config.startArgs.join(" ")}`);
    // Windows can't exec a .cmd file without a shell interpreter, which
    // reintroduces a layer of nesting (cmd.exe, then the real process) —
    // handled by killChild()'s use of `taskkill /T` below, which kills the
    // whole tree regardless of how many layers deep the real server ends
    // up. On POSIX, `detached: true` makes the child its own process-group
    // leader so the equivalent whole-tree kill (negative PID) works there.
    // On Windows (shell: true), pass a single pre-joined command string
    // rather than a separate args array — Node deprecated (and warns on)
    // shell+args together (DEP0190), since args aren't escaped in that
    // mode. Fine here regardless: config is operator-supplied (env vars),
    // never end-user input.
    this.child = IS_WINDOWS
      ? spawn(`"${config.startCommand}" ${config.startArgs.join(" ")}`, { stdio: "inherit", shell: true })
      : spawn(config.startCommand, config.startArgs, { stdio: "inherit", detached: true });
    this.startupGraceUntil = Date.now() + config.startupGraceMs;
    this.unhealthySince = null;
    this.expectingExit = false;

    this.child.on("exit", (code, signal) => {
      if (this.shuttingDown || this.expectingExit) return;
      log(`Child process exited unexpectedly (code=${code}, signal=${signal}) — treating as a crash.`);
      this.handleFailure("crash");
    });

    this.child.on("error", (error) => {
      if (this.shuttingDown || this.expectingExit) return;
      log(`Child process failed to start: ${error.message}`);
      this.handleFailure("crash");
    });

    this.scheduleHealthCheck();
  }

  scheduleHealthCheck() {
    clearTimeout(this.healthCheckTimer);
    this.healthCheckTimer = setTimeout(() => this.checkHealth(), config.healthCheckIntervalMs);
  }

  async checkHealth() {
    if (this.shuttingDown) return;

    if (Date.now() < this.startupGraceUntil) {
      this.scheduleHealthCheck();
      return;
    }

    try {
      const response = await fetch(config.healthCheckUrl, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        if (this.unhealthySince) {
          log("Health check recovered.");
        }
        this.unhealthySince = null;
        this.scheduleHealthCheck();
        return;
      }
      throw new Error(`Health check returned HTTP ${response.status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.unhealthySince) {
        this.unhealthySince = Date.now();
        log(`Health check failed: ${message}. Starting failure window.`);
      } else {
        const failingFor = Date.now() - this.unhealthySince;
        log(`Health check still failing (${Math.round(failingFor / 1000)}s): ${message}`);
        if (failingFor >= config.healthCheckFailWindowMs) {
          this.handleFailure("health_check_failed");
          return;
        }
      }
      this.scheduleHealthCheck();
    }
  }

  handleFailure(reason) {
    clearTimeout(this.healthCheckTimer);
    // If the database itself is what's broken (a real possibility — a
    // corrupted DB is exactly the kind of thing that causes repeated
    // crashes), these writes will fail too. That must never take the
    // watchdog down along with the app; the restart still has to happen.
    try {
      recordRestartEvent(reason);
    } catch (error) {
      log(`Failed to record RestartEvent (continuing anyway): ${error instanceof Error ? error.message : error}`);
    }

    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter((t) => now - t < config.restartLoopWindowMs);
    this.restartTimestamps.push(now);

    if (this.restartTimestamps.length >= config.restartLoopThreshold) {
      log(
        `Restart-loop protection triggered: ${this.restartTimestamps.length} restarts within ${Math.round(
          config.restartLoopWindowMs / 60_000
        )} minutes. Stopping auto-restart.`
      );
      try {
        recordRestartLoopAlert();
      } catch (error) {
        log(`Failed to record restart-loop SystemAlert (continuing anyway): ${error instanceof Error ? error.message : error}`);
      }
      this.killChild(() => process.exit(1));
      return;
    }

    log(`Restarting app (reason: ${reason}).`);
    this.killChild(() => this.start());
  }

  killChild(onDone) {
    if (!this.child || this.child.exitCode !== null) {
      onDone();
      return;
    }
    this.expectingExit = true;
    const child = this.child;
    const pid = child.pid;
    this.child = null;

    const killTree = (signal) => {
      if (IS_WINDOWS) {
        // /T = whole tree rooted at this PID, /F = force. Needed regardless
        // of signal — Windows has no SIGTERM equivalent for arbitrary
        // processes, so the first attempt is already a hard kill there.
        try {
          execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"]);
        } catch {
          // Already exited between the exitCode check above and here.
        }
      } else {
        try {
          process.kill(-pid, signal);
        } catch {
          // Already exited, or never got its own process group.
        }
      }
    };

    const forceKillTimer = setTimeout(() => {
      log("Child did not exit after SIGTERM — force-killing the whole process tree.");
      killTree("SIGKILL");
    }, config.shutdownGraceMs);
    child.once("exit", () => {
      clearTimeout(forceKillTimer);
      onDone();
    });
    killTree("SIGTERM");
  }

  shutdown() {
    this.shuttingDown = true;
    clearTimeout(this.healthCheckTimer);
    log("Watchdog shutting down — stopping child process.");
    this.killChild(() => process.exit(0));
  }
}

const watchdog = new Watchdog();
process.on("SIGINT", () => watchdog.shutdown());
process.on("SIGTERM", () => watchdog.shutdown());
watchdog.start();
