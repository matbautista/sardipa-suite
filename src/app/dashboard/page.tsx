import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { listOwnLeads } from "@/lib/leads";
import { signOut } from "@/auth";

// Demonstrates the auth + tenant-scoping foundation from Section 10 phase 4:
// session carries agencyId/role, and every query for an agency user goes
// through the scoped data-access layer. Cross-agent visibility (Manager
// sees their team, Head sees the whole agency, Section 3) is phase 12 —
// this dashboard only ever shows the signed-in user's own leads, same as
// the full /leads CRUD page from phase 7.
export default async function DashboardPage() {
  const session = await requireSession();
  const { user } = session;

  const isSuperAdmin = !user.agencyId;

  const agencies = isSuperAdmin
    ? await prisma.agency.findMany({ orderBy: { name: "asc" } })
    : [];

  const leads = !isSuperAdmin ? await listOwnLeads(user.agencyId!, user.id) : [];

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
            <Link href="/admin/agencies" className="text-sm text-gray-500 underline hover:text-gray-800">
              Manage agencies
            </Link>
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
