import Link from "next/link";
import { requireAgencySession } from "@/lib/session";
import { getTeamMemberIds } from "@/lib/team-access";
import { searchLeadsAndPolicies } from "@/lib/search";
import { LEAD_STATUS_LABELS, POLICY_STATUS_LABELS } from "@/lib/status-labels";

// Simple text search across Leads and Policies (Section 10 phase 16 /
// Section 5's Users feature), scoped to what the caller's role can already
// see — an Agent searches their own records, a Manager their team's, a
// Head the whole agency (getTeamMemberIds already draws that line for
// /team/leads and /team/policies).
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireAgencySession();
  const { q } = await searchParams;
  const query = q ?? "";

  const ownerIds = await getTeamMemberIds(session.user.agencyId, session.user.id, session.user.role);
  const results = query.trim()
    ? await searchLeadsAndPolicies(session.user.agencyId, ownerIds, query)
    : { leads: [], policies: [] };

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Search</h1>
        <Link href="/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
          Back to dashboard
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Search by name, phone, or email across Leads and Policies —{" "}
        {session.user.role === "head"
          ? "the whole agency"
          : session.user.role === "manager"
            ? "your team"
            : "your own records"}
        .
      </p>

      <form className="mt-6 flex gap-2" method="get">
        <input
          name="q"
          type="text"
          defaultValue={query}
          autoFocus
          placeholder="Name, phone, or email"
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
        />
        <button
          type="submit"
          className="inline-block min-w-[170px] whitespace-nowrap rounded-md btn-primary px-4 py-2 text-center text-sm font-medium"
        >
          Search
        </button>
      </form>

      {query.trim() && (
        <>
          <section className="mt-8">
            <h2 className="text-sm font-medium text-gray-700">Leads ({results.leads.length})</h2>
            <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
              {results.leads.map((lead) => (
                <li key={lead.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <Link href={`/leads/${lead.id}`} className="text-gray-800 hover:underline">
                    {lead.name}
                  </Link>
                  <span className="text-xs text-gray-400">
                    {lead.phone ?? lead.email ?? "—"} · {LEAD_STATUS_LABELS[lead.status] ?? lead.status}
                    {lead.ownerName ? ` · ${lead.ownerName}` : ""}
                  </span>
                </li>
              ))}
              {results.leads.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">No matching leads.</li>}
            </ul>
          </section>

          <section className="mt-8">
            <h2 className="text-sm font-medium text-gray-700">Policies ({results.policies.length})</h2>
            <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
              {results.policies.map((policy) => (
                <li key={policy.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <Link href={`/policies/${policy.id}`} className="text-gray-800 hover:underline">
                    {policy.lineName} — {policy.productName}
                  </Link>
                  <span className="text-xs text-gray-400">
                    matched on {policy.matchedOn} · {POLICY_STATUS_LABELS[policy.status] ?? policy.status} ·{" "}
                    {policy.ownerName}
                  </span>
                </li>
              ))}
              {results.policies.length === 0 && (
                <li className="px-4 py-3 text-sm text-gray-400">No matching policies.</li>
              )}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
