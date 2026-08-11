import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { listOwnLeads } from "@/lib/leads";
import { getMyDashboardMetrics, LEAD_STATUS_LABELS } from "@/lib/dashboard-metrics";
import { signOut } from "@/auth";

// Demonstrates the auth + tenant-scoping foundation from Section 10 phase 4:
// session carries agencyId/role, and every query for an agency user goes
// through the scoped data-access layer. Cross-agent visibility (Manager
// sees their team, Head sees the whole agency, Section 3) is phase 12 —
// this dashboard only ever shows the signed-in user's own leads, same as
// the full /leads CRUD page from phase 7.
//
// Phase 13's "Agent: my pipeline, my conversion rate, my sales this month,
// follow-ups due" (Section 5) is shown here for every agency role, not just
// Agent — a Manager/Head has their own leads/policies too, same reasoning
// /leads and /policies already apply. The Manager/Head-only aggregate view
// (leaderboard, conversion by line, revenue totals, funnel, trends) lives
// at /team/dashboard, linked below.
function pct(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function peso(amount: number): string {
  return `₱${amount.toLocaleString()}`;
}

export default async function DashboardPage() {
  const session = await requireSession();
  const { user } = session;

  const isSuperAdmin = !user.agencyId;

  const agencies = isSuperAdmin
    ? await prisma.agency.findMany({ orderBy: { name: "asc" } })
    : [];

  let leads: Awaited<ReturnType<typeof listOwnLeads>> = [];
  let metrics: Awaited<ReturnType<typeof getMyDashboardMetrics>> | null = null;
  if (!isSuperAdmin) {
    [leads, metrics] = await Promise.all([listOwnLeads(user.agencyId!, user.id), getMyDashboardMetrics(user.agencyId!, user.id)]);
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Signed in as {user.name} &middot; role: {user.role}
            {isSuperAdmin ? " (sits outside every agency)" : ""}
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="text-sm text-gray-500 underline hover:text-gray-800">
            Sign out
          </button>
        </form>
      </div>

      {isSuperAdmin ? (
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700">Agencies on this installation</h2>
            <div className="flex gap-4">
              <Link href="/admin/health" className="text-sm text-gray-500 underline hover:text-gray-800">
                System health
              </Link>
              <Link href="/admin/activity" className="text-sm text-gray-500 underline hover:text-gray-800">
                Activity log
              </Link>
              <Link href="/admin/settings" className="text-sm text-gray-500 underline hover:text-gray-800">
                System configuration
              </Link>
              <Link href="/admin/agencies" className="text-sm text-gray-500 underline hover:text-gray-800">
                Manage agencies
              </Link>
            </div>
          </div>
          <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
            {agencies.map((agency) => (
              <li key={agency.id} className="px-4 py-3 text-sm text-gray-800">
                {agency.name}
              </li>
            ))}
            {agencies.length === 0 && (
              <li className="px-4 py-3 text-sm text-gray-400">No agencies yet.</li>
            )}
          </ul>
        </div>
      ) : (
        <div className="mt-8">
          {user.role === "head" && (
            <div className="mb-6 flex gap-4">
              <Link href="/agency/lines" className="text-sm text-gray-500 underline hover:text-gray-800">
                Insurance lines &amp; products
              </Link>
              <Link href="/agency/users" className="text-sm text-gray-500 underline hover:text-gray-800">
                Managers &amp; agents
              </Link>
              <Link href="/agency/email-intake" className="text-sm text-gray-500 underline hover:text-gray-800">
                Website inquiry intake
              </Link>
              <Link href="/agency/activity" className="text-sm text-gray-500 underline hover:text-gray-800">
                Activity log
              </Link>
            </div>
          )}
          {(user.role === "manager" || user.role === "head") && (
            <div className="mb-6 flex gap-4">
              <Link href="/team/leads" className="text-sm text-gray-500 underline hover:text-gray-800">
                {user.role === "head" ? "Agency leads" : "Team leads"}
              </Link>
              <Link href="/team/policies" className="text-sm text-gray-500 underline hover:text-gray-800">
                {user.role === "head" ? "Agency policies" : "Team policies"}
              </Link>
              <Link href="/team/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
                {user.role === "head" ? "Agency dashboard" : "Team dashboard"}
              </Link>
            </div>
          )}

          <div className="mb-6 flex gap-4">
            <Link href="/reminders" className="text-sm text-gray-500 underline hover:text-gray-800">
              Reminders
            </Link>
            <Link href="/search" className="text-sm text-gray-500 underline hover:text-gray-800">
              Search
            </Link>
          </div>

          {metrics && (
            <div className="mb-8">
              <h2 className="text-sm font-medium text-gray-700">My pipeline</h2>
              <div className="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-6">
                {metrics.pipeline.map(({ status, count }) => (
                  <div key={status} className="rounded-md border border-gray-200 px-3 py-2">
                    <p className="text-xs text-gray-500">{LEAD_STATUS_LABELS[status] ?? status}</p>
                    <p className="mt-0.5 text-lg font-semibold text-gray-900">{count}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-gray-200 px-3 py-2">
                  <p className="text-xs text-gray-500">My conversion rate</p>
                  <p className="mt-0.5 text-lg font-semibold text-gray-900">{pct(metrics.conversionRate)}</p>
                </div>
                <div className="rounded-md border border-gray-200 px-3 py-2">
                  <p className="text-xs text-gray-500">Sales this month</p>
                  <p className="mt-0.5 text-lg font-semibold text-gray-900">
                    {metrics.salesThisMonth.count} &middot; {peso(metrics.salesThisMonth.premium)}
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <h3 className="text-xs font-medium text-gray-500">Follow-ups due</h3>
                <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
                  {metrics.followUps.slice(0, 5).map((item) => (
                    <li key={`${item.type}-${item.id}`} className="flex items-center justify-between px-4 py-2 text-sm">
                      <Link href={item.href} className="text-gray-800 hover:underline">
                        {item.label}
                      </Link>
                      <span className={item.overdue ? "text-red-600" : "text-gray-400"}>
                        {item.dueDate.toLocaleDateString()}
                        {item.overdue ? " · overdue" : ""}
                      </span>
                    </li>
                  ))}
                  {metrics.followUps.length === 0 && (
                    <li className="px-4 py-2 text-sm text-gray-400">Nothing due.</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700">Your leads</h2>
            <div className="flex gap-4">
              <Link href="/policies" className="text-sm text-gray-500 underline hover:text-gray-800">
                My policies
              </Link>
              <Link href="/leads" className="text-sm text-gray-500 underline hover:text-gray-800">
                Manage leads
              </Link>
            </div>
          </div>
          <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
            {leads.slice(0, 5).map((lead) => (
              <li key={lead.id} className="flex justify-between px-4 py-3 text-sm">
                <Link href={`/leads/${lead.id}`} className="text-gray-800 hover:underline">
                  {lead.name}
                </Link>
                <span className="text-gray-400">{lead.status}</span>
              </li>
            ))}
            {leads.length === 0 && (
              <li className="px-4 py-3 text-sm text-gray-400">No leads yet.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
