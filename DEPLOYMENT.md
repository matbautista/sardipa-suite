# Deployment Guide

Self-hosted, LAN-only, copy-paste-portable deployment (Section 8 of
`insurance-crm-plan.md`). This document is the operational checklist;
Section 8 has the full reasoning behind each item.

## 1. Prerequisites (before packaging)

- A secondary drive is available on the host — a second internal drive
  (recommended), an external drive, or a network path/NAS. This is where
  documents will live; the first-run wizard (`/setup`) won't finish
  without a path on a genuinely different disk from the app itself.
- Full-disk encryption is enabled on **every** drive that will hold app
  data: the host's own drive (BitLocker on Windows, FileVault on Mac,
  LUKS on Linux), every document storage-location drive, and whatever
  drive backups land on. This is a one-time OS-level step per drive, done
  *before* any real data is copied onto it — not an app feature.
- The host machine has a **static IP** set — either directly on the
  machine or reserved for it in the router's DHCP settings — so its
  address never changes on reboot.

## 2. Build and package

On a build/dev machine (needs the full toolchain — this is *not* run on
the target deployment PC):

```sh
npm install
npm run package
```

This runs `next build` (producing `.next/standalone`), then
`scripts/package-release.mjs` assembles `release/saripda-suite/` — the
actual self-contained folder to copy to the host:

- `server.js` + a minimal, traced `node_modules` (no `next` CLI needed to
  run it — just `node server.js`)
- `public/`, `.next/static/` (static assets)
- `scripts/watchdog.mjs` (the process supervisor) and `scripts/backup.mjs`
- `agency-crm.db` — freshly created and fully migrated, but **empty**: the
  packaged app boots straight to `/setup` on first run, same as any fresh
  install
- A freshly generated `.env` (new `AUTH_SECRET`, `DATABASE_URL` pointing
  at `agency-crm.db`) — never the build machine's own dev `.env`
- `start.bat` (Windows) / `start.sh` (POSIX) — the actual entry point,
  running the app under `scripts/watchdog.mjs`'s supervision rather than
  bare `node server.js`, so a crash gets auto-restarted (Section 9)

The script also fixes up two real gaps in Next's own file trace, found by
inspecting an actual build's output rather than assuming it was complete
— see the comments at the top of `scripts/package-release.mjs`: the
trace's copy of `better-sqlite3` is missing its prebuilt native binary
(fixed by copying the real package over it), and it separately swept in
this project's own `.env` and a stray dev-uploaded file (deleted).

## 3. First deployment

1. Copy `release/saripda-suite/` to the host machine — anywhere on its
   own drive is fine; this is the "app folder."
2. Run `start.bat` (Windows) or `sh start.sh` (POSIX) from inside that
   folder.
3. Visit `http://localhost:<port>` (default 3000) on the host itself —
   lands on `/setup`. Create the Super Admin account, then choose the
   document storage path on the secondary drive from step 1.
4. Sign in, go to **Super Admin → System configuration**, and enter the
   host's static IP (and port, if not 3000) from step 1 — this is what
   the app displays as the LAN URL for other PCs to reach it at
   (`http://<that-ip>:<port>`).
5. From another PC on the same LAN, browse to that address and confirm
   the login page loads.
6. Set up **Super Admin → Manage agencies** (create the agency + its
   first Agency Head) and hand off from there — the Head creates their
   own Managers/Agents (Section 5).

## 4. Ongoing backups

```sh
node scripts/backup.mjs <destination-path>
```

Run from inside the app folder (or set `APP_DIR`). Copies the database
(via SQLite's online backup API — safe to run while the app is live),
`.env`, and every configured storage location's actual documents into a
timestamped folder under `<destination-path>`.

Schedule this regularly (Windows Task Scheduler, cron, etc.) pointed at
an **encrypted** backup destination — an encrypted external drive, or an
encrypted archive if the destination media isn't otherwise trusted. An
unencrypted backup undoes the host's own full-disk encryption from step 1.

## 5. Moving to a new PC

1. Stop the app (`Ctrl+C` in the console running `start.bat`/`start.sh` —
   see `scripts/watchdog.mjs`'s own header comment for why this matters
   more than it sounds on Windows specifically).
2. Copy the whole app folder (code + `agency-crm.db` + `.env`) to the new
   machine.
3. Physically move (or re-point) each storage-location drive to the new
   host — the documents themselves live outside the app folder, on their
   own drive(s).
4. Enable full-disk encryption on the new host's drive (and any newly
   added storage-location drives) **before** copying data onto them, not
   after.
5. Run `start.bat`/`start.sh` on the new machine. Update **System
   configuration** if the new host's IP differs from the old one.

## 6. Network & firewall

- Plain HTTP is fine for LAN-only use — no TLS cert needed. If remote/
  internet access is ever added, put it behind a reverse proxy (Caddy,
  Nginx) with a real cert first (Section 8's "Future path").
- Only the app's port needs to be reachable from the LAN — nothing else
  needs opening on the router/internet-facing firewall.

## 7. Growing storage

When a storage location starts filling up (the System Health page,
**Super Admin → System health**, flags this at 90% used or under
~500MB free — Section 9), add a new one from the Agency's document
storage settings rather than repointing the existing one: existing
documents keep working from wherever they already are, only new uploads
go to the newly added location.
