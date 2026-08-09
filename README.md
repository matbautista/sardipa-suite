# Saripda Suite

A lead-to-sale tracking CRM for insurance agencies — leads, policies, renewals, and dashboards for Sales Agents, Sales Managers, and Agency Heads, self-hosted on a single office PC.

## Status

**Planning stage — no application code yet.** The full spec lives in [`insurance-crm-plan.md`](./insurance-crm-plan.md) (currently Baseline v1.4): purpose, roles, data model, tech stack, deployment, error handling, and build order. That file is the source of truth; this README will grow into real setup instructions once the app is scaffolded from it.

A few items in the plan's Section 12 still need confirmation before or during the build (draft insurance-line field lists, the legal data-retention period, and some external logistics like drive sourcing and trademark clearance) — see that section for the current list.

## Planned tech stack

(Section 7 of the plan — subject to change until the project is actually scaffolded)

- **Frontend**: React + Vite + TypeScript, Tailwind CSS
- **Backend**: Next.js (App Router) API routes, or Node.js + Express
- **Database**: SQLite via Prisma ORM (single-file DB, no separate server)
- **Auth**: Auth.js/NextAuth
- **Charts**: Recharts

## Setup (once scaffolded)

There's no `package.json` yet, so these steps aren't runnable today — this is what setup will look like once the app exists:

1. Install [Node.js](https://nodejs.org/) (LTS)
2. Clone the repo and install dependencies:
   ```sh
   git clone https://github.com/matbautista/sardipa-suite.git
   cd sardipa-suite
   npm install
   ```
3. Run the first-run setup wizard on first launch — it will require creating the Super Admin account and choosing a document storage location on a **different physical disk** than the app itself (Section 5 of the plan)
4. Start the dev server:
   ```sh
   npm run dev
   ```

For production deployment (self-hosted, LAN-only, copy-paste portable), see Section 8 of the plan.

## Contributing

This is a single-agency internal tool, not an open-source project — see the plan document for design rationale before making changes.
