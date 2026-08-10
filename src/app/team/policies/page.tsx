import Link from "next/link";
import { requireManagerOrHeadSession } from "@/lib/session";
import { getTeamMemberIds, listTeamMembers } from "@/lib/team-access";
import { listTeamPolicies } from "@/lib/policies";

// Manager/Head cross-visibility for Policies (Section 10 phase 12 / Section
// 3's "View other agents' leads/sales"). No reassignment control here —
// unlike Leads, the plan never lists policy reassignment as a capability
// (Section 3's table only calls out "Reassign leads between agents").

const STATUSES = ["draft", "active", "grace_period", "lapsed", "cancelled", "completed"] as const;

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  grace_period: "Grace period",
  lapsed: "Lapsed",
  cancelled: "Cancelled",
  completed: "Completed",
};

export default async function TeamPoliciesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; ownerId?: string }>;
}) {
  const session = await requireManagerOrHeadSession();
  const { status, ownerId } = await searchParams;

  const [teamMemberIds, teamMembers] = await Promise.all([
    getTeamMemberIds(session.user.agencyId, session.user.id, session.user.role),
    listTeamMembers(session.user.agencyId, session.user.id, session.user.role),
  ]);

  const [allTeamPolicies, filteredPolicies] = await Promise.all([
    listTeamPolicies(session.user.agencyId, teamMemberIds),
    listTeamPolicies(session.user.agencyId, teamMemberIds, {
      status: status || undefined,
      ownerId: ownerId || undefined,
    }),
  ]);

  const leaderboard = teamMembers.map((member) => {
    const ownPolicies = allTeamPolicies.filter((policy) => policy.ownerId === member.id);
    const counts = Object.fromEntries(STATUSES.map((s) => [s, ownPolicies.filter((p) => p.status === s).length]));
    const totalPremium = ownPolicies.reduce((sum, p) => sum + p.premium, 0);
    return { member, total: ownPolicies.length, counts, totalPremium };
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">
          {session.user.role === "head" ? "Agency Policies" : "Team Policies"}
        </h1>
        <div className="flex gap-4">
          <Link href="/team/leads" className="text-sm text-gray-500 underline hover:text-gray-800">
            Team leads
          </Link>
          <Link href="/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
            Back to dashboard
          </Link>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-gray-700">Leaderboard</h2>
        <div className="mt-2 overflow-x-auto rounded-md border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="px-4 py-2 font-medium">Agent</th>
                <th className="px-4 py-2 font-medium">Total</th>
                {STATUSES.map((s) => (
                  <th key={s} className="px-4 py-2 font-medium">
                    {STATUS_LABELS[s]}
                  </th>
                ))}
                <th className="px-4 py-2 font-medium">Total premium</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {leaderboard.map(({ member, total, counts, totalPremium }) => (
                <tr key={member.id}>
                  <td className="px-4 py-2 text-gray-800">{member.name}</td>
                  <td className="px-4 py-2 text-gray-800">{total}</td>
                  {STATUSES.map((s) => (
                    <td key={s} className="px-4 py-2 text-gray-500">
                      {counts[s]}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-gray-500">₱{totalPremium.toLocaleString()}</td>
                </tr>
              ))}
              {leaderboard.length === 0 && (
                <tr>
                  <td colSpan={STATUSES.length + 3} className="px-4 py-3 text-sm text-gray-400">
                    No team members yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-gray-700">All policies ({filteredPolicies.length})</h2>

        <form className="mt-3 flex gap-4" method="get">
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            name="ownerId"
            defaultValue={ownerId ?? ""}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          >
            <option value="">All agents</option>
            {teamMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            Filter
          </button>
        </form>

        <ul className="mt-3 divide-y divide-gray-200 rounded-md border border-gray-200">
          {filteredPolicies.map((policy) => (
            <li key={policy.id} className="px-4 py-3 text-sm">
              <Link href={`/policies/${policy.id}`} className="flex items-center justify-between hover:underline">
                <span className="text-gray-800">
                  {policy.product.name} ({policy.line.name})
                </span>
                <span className="text-gray-400">
                  {policy.owner.name} · ₱{policy.premium.toLocaleString()} ·{" "}
                  {STATUS_LABELS[policy.status] ?? policy.status}
                </span>
              </Link>
            </li>
          ))}
          {filteredPolicies.length === 0 && (
            <li className="px-4 py-3 text-sm text-gray-400">No policies match.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
