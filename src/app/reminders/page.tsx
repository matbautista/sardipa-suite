import Link from "next/link";
import { requireAgencySession } from "@/lib/session";
import { getMyFollowUps } from "@/lib/dashboard-metrics";

// Full follow-up reminders list (Section 10 phase 16 / Section 5's Leads
// feature: "Follow-up reminders list"). The dashboard's own "Follow-ups
// due" widget only shows the top 5 — this is everything, for every agency
// role's own leads/policies (same own-records scoping as /leads and
// /policies; cross-team reminders aren't part of the plan the way
// /team/leads' cross-visibility is).
export default async function RemindersPage() {
  const session = await requireAgencySession();
  const followUps = await getMyFollowUps(session.user.agencyId, session.user.id);

  const overdue = followUps.filter((item) => item.overdue);
  const upcoming = followUps.filter((item) => !item.overdue);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Reminders</h1>
        <Link href="/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
          Back to dashboard
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Lead follow-ups due and your policies in grace period, across everything you own.
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-red-700">Overdue ({overdue.length})</h2>
        <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
          {overdue.map((item) => (
            <li key={`${item.type}-${item.id}`} className="flex items-center justify-between px-4 py-3 text-sm">
              <Link href={item.href} className="text-gray-800 hover:underline">
                {item.label}
              </Link>
              <span className="text-red-600">{item.dueDate.toLocaleDateString()}</span>
            </li>
          ))}
          {overdue.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">Nothing overdue.</li>}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-gray-700">Upcoming ({upcoming.length})</h2>
        <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
          {upcoming.map((item) => (
            <li key={`${item.type}-${item.id}`} className="flex items-center justify-between px-4 py-3 text-sm">
              <Link href={item.href} className="text-gray-800 hover:underline">
                {item.label}
              </Link>
              <span className="text-gray-400">{item.dueDate.toLocaleDateString()}</span>
            </li>
          ))}
          {upcoming.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">Nothing upcoming.</li>}
        </ul>
      </section>
    </div>
  );
}
