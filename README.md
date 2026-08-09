# Saripda Suite

A lead-to-sale tracking CRM for insurance agencies — leads, policies, renewals, and dashboards for Sales Agents, Sales Managers, and Agency Heads, self-hosted on a single office PC.

## Status

**Phases 1, 2, and 4 are in place** (Section 10 of the plan): scaffold, reliability foundations, and auth & tenant scoping. Phase 3 (first-run setup wizard) and 5 onward (real Super Admin/Agency Head UI, Leads/Policies CRUD, etc.) aren't built yet — logging in currently only works against the seeded dev accounts below, not a real onboarding flow. The full spec lives in [`insurance-crm-plan.md`](./insurance-crm-plan.md) (currently Baseline v1.4) and remains the source of truth for everything not yet built.

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

Once the app is actually deployed for real use, first-run setup requires the Super Admin to choose a document storage location on a **different physical disk** than the app itself (Section 5 of the plan) — that wizard doesn't exist yet.

For production deployment (self-hosted, LAN-only, copy-paste portable), see Section 8 of the plan.

## Contributing

This is a single-agency internal tool, not an open-source project — see the plan document for design rationale before making changes.
