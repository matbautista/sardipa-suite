import Link from "next/link";
import { requireAgencySession } from "@/lib/session";
import { listOwnPolicies } from "@/lib/policies";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  grace_period: "Grace period",
  lapsed: "Lapsed",
  cancelled: "Cancelled",
  completed: "Completed",
};

// Policies — general (Section 10 phase 9). Same "my own policies only"
// scoping as /leads (phase 7) — cross-agent visibility is phase 12.
// Creation only happens by converting a Won lead (see /leads/[id]), so
// unlike /leads there's no inline "add" form here.
export default async function PoliciesPage() {
  const session = await requireAgencySession();
  const policies = await listOwnPolicies(session.user.agencyId, session.user.id);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">My Policies</h1>
        <div className="flex gap-4">
          <a href="/api/export/policies" className="text-sm text-gray-500 underline hover:text-gray-800">
            Export CSV
          </a>
          <Link href="/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
            Back to dashboard
          </Link>
        </div>
      </div>

      <ul className="mt-8 divide-y divide-gray-200 rounded-md border border-gray-200">
        {policies.map((policy) => (
          <li key={policy.id} className="px-4 py-3 text-sm">
            <Link href={`/policies/${policy.id}`} className="flex items-center justify-between hover:underline">
              <span className="text-gray-800">
                {policy.product.name} ({policy.line.name})
              </span>
              <span className="text-gray-400">
                ₱{policy.premium.toLocaleString()} · {STATUS_LABELS[policy.status] ?? policy.status}
              </span>
            </Link>
          </li>
        ))}
        {policies.length === 0 && (
          <li className="px-4 py-3 text-sm text-gray-400">
            No policies yet — convert a Won lead into one from its detail page.
          </li>
        )}
      </ul>
    </div>
  );
}
