import Link from "next/link";
import { requireSuperAdminSession } from "@/lib/session";
import { listHostActivityLog } from "@/lib/activity-log";
import { ACTIVITY_ACTION_LABELS } from "@/lib/status-labels";
import { prisma } from "@/lib/prisma";

// Super Admin's host-level Activity Log view (Section 10 phase 16 /
// Section 5: "Super Admin can view host-level events"). Deliberately
// scoped to agencyId-null entries (Super Admin's own logins and
// onboarding actions), not every agency's log — that stays each Agency
// Head's own view at /agency/activity, preserving tenant isolation.

export default async function HostActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string; startDate?: string; endDate?: string }>;
}) {
  await requireSuperAdminSession();
  const { userId, startDate, endDate } = await searchParams;

  const [entries, superAdmins] = await Promise.all([
    listHostActivityLog({ userId: userId || undefined, startDate: startDate || undefined, endDate: endDate || undefined }),
    prisma.user.findMany({ where: { role: "super_admin" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Host Activity Log</h1>
        <Link href="/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
          Back to dashboard
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Host-level events only (Super Admin logins and onboarding actions) — each agency has its own
        Activity Log, viewable by that agency&apos;s Head.
      </p>

      <form className="mt-6 flex flex-wrap items-end gap-4" method="get">
        <div>
          <label className="block text-xs font-medium text-gray-700">User</label>
          <select
            name="userId"
            defaultValue={userId ?? ""}
            className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          >
            <option value="">Everyone</option>
            {superAdmins.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
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
      </form>

      <ul className="mt-6 divide-y divide-gray-200 rounded-md border border-gray-200">
        {entries.map((entry) => (
          <li key={entry.id} className="px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-800">{ACTIVITY_ACTION_LABELS[entry.action] ?? entry.action}</span>
              <span className="text-xs text-gray-400">{entry.timestamp.toLocaleString()}</span>
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {entry.user.name}
              {entry.note && <> · {entry.note}</>}
            </div>
          </li>
        ))}
        {entries.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">No matching activity.</li>}
      </ul>
    </div>
  );
}
