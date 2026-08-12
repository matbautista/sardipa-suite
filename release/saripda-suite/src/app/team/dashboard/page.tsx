import Link from "next/link";
import { requireManagerOrHeadSession } from "@/lib/session";
import { getTeamMemberIds, listTeamMembers } from "@/lib/team-access";
import { listInsuranceLines } from "@/lib/insurance-lines";
import { getTeamDashboardMetrics, POLICY_STATUSES, POLICY_STATUS_LABELS } from "@/lib/dashboard-metrics";
import { ConversionByLineChart, PipelineFunnelChart, PoliciesByStatusChart, TrendCharts } from "./charts";

// Manager/Head dashboard (Section 10 phase 13 / Section 5's "Manager/Head:
// leaderboard by agent, conversion rate by insurance line,
// revenue/commission totals, pipeline funnel, trends over time, policies by
// status ... Filters: date range, insurance line, agent, policy status").
// Scope (own team for a Manager, whole agency for a Head) comes from
// team-access.ts, same as /team/leads and /team/policies (phase 12).

function pct(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function peso(amount: number): string {
  return `₱${amount.toLocaleString()}`;
}

export default async function TeamDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ startDate?: string; endDate?: string; lineId?: string; ownerId?: string; status?: string }>;
}) {
  const session = await requireManagerOrHeadSession();
  const { startDate, endDate, lineId, ownerId, status } = await searchParams;

  const [teamMemberIds, teamMembers, lines] = await Promise.all([
    getTeamMemberIds(session.user.agencyId, session.user.id, session.user.role),
    listTeamMembers(session.user.agencyId, session.user.id, session.user.role),
    listInsuranceLines(session.user.agencyId),
  ]);

  const metrics = await getTeamDashboardMetrics(session.user.agencyId, teamMemberIds, teamMembers, {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    lineId: lineId || undefined,
    ownerId: ownerId || undefined,
    status: status || undefined,
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">
          {session.user.role === "head" ? "Agency Dashboard" : "Team Dashboard"}
        </h1>
        <div className="flex gap-4">
          <Link href="/team/leads" className="text-sm text-gray-500 underline hover:text-gray-800">
            Team leads
          </Link>
          <Link href="/team/policies" className="text-sm text-gray-500 underline hover:text-gray-800">
            Team policies
          </Link>
          <Link href="/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
            Back to dashboard
          </Link>
        </div>
      </div>

      <form className="mt-6 flex flex-wrap items-end gap-4 rounded-md border border-gray-200 bg-gray-50 px-4 py-3" method="get">
        <div>
          <label className="block text-xs text-gray-500">From</label>
          <input
            type="date"
            name="startDate"
            defaultValue={startDate ?? ""}
            className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500">To</label>
          <input
            type="date"
            name="endDate"
            defaultValue={endDate ?? ""}
            className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500">Insurance line</label>
          <select
            name="lineId"
            defaultValue={lineId ?? ""}
            className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          >
            <option value="">All lines</option>
            {lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500">Agent</label>
          <select
            name="ownerId"
            defaultValue={ownerId ?? ""}
            className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          >
            <option value="">Everyone</option>
            {teamMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500">Policy status</label>
          <select
            name="status"
            defaultValue={status ?? ""}
            className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          >
            <option value="">Active and later</option>
            {POLICY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {POLICY_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800">
          Apply filters
        </button>
        {(startDate || endDate || lineId || ownerId || status) && (
          <Link href="/team/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
            Clear
          </Link>
        )}
      </form>

      <section className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-md border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-500">
            Total premium{status ? ` (${POLICY_STATUS_LABELS[status] ?? status})` : ""}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{peso(metrics.revenueTotals.premium)}</p>
        </div>
        <div className="rounded-md border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-500">Total commission</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{peso(metrics.revenueTotals.commission)}</p>
        </div>
        <div className="rounded-md border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-500">Policies counted</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{metrics.revenueTotals.count}</p>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-gray-700">Leaderboard</h2>
        <div className="mt-2 overflow-x-auto rounded-md border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="px-4 py-2 font-medium">Agent</th>
                <th className="px-4 py-2 font-medium">Leads</th>
                <th className="px-4 py-2 font-medium">Won</th>
                <th className="px-4 py-2 font-medium">Conversion</th>
                <th className="px-4 py-2 font-medium">Policies (active+)</th>
                <th className="px-4 py-2 font-medium">Premium</th>
                <th className="px-4 py-2 font-medium">Commission</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {metrics.leaderboard.map((row) => (
                <tr key={row.member.id}>
                  <td className="px-4 py-2 text-gray-800">{row.member.name}</td>
                  <td className="px-4 py-2 text-gray-500">{row.leadsTotal}</td>
                  <td className="px-4 py-2 text-gray-500">{row.won}</td>
                  <td className="px-4 py-2 text-gray-500">{pct(row.conversionRate)}</td>
                  <td className="px-4 py-2 text-gray-500">{row.policiesCount}</td>
                  <td className="px-4 py-2 text-gray-500">{peso(row.totalPremium)}</td>
                  <td className="px-4 py-2 text-gray-500">{peso(row.totalCommission)}</td>
                </tr>
              ))}
              {metrics.leaderboard.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-3 text-sm text-gray-400">
                    No team members yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10 grid gap-8 sm:grid-cols-2">
        <div>
          <h2 className="text-sm font-medium text-gray-700">Pipeline funnel</h2>
          <div className="mt-2 rounded-md border border-gray-200 px-2 py-3">
            <PipelineFunnelChart data={metrics.pipelineFunnel} />
          </div>
        </div>
        <div>
          <h2 className="text-sm font-medium text-gray-700">Policies by status</h2>
          <div className="mt-2 rounded-md border border-gray-200 px-2 py-3">
            <PoliciesByStatusChart data={metrics.policiesByStatus} />
          </div>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-gray-700">Conversion rate by insurance line</h2>
        <div className="mt-2 rounded-md border border-gray-200 px-2 py-3">
          {metrics.conversionByLine.length > 0 ? (
            <ConversionByLineChart data={metrics.conversionByLine} />
          ) : (
            <p className="px-2 py-6 text-sm text-gray-400">No leads with an insurance line in this range yet.</p>
          )}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-gray-700">Trends (last 6 months)</h2>
        <p className="mt-1 text-xs text-gray-400">
          Always the trailing 6 months, independent of the date-range filter above — trends need their own fixed window.
        </p>
        <div className="mt-2 rounded-md border border-gray-200 px-2 py-3">
          <TrendCharts data={metrics.trend} />
        </div>
      </section>
    </div>
  );
}
