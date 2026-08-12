import Link from "next/link";
import { requireHeadSession } from "@/lib/session";
import { listAgencyActivityLog } from "@/lib/activity-log";
import { ACTIVITY_ACTION_LABELS } from "@/lib/status-labels";
import { getScopedPrisma } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";

// Agency Head's Audit/Activity Log viewer (Section 10 phase 16 / Section 5:
// "Agency Head can view their agency's log ... a simple filterable list —
// by record, by user, by date range"). The "by record" filter is a deep
// link (?recordType=lead&recordId=...) rather than a picker widget — a
// future "view history" link from a Lead/Policy detail page would use it,
// though none links here yet.

export default async function AgencyActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string; startDate?: string; endDate?: string; recordType?: string; recordId?: string }>;
}) {
  const session = await requireHeadSession();
  const { userId, startDate, endDate, recordType, recordId } = await searchParams;

  const scoped = getScopedPrisma(session.user.agencyId);
  const [entries, teamUsers, systemActor] = await Promise.all([
    listAgencyActivityLog(session.user.agencyId, {
      userId: userId || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      recordType: recordType === "lead" || recordType === "policy" ? recordType : undefined,
      recordId: recordId || undefined,
    }),
    scoped.user.findMany({ orderBy: { name: "asc" } }),
    // The renewal job's automated ActivityLog entries (renewal-job.ts) are
    // attributed to a reserved "system" User row that, like Super Admin,
    // sits outside every agency (agencyId: null) — so the tenant-scoped
    // findMany above can never return it, even though its entries do show
    // up unfiltered in this agency's log below. Fetched separately (via the
    // unscoped client — there's nothing tenant-specific to leak, it's one
    // fixed, host-wide row) so the User filter can actually reach them.
    prisma.user.findFirst({ where: { role: "system" } }),
  ]);
  const users = systemActor ? [...teamUsers, systemActor] : teamUsers;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Activity Log</h1>
        <Link href="/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
          Back to dashboard
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">Every create/update/delete on a Lead, Policy, or Document, every user-management action, and every login for this agency.</p>

      <form className="mt-6 flex flex-wrap items-end gap-4" method="get">
        <div>
          <label className="block text-xs font-medium text-gray-700">User</label>
          <select
            name="userId"
            defaultValue={userId ?? ""}
            className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          >
            <option value="">Everyone</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} ({user.role})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700">From</label>
          <input
            name="startDate"
            type="date"
            defaultValue={startDate ?? ""}
            className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700">To</label>
          <input
            name="endDate"
            type="date"
            defaultValue={endDate ?? ""}
            className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Filter
        </button>
        {(userId || startDate || endDate || recordId) && (
          <Link href="/agency/activity" className="text-xs text-gray-500 underline hover:text-gray-800">
            Clear filters
          </Link>
        )}
      </form>

      {recordId && (
        <p className="mt-4 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Showing history for this {recordType} only.{" "}
          <Link href="/agency/activity" className="underline hover:text-gray-900">
            Show everything
          </Link>
        </p>
      )}

      <ul className="mt-6 divide-y divide-gray-200 rounded-md border border-gray-200">
        {entries.map((entry) => (
          <li key={entry.id} className="px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-800">{ACTIVITY_ACTION_LABELS[entry.action] ?? entry.action}</span>
              <span className="text-xs text-gray-400">{entry.timestamp.toLocaleString()}</span>
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {entry.user.name}
              {entry.lead && (
                <>
                  {" · "}
                  <Link href={`/leads/${entry.lead.id}`} className="underline hover:text-gray-800">
                    {entry.lead.name}
                  </Link>
                </>
              )}
              {entry.policy && (
                <>
                  {" · "}
                  <Link href={`/policies/${entry.policy.id}`} className="underline hover:text-gray-800">
                    policy
                  </Link>
                </>
              )}
              {entry.note && <> · {entry.note}</>}
            </div>
          </li>
        ))}
        {entries.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">No matching activity.</li>}
      </ul>
    </div>
  );
}
