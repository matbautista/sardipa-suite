# Saripda Suite

A lead-to-sale tracking CRM for insurance agencies — leads, policies, renewals, and dashboards for Sales Agents, Sales Managers, and Agency Heads, self-hosted on a single office PC.

## Status

**Phases 1–9 are in place** (Section 10 of the plan): scaffold, reliability foundations, first-run setup wizard, auth & tenant scoping, Super Admin agency onboarding, Agency Head's own agency setup, Leads CRUD, record locking, and Policies — general. Phase 10 onward (Life detail forms, other lines' checklists, Manager/Head cross-visibility, dashboards, etc.) aren't built yet. The full spec lives in [`insurance-crm-plan.md`](./insurance-crm-plan.md) (currently Baseline v1.4) and remains the source of truth for everything not yet built.

What phase 9 actually added:
- **Convert a Won lead into a policy** (`/policies/new?leadId=...`, reachable from a Won lead's own detail page) — creates a `draft` Policy with line/product pre-filled from the lead where set. Creation is lead-conversion only for this phase; the schema allows a policy with no `leadId` ("a walk-in renewal or a migrated legacy policy"), but building a UI for that wasn't part of this phase's explicit deliverable
- **Document upload & storage** (`src/lib/documents.ts`) — PDF/JPG/PNG up to 5MB, written to the active `StorageLocation` at `{agencyId}/{policyId}/{documentId}.{ext}` (the document's own UUID as the filename, never the uploaded name), served back only through an authenticated route (`/api/documents/[id]`) that re-checks agency + policy-ownership against the `Document` row before ever touching disk. Server Actions cap request bodies at 1MB by default — bumped to 6MB in `next.config.ts` to fit the plan's 5MB file limit with headroom. Client-side image compression (resize/compress before upload) is a recommendation in the plan, not a hard requirement, and isn't built — only the 5MB hard cap is enforced
- **The explicit Activate action** — gated on a Proof of Payment document being attached (`Policy.proofOfPaymentDocId`). The plan also gates this on the line's full minimum-required-info (Section 11), but that's the structured Life/Auto/Property/Health/Travel forms from phases 10-11, which don't exist yet — so Proof of Payment is the one requirement this phase can actually enforce; the code comments this explicitly rather than silently under-implementing the gate
- **The daily renewal/lapsing job** (`src/lib/renewal-job.ts`, scheduled from `src/instrumentation.ts` — Next.js's server-startup hook, since this app has no separate cron process) implements all three rules from Section 5's table: non-life/Term lapse immediately, non-term-traditional Life enters a 30-day `grace_period`, VUL never lapses off `renewalDate` at all, and Travel policies move straight to `completed` at their trip end date. Verified for real, not just by reading the code: seeded one test policy per category with a past-due `renewalDate`, restarted the server (which runs the job once at boot, not just on the 24h interval), and confirmed every one landed in the correct status — including the grace-period math (`gracePeriodEndsAt` = `renewalDate` + 30 days exactly) and the VUL policy being left untouched
- **The Renewal/Payment action** — requires a new Proof of Payment upload, then reactivates to `active` with the new `renewalDate` computed differently depending on origin: one year forward from the *original* `renewalDate` when coming from `grace_period` (so a mid-window payment doesn't shift the yearly anniversary), one year forward from *today* when coming from `lapsed`. Both branches verified live with distinct dates chosen specifically so the two computations couldn't coincidentally produce the same answer
- Record locking (phase 8) applies to Policies exactly like Leads — same `record-lock.ts`, just a different `recordType`. Verified live that a lock held by another user renders the policy read-only too, not just leads
- **A real gap this phase exposed and fixed**: `prisma/seed.ts` never had `policy.deleteMany()`/`document.deleteMany()` in its idempotent reset, since neither table had real data before this phase. Left as-is, a second `npm run db:seed` after any Policy existed would fail with a foreign-key violation trying to delete `Product`/`InsuranceLine` out from under it. Fixed — including nulling `Policy.proofOfPaymentDocId` first to break the `Policy`↔`Document` circular reference before either table can be cleared
- **Not built yet, deliberately**: `Policy.vulFundBalance` updates (Section 5 describes this as "a figure an agent/admin updates periodically," not a phase 9 checklist item — VUL policies just display whatever balance exists, with a note that periodic updates aren't wired up); a Cancel action (the `cancelled` status exists in the schema and the lapsing rules account for it, but no phase 9 deliverable asked for a UI to set it)

What phase 8 actually added:
- **Record locking** (`src/lib/record-lock.ts`) — opening a lead's edit page (`/leads/[id]`) checks it out; if someone else already holds it (and the lock isn't stale), the page renders read-only instead — a dimmed, genuinely non-interactive form (native `inert` attribute, not just `disabled` inputs) with a "Currently being edited by X, since TIME" notice, and the Delete control hidden. A lock auto-releases after 15 minutes of inactivity, and is explicitly checked in on Save or on the "Back to my leads" action (a server action now, not a plain link, specifically so it can check in before navigating away)
- **A real, deliberate scope decision, not an oversight**: the Manager/Head force-release override from Section 5 is *not* built yet, on purpose — there's no page yet where a Manager/Head can even reach another agent's lock to release it (that needs phase 12's cross-agent visibility), so a button for it would have no reachable target. `record-lock.ts`'s own comment explains this, and it's a clean, obvious addition once phase 12 lands
- Since only a lead's owner can reach its own edit page today (phase 7's scoping), there's no way to organically produce a same-lead two-different-people conflict yet either — verified the read-only branch and the stale-lock auto-release both work correctly anyway, by inserting/backdating a `RecordLock` row directly in the dev database and confirming the page reacted correctly, rather than skipping that test because the UI can't produce the scenario on its own yet
- Flagged for review, not silently decided: this phase's design leans on Phase 7 having scoped Leads CRUD to "owner only" for every role. Section 3 actually permits Manager/Head to edit *any* team/agency record, but that's gated behind phase 12's visibility work — see the phase 7 entry below for the reasoning already applied there

What phase 7 actually added:
- **`/leads`** and **`/leads/[id]`** — every agency role (Agent, Manager, Head) can add, edit, and delete their own leads and move them through the pipeline (`new → contacted → quoted → negotiating → won/lost`). Deliberately scoped to "my own leads" only for all three roles: Section 3's cross-agent visibility (a Manager seeing their team, a Head seeing the whole agency) is explicitly a later phase (12), not this one, so ownership here is always the calling user's own id regardless of role
- Picking a **Product** on the lead form derives its **Insurance line** automatically (`resolveLineAndProduct` in `src/lib/leads.ts`) rather than validating the two selects agree — same "derive, don't validate a redundant field" approach as phase 6's `insurance-lines.ts`
- Ownership is enforced on top of tenant-scoping, not instead of it: `getScopedPrisma` already confines every query to the caller's agency, and `getOwnLead`/`updateLead`/`deleteLead` add a second check (`lead.ownerId === callerId`) on top — verified live with two different agents, where one correctly got a 404 opening the other's lead by URL
- Found and fixed a bug the same day it shipped, before any commit: the dashboard's "your leads" preview and the `/leads` list both went stale after a `db:seed` reset while an old login session (JWT) was still active, because the session's `user.id` pointed at a cuid from the previous seed run that no longer existed. Not a code bug — a NextAuth JWT is a point-in-time snapshot (same fact already noted in phase 5 about `mustChangePassword`) — but worth knowing if leads seem to vanish after reseeding: sign out and back in for a fresh session bound to current data
- Applied last night's phase-6 lesson pre-emptively this time: both the line and product `<select>` elements on the edit form are keyed on their current value (`key={lead.lineId ?? "none"}` / `key={lead.productId ?? "none"}`), so a save-triggered `revalidatePath` re-initializes the visible selection instead of leaving React's uncontrolled-input state stale — the exact class of bug fixed in phase 6's manager-reassignment dropdown

What phase 6 actually added:
- **`/agency/lines`** (Agency Head only, enforced in `src/proxy.ts` and defense-in-depth via `requireHeadSession` in `src/lib/session.ts`) — configure the agency's own insurance lines (free-text `name`, fixed `category` the rest of the app's logic keys off of) and products under each line. `lifePolicyType` (term / non-term traditional / VUL) only applies to `category: "life"` lines and is silently dropped for others rather than erroring, since the form doesn't even show the field for them
- **`/agency/users`** — Agency Head creates Manager and Agent accounts (with agents optionally assigned a manager at creation or reassigned later), resets their passwords, and deactivates/reactivates them. Reuses the exact same one-time-temporary-password mechanism from phase 5's Super-Admin-creates-Head flow (`src/lib/password-policy.ts`), not a second one
- These two pages intentionally use two different form patterns for the same reason phase 5 picked `useActionState`: **insurance lines/products don't need to show a one-time secret**, so their forms are the plain server-action-in-a-Server-Component pattern (works without JS, redirects with an error in the query string on failure) — while **account creation and password reset do** need to display a secret inline without a redirect, so those stay `useActionState` client components, matching phase 5's form exactly
- Deactivate/reactivate and manager-reassignment are plain server actions too (`toggleActiveAction`, `reassignManagerAction` in `src/app/agency/users/actions.ts`) — no one-time secret involved, so no reason to reach for `useActionState` there either
- An Agency Head can never target themselves or another Head through any of these actions: `resetAgencyUserPassword`/`setAgencyUserActive` in `src/lib/agency-users.ts` only ever match `role === "manager" || "agent"`, which rules out self-lockout implicitly rather than needing an explicit "not yourself" check
- Prisma's generated `*CreateInput` types for tenant-scoped models (`InsuranceLine`, `Product`) require `agencyId` explicitly even though `getScopedPrisma`'s runtime extension always overwrites it anyway — see the comment in `src/lib/insurance-lines.ts` for why it's included redundantly rather than fought

What phase 5 actually added:
- **`/admin/agencies`** (Super Admin only, enforced in `src/proxy.ts`) — create an agency and its first Agency Head account together, atomically (`prisma.$transaction`, so a duplicate-email failure can't leave a headless agency behind — verified for real, not just by reading the code)
- **Temporary passwords** (`src/lib/password-policy.ts`): shown once on screen after creation, never persisted anywhere in plaintext beyond that response. A new `User.mustChangePassword` flag (migration `20260809134512`) forces the recipient to `/change-password` before anything else — same "block everything until this one thing is done" shape as the setup gate. After a successful change, the user is signed out and must log in again for a fresh JWT, rather than trying to patch the already-issued session token in place
- The create-agency form uses React 19's `useActionState` (a client component) instead of the plain server-action-in-a-Server-Component pattern the other forms use, since it needs to show the one-time temporary password inline without a redirect that would expose it in a URL. Worth knowing if you touch this form: it needs real JS/hydration to work at all (renders with an empty `action=""` without it, unlike the progressive-enhancement fallback the other forms get for free), and React resets all the fields after any submission — including a failed one — which is default framework behavior, not something this code opted into

What phase 3 actually added:
- **`/setup`** — blocks every route (via `src/proxy.ts`) until it's done: create the Super Admin account, then choose a document storage location on a different physical disk than the app. Once both exist, `SystemConfig.setupCompletedAt` is set and `/setup` redirects to `/login` from then on (re-checked, cached in memory after the first `true` so it isn't a DB hit on every request forever)
- **The "different disk" check** (`src/lib/storage-path.ts`) — Windows compares drive letters (a UNC/network path always passes automatically, since it can never be the same physical disk), POSIX compares the filesystem device id. Tested for real, not just by reading the code: created a synthetic second drive letter with Windows' `subst` to force a genuine cross-drive comparison, confirmed the same-disk case is correctly rejected and the different-disk case correctly succeeds (directory gets created and write-tested), and confirmed the hint text correctly names the app's actual drive
- Building this exposed that `auth` from NextAuth isn't callable as `auth(request)` directly — it only works that way when exported as *the* proxy function with nothing wrapping it. Needing the setup-gate to run first meant wrapping a custom callback (`auth((req) => ...)`) instead, which bypasses `authConfig`'s `authorized` callback entirely — so the login-redirect logic that used to live there now lives directly in `proxy.ts` instead
- The seed script now also completes setup (a local `./dev-storage` folder, no real disk-separation needed for dev data) — otherwise every fresh `npm run dev` would land on `/setup` instead of `/login`, contradicting this README
- Found two real bugs by testing beyond dev mode, one of them severe:
  - **Login was completely broken under `next start` (production mode)** — every credentials login failed with a 500 (`UntrustedHost`). NextAuth requires either a trusted-platform host header (Vercel, etc.) or an explicit opt-in; this app is always self-hosted, so it never had either. `npm run dev` never surfaced this at all — this is a repeat of the exact lesson from `proxy.ts`'s Next.js 16 rename: **`npm run build` + `npm run start` is required to trust that a change actually works**, not just `npm run dev`. Fixed with `trustHost: true` in `src/auth.config.ts`.
  - **A genuine race condition** in `addInitialStorageLocation` (check-then-act on "is there already an active storage location," no transaction between the two) — reproduced it for real with two genuinely concurrent requests against two synthetic Windows drives, though the first attempt didn't happen to trigger it (lucky timing, not safety). Closed at the database level with a partial unique index (`StorageLocation(isActive) WHERE isActive = 1`, migration `20260809055955`) rather than relying on the application-level check, then re-verified under real concurrency that it now fails safely with a friendly error instead of either duplicating the row or throwing an unhandled 500

What phase 2 actually added:
- **WAL mode**, set once via a migration since (unlike `busy_timeout`) it's a durable property of the database file itself, not a per-connection setting
- **`busy_timeout` set explicitly** (5000ms) on the SQLite driver adapter
- **Retry-with-backoff on top of that** (`src/lib/prisma.ts`) — verified empirically that SQLite lock contention surfaces through this Prisma/adapter combination as error code `P1008` ("Operation has timed out"), not a raw `SQLITE_BUSY`; 3 attempts with short backoff between them, tested by actually holding a write lock across process boundaries long enough to force real contention, both the success and exhausted-retries cases
- **`GET /api/health`** — public (excluded from the auth gate in `src/proxy.ts`), checks real DB connectivity
- **`scripts/watchdog.mjs`** — the process supervisor: polls `/api/health`, restarts the app on a sustained failure window or an outright crash, and stops auto-restarting (writing a `SystemAlert`) after repeated restarts in a short window. Run via `npm run start:supervised`. Verified live, not just read through: crash detection, the health-check-failure path, restart-loop protection triggering at the configured threshold, and — this caught a real bug — a race condition where killing a child during a deliberate restart also fired the original "unexpected exit" handler, triggering a second overlapping restart and `EADDRINUSE` chaos. Fixed and re-verified. See the file's own header comment for a known Windows limitation around how it must be stopped to avoid orphaning the app process.

What phase 4 actually added:
- **Auth.js (NextAuth v5)** with a Credentials provider — email/password checked against `User.passwordHash` (bcrypt)
- **Login security baseline** (Section 5): 10-char minimum enforced wherever passwords are set (not yet — there's no set-password UI yet, only the seed script), and lockout after 5 consecutive failed attempts for 15 minutes, tracked on `User.failedLoginAttempts`/`lockedUntil`
- Every login attempt (success, failure, or attempted-while-locked) is written to `ActivityLog`
- **Session carries `agencyId` and `role`** (Section 7), via JWT so `src/proxy.ts` can check it without a DB call on every request
- **`src/proxy.ts`** blocks every route except `/login` for unauthenticated requests (this is Next.js 16's renamed `middleware.ts` convention — see the note below)
- **`src/lib/tenant-db.ts`** — the centralized tenant-scoping data-access layer Section 2 asks for: `getScopedPrisma(agencyId)` returns a Prisma Client where every operation on a tenant-scoped model is confined to that one agency automatically. Single-record operations (`findUnique`/`update`/`delete`) verify ownership before running, not after, so a cross-tenant id is never fetched, updated, or deleted — see the comment at the top of that file for the exact mechanism and its one real caveat (nested relation writes aren't auto-scoped)
- A minimal `/dashboard` page proving it end-to-end: Super Admin sees every agency; an agency user sees only their own agency's leads, fetched through the scoped client

A few items in the plan's Section 12 still need confirmation before or during the build (draft insurance-line field lists, the legal data-retention period, and some external logistics like drive sourcing and trademark clearance) — see that section for the current list.

**Note on the Next.js version**: this scaffold used Next.js 16, which is new enough that its own generated `AGENTS.md` warns that App Router conventions may differ from older training data. Before writing route/page code, check `node_modules/next/dist/docs/` rather than assuming Next 13–15 patterns still apply. Concretely: Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts` (default export or a named `proxy` export required — `npm run dev` didn't catch this, only `npm run build` did) and changed its default runtime from Edge to Node.js. **Always run a production build, not just `npm run dev`, before calling a change done** — dev mode silently tolerated the old `middleware.ts` file with no warning.

## Tech stack (as actually scaffolded)

- **Frontend**: Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- **Database**: SQLite via Prisma ORM 7, using the `@prisma/adapter-better-sqlite3` driver adapter (required in Prisma 7 — there's no more built-in native engine binary)
- **Password hashing**: bcryptjs
- **Auth**: Auth.js (`next-auth@beta`, v5) — Credentials provider, JWT sessions
- Charts (Recharts) aren't wired up yet — see Section 7 of the plan for the intended stack

SQLite has no native enum type, so every "enum-like" column (`role`, `status`, `category`, etc.) is a plain `String` in `prisma/schema.prisma`, with the allowed values documented in a comment above each field. Validation happens at the application layer once that code exists.

## Setup

1. Install [Node.js](https://nodejs.org/) 22+ (this project was scaffolded on Node 24)
2. Clone the repo and install dependencies:
   ```sh
   git clone https://github.com/matbautista/saripda-suite.git
   cd saripda-suite
   npm install
   ```
3. Copy the environment file and generate a real `AUTH_SECRET`:
   ```sh
   cp .env.example .env
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   # paste the output as AUTH_SECRET in .env
   ```
4. Apply the database schema and seed some sample data:
   ```sh
   npx prisma migrate dev
   npm run db:seed
   ```
   This creates `dev.db` (gitignored) with a Super Admin, two sample agencies (each with a Head, a Manager, agents assigned to that Manager, some products, and a few leads). The seed script prints the shared dev password (`ChangeMe123!`) for every seeded account — every account uses the same one.
5. Start the dev server:
   ```sh
   npm run dev
   ```
   App runs at http://localhost:3000 and immediately redirects to `/login`. Sign in as e.g. `bea.santos@sunriseinsuranceagency.dev` (an agent) or `superadmin@saripda.dev` (Super Admin) to see the difference in `/dashboard`. Emails follow `firstname.lastname@<agency-name-no-spaces>.dev` — check `prisma/seed.ts` or `npm run db:studio` for the full list.

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run start:supervised` | Run under the process supervisor (`scripts/watchdog.mjs`) — requires `npm run build` first, same as plain `npm run start`. For testing production-like reliability behavior, not everyday dev |
| `npm run db:migrate` | Create/apply a Prisma migration |
| `npm run db:seed` | Re-run the seed script |
| `npm run db:studio` | Open Prisma Studio (database GUI) |
| `npm run lint` | ESLint |

A genuinely fresh install (no seed data) lands on `/setup` first — see "What phase 3 actually added" above.

For production deployment (self-hosted, LAN-only, copy-paste portable), see Section 8 of the plan.

## Contributing

This is a single-agency internal tool, not an open-source project — see the plan document for design rationale before making changes.
