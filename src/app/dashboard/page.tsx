import { requireSession } from "@/lib/session";
import { getScopedPrisma } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import { signOut } from "@/auth";

// Demonstrates the auth + tenant-scoping foundation from Section 10 phase 4:
// session carries agencyId/role, and every query for an agency user goes
// through the scoped data-access layer. Sub-team scoping (Manager sees only
// their own agents, Section 3) and real Leads/Policies UI are later phases.
export default async function DashboardPage() {
  const session = await requireSession();
  const { user } = session;

  const isSuperAdmin = !user.agencyId;

  const agencies = isSuperAdmin
    ? await prisma.agency.findMany({ orderBy: { name: "asc" } })
    : [];

  const leads = !isSuperAdmin
    ? await getScopedPrisma(user.agencyId!).lead.findMany({
        orderBy: { createdAt: "desc" },
        include: { owner: true },
      })
    : [];

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
          <h2 className="text-sm font-medium text-gray-700">Agencies on this installation</h2>
          <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
            {agencies.map((agency) => (
              <li key={agency.id} className="px-4 py-3 text-sm text-gray-800">
                {agency.name}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-8">
          <h2 className="text-sm font-medium text-gray-700">Leads in your agency</h2>
          <p className="mt-1 text-xs text-gray-400">
            Fetched through the tenant-scoped data-access layer — every row below is
            guaranteed to belong to your agency, not just filtered client-side.
          </p>
          <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
            {leads.map((lead) => (
              <li key={lead.id} className="flex justify-between px-4 py-3 text-sm">
                <span className="text-gray-800">{lead.name}</span>
                <span className="text-gray-400">
                  {lead.owner?.name ?? "unassigned"} &middot; {lead.status}
                </span>
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
