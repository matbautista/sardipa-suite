# Saripda Suite

A lead-to-sale tracking CRM for insurance agencies — leads, policies, renewals, and dashboards for Sales Agents, Sales Managers, and Agency Heads, self-hosted on a single office PC.

## Status

**Phase 1 scaffold in place** (Section 10 of the plan): Next.js + TypeScript + Tailwind project, the full Prisma schema for every model in Section 6, an initial migration, and a seed script. No actual pages/auth/business logic yet — that's phases 2 onward. The full spec lives in [`insurance-crm-plan.md`](./insurance-crm-plan.md) (currently Baseline v1.4) and remains the source of truth for everything not yet built.

A few items in the plan's Section 12 still need confirmation before or during the build (draft insurance-line field lists, the legal data-retention period, and some external logistics like drive sourcing and trademark clearance) — see that section for the current list.

**Note on the Next.js version**: this scaffold used Next.js 16, which is new enough that its own generated `AGENTS.md` warns that App Router conventions may differ from older training data. Before writing route/page code, check `node_modules/next/dist/docs/` rather than assuming Next 13–15 patterns still apply.

## Tech stack (as actually scaffolded)

- **Frontend**: Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- **Database**: SQLite via Prisma ORM 7, using the `@prisma/adapter-better-sqlite3` driver adapter (required in Prisma 7 — there's no more built-in native engine binary)
- **Password hashing**: bcryptjs
- Auth (Auth.js/NextAuth) and charts (Recharts) aren't wired up yet — see Section 7 of the plan for the intended stack

SQLite has no native enum type, so every "enum-like" column (`role`, `status`, `category`, etc.) is a plain `String` in `prisma/schema.prisma`, with the allowed values documented in a comment above each field. Validation happens at the application layer once that code exists.

## Setup

1. Install [Node.js](https://nodejs.org/) 22+ (this project was scaffolded on Node 24)
2. Clone the repo and install dependencies:
   ```sh
   git clone https://github.com/matbautista/sardipa-suite.git
   cd sardipa-suite
   npm install
   ```
3. Copy the environment file:
   ```sh
   cp .env.example .env
   ```
4. Apply the database schema and seed some sample data:
   ```sh
   npx prisma migrate dev
   npm run db:seed
   ```
   This creates `dev.db` (gitignored) with a Super Admin, two sample agencies (each with a Head, a Manager, agents assigned to that Manager, some products, and a few leads). The seed script prints the shared dev password for every seeded account.
5. Start the dev server:
   ```sh
   npm run dev
   ```
   App runs at http://localhost:3000. There's no UI wired to the database yet — use `npm run db:studio` (Prisma Studio) to browse the seeded data directly.

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run db:migrate` | Create/apply a Prisma migration |
| `npm run db:seed` | Re-run the seed script |
| `npm run db:studio` | Open Prisma Studio (database GUI) |
| `npm run lint` | ESLint |

Once the app is actually deployed for real use, first-run setup requires the Super Admin to choose a document storage location on a **different physical disk** than the app itself (Section 5 of the plan) — that wizard doesn't exist yet.

For production deployment (self-hosted, LAN-only, copy-paste portable), see Section 8 of the plan.

## Contributing

This is a single-agency internal tool, not an open-source project — see the plan document for design rationale before making changes.
