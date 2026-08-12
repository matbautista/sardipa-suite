import Link from "next/link";
import { redirect } from "next/navigation";
import { requireManagerOrHeadSession } from "@/lib/session";
import { getTeamMemberIds, listTeamMembers } from "@/lib/team-access";
import { listTeamPolicies, reassignPolicy } from "@/lib/policies";

// Manager/Head cross-visibility for Policies (Section 10 phase 12 / Section
// 3's "View other agents' leads/sales"). Reassignment control added here in
// a full-app review: Section 3's permissions table only calls out lead
// reassignment as a day-to-day pipeline action, but Section 5's Deactivation
// bullet separately requires "a Manager/Agency Head reassigns their open
// leads/policies to someone active" — that's a real capability gap this
// page (and reassignPolicy() in policies.ts) closes, not a re-litigation of
// Section 3's table.

async function reassignPolicyAction(formData: FormData) {
  "use server";
  const session = await requireManagerOrHeadSession();
  const policyId = String(formData.get("policyId") ?? "");
  const newOwnerId = String(formData.get("newOwnerId") ?? "");

  const teamMemberIds = await getTeamMemberIds(session.user.agencyId, session.user.id, session.user.role);
  if (!newOwnerId || !teamMemberIds.includes(newOwnerId)) {
    redirect(`/team/policies?error=${encodeURIComponent("Choose a valid team member to reassign to.")}`);
  }

  const result = await reassignPolicy(session.user.agencyId, session.user.id, teamMemberIds, policyId, newOwnerId);
  if (!result.ok) {
    redirect(`/team/policies?error=${encodeURIComponent(result.error)}`);
  }
  redirect("/team/policies");
}

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
  searchParams: Promise<{ status?: string; ownerId?: string; error?: string }>;
}) {
  const session = await requireManagerOrHeadSession();
  const { status, ownerId, error } = await searchParams;

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
    // Found in a full-app review: this previously summed every policy's
    // premium regardless of status, including draft (and cancelled) ones —
    // contradicting the spec's "revenue counts active status and later, a
    // draft isn't a completed sale yet," which dashboard-metrics.ts already
    // implements correctly elsewhere. Same "!== draft" filter as there, so
    // this leaderboard and /team/dashboard agree on the same agency's revenue.
    const totalPremium = ownPolicies.filter((p) => p.status !== "draft").reduce((sum, p) => sum + p.premium, 0);
    return { member, total: ownPolicies.length, counts, totalPremium };
  });

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">
          {session.user.role === "head" ? "Agency Policies" : "Team Policies"}
        </h1>
        <div className="flex gap-4">
          <a href="/api/export/policies?scope=team" className="text-sm text-gray-500 underline hover:text-gray-800">
            Export CSV
          </a>
          <Link href="/team/leads" className="text-sm text-gray-500 underline hover:text-gray-800">
            Team leads
          </Link>
          <Link href="/team/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
            Team dashboard
          </Link>
          <Link href="/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
            Back to dashboard
          </Link>
        </div>
      </div>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

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
            className="rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
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
            className="rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
          >
            <option value="">All agents</option>
            {teamMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          <button type="submit" className="inline-block min-w-[110px] rounded-md btn-primary px-2.5 py-1 text-center text-xs font-medium">
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
              <form action={reassignPolicyAction} className="mt-2 flex items-center gap-2">
                <input type="hidden" name="policyId" value={policy.id} />
                <label className="text-xs text-gray-500">Reassign to:</label>
                <select
                  name="newOwnerId"
                  defaultValue=""
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
                >
                  <option value="">— choose —</option>
                  {teamMembers
                    .filter((member) => member.id !== policy.ownerId)
                    .map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                </select>
                <button type="submit" className="inline-block min-w-[110px] rounded-md btn-primary px-2.5 py-1 text-center text-xs font-medium">
                  Reassign
                </button>
              </form>
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
