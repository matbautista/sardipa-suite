import Link from "next/link";
import { redirect } from "next/navigation";
import { requireManagerOrHeadSession } from "@/lib/session";
import { getTeamMemberIds, listTeamMembers } from "@/lib/team-access";
import { listTeamLeads, listUnassignedOrNeedsReviewLeads, claimLead, reassignLead } from "@/lib/leads";

// Manager/Head cross-visibility for Leads (Section 10 phase 12 / Section 3's
// "View other agents' leads/sales" + "Reassign leads between agents").
// Manager's scope is their own team, Head's is the whole agency —
// getTeamMemberIds() (team-access.ts) already draws that line, so this page
// never branches on role itself beyond what that returns.

const STATUSES = ["new", "contacted", "quoted", "negotiating", "won", "lost"] as const;

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
};

async function claimLeadAction(formData: FormData) {
  "use server";
  const session = await requireManagerOrHeadSession();
  const leadId = String(formData.get("leadId") ?? "");
  const targetOwnerId = String(formData.get("targetOwnerId") ?? "") || undefined;
  const teamMemberIds = await getTeamMemberIds(session.user.agencyId, session.user.id, session.user.role);
  const result = await claimLead(session.user.agencyId, session.user.id, leadId, teamMemberIds, targetOwnerId);
  if (!result.ok) {
    redirect(`/team/leads?error=${encodeURIComponent(result.error)}`);
  }
  redirect("/team/leads");
}

async function reassignLeadAction(formData: FormData) {
  "use server";
  const session = await requireManagerOrHeadSession();
  const leadId = String(formData.get("leadId") ?? "");
  const newOwnerId = String(formData.get("newOwnerId") ?? "");

  // reassignLead() itself trusts the caller already verified newOwnerId is
  // within scope (team-access.ts's comment on that function) — this is
  // where that verification actually happens, built from the exact same
  // list the <select> below was populated from.
  const teamMemberIds = await getTeamMemberIds(session.user.agencyId, session.user.id, session.user.role);
  if (!newOwnerId || !teamMemberIds.includes(newOwnerId)) {
    redirect(`/team/leads?error=${encodeURIComponent("Choose a valid team member to reassign to.")}`);
  }

  const result = await reassignLead(session.user.agencyId, session.user.id, teamMemberIds, leadId, newOwnerId);
  if (!result.ok) {
    redirect(`/team/leads?error=${encodeURIComponent(result.error)}`);
  }
  redirect("/team/leads");
}

export default async function TeamLeadsPage({
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

  const [allTeamLeads, filteredLeads, unassignedOrNeedsReview] = await Promise.all([
    listTeamLeads(session.user.agencyId, teamMemberIds),
    listTeamLeads(session.user.agencyId, teamMemberIds, { status: status || undefined, ownerId: ownerId || undefined }),
    listUnassignedOrNeedsReviewLeads(session.user.agencyId),
  ]);

  const leaderboard = teamMembers.map((member) => {
    const ownLeads = allTeamLeads.filter((lead) => lead.ownerId === member.id);
    const counts = Object.fromEntries(STATUSES.map((s) => [s, ownLeads.filter((l) => l.status === s).length]));
    return { member, total: ownLeads.length, counts };
  });

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">
          {session.user.role === "head" ? "Agency Leads" : "Team Leads"}
        </h1>
        <div className="flex gap-4">
          <a href="/api/export/leads?scope=team" className="text-sm text-gray-500 underline hover:text-gray-800">
            Export CSV
          </a>
          <Link href="/team/policies" className="text-sm text-gray-500 underline hover:text-gray-800">
            Team policies
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
        <h2 className="text-sm font-medium text-gray-700">
          Unassigned / needs review ({unassignedOrNeedsReview.length})
        </h2>
        <p className="mt-1 text-xs text-gray-400">
          Shared agency-wide pool — any Manager can claim one into their own team.
        </p>
        <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
          {unassignedOrNeedsReview.map((lead) => (
            <li key={lead.id} className="flex items-end justify-between gap-4 px-4 py-3 text-sm">
              <div>
                <span className="text-gray-800">{lead.name}</span>
                <span className="ml-2 text-gray-400">
                  {lead.source}
                  {lead.needsReview ? " · needs review" : ""}
                  {lead.ownerId === null ? " · unassigned" : ""}
                </span>
              </div>
              {lead.ownerId === null ? (
                <form action={claimLeadAction} className="flex items-center gap-2">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <select
                    name="targetOwnerId"
                    defaultValue=""
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
                  >
                    <option value="">Claim for myself</option>
                    {teamMembers
                      .filter((member) => member.id !== session.user.id)
                      .map((member) => (
                        <option key={member.id} value={member.id}>
                          Assign to {member.name}
                        </option>
                      ))}
                  </select>
                  <button type="submit" className="inline-block min-w-[110px] rounded-md btn-primary px-2.5 py-1 text-center text-xs font-medium">
                    Claim
                  </button>
                </form>
              ) : (
                <Link href={`/leads/${lead.id}`} className="text-xs text-gray-500 underline hover:text-gray-800">
                  Already assigned — view
                </Link>
              )}
            </li>
          ))}
          {unassignedOrNeedsReview.length === 0 && (
            <li className="px-4 py-3 text-sm text-gray-400">Nothing waiting.</li>
          )}
        </ul>
      </section>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">Leaderboard</h2>
        </div>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {leaderboard.map(({ member, total, counts }) => (
                <tr key={member.id}>
                  <td className="px-4 py-2 text-gray-800">{member.name}</td>
                  <td className="px-4 py-2 text-gray-800">{total}</td>
                  {STATUSES.map((s) => (
                    <td key={s} className="px-4 py-2 text-gray-500">
                      {counts[s]}
                    </td>
                  ))}
                </tr>
              ))}
              {leaderboard.length === 0 && (
                <tr>
                  <td colSpan={STATUSES.length + 2} className="px-4 py-3 text-sm text-gray-400">
                    No team members yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">All leads ({filteredLeads.length})</h2>
        </div>

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
          {filteredLeads.map((lead) => (
            <li key={lead.id} className="px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <Link href={`/leads/${lead.id}`} className="text-gray-800 hover:underline">
                  {lead.name}
                </Link>
                <span className="text-gray-400">
                  {lead.owner?.name ?? "Unassigned"} · {STATUS_LABELS[lead.status] ?? lead.status}
                </span>
              </div>
              <form action={reassignLeadAction} className="mt-2 flex items-center gap-2">
                <input type="hidden" name="leadId" value={lead.id} />
                <label className="text-xs text-gray-500">Reassign to:</label>
                <select
                  name="newOwnerId"
                  defaultValue=""
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
                >
                  <option value="">— choose —</option>
                  {teamMembers
                    .filter((member) => member.id !== lead.ownerId)
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
          {filteredLeads.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">No leads match.</li>}
        </ul>
      </section>
    </div>
  );
}
