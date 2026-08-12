import Link from "next/link";
import { requireSuperAdminSession } from "@/lib/session";
import { listAgenciesWithHeads } from "@/lib/agency-admin";
import { CreateAgencyForm } from "./create-agency-form";

// Super Admin's Agency Onboarding (Section 5 / Section 10 phase 5).
export default async function AgenciesPage() {
  await requireSuperAdminSession();
  const agencies = await listAgenciesWithHeads();

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Agencies</h1>
        <Link href="/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
          Back to dashboard
        </Link>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-medium text-gray-700">Existing agencies</h2>
        <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
          {agencies.map((agency) => (
            <li key={agency.id} className="px-4 py-3 text-sm">
              <span className="text-gray-800">{agency.name}</span>
              <span className="ml-2 text-gray-400">
                {agency.users[0] ? `— Head: ${agency.users[0].name} (${agency.users[0].email})` : "— no Head yet"}
              </span>
            </li>
          ))}
          {agencies.length === 0 && (
            <li className="px-4 py-3 text-sm text-gray-400">No agencies yet.</li>
          )}
        </ul>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-medium text-gray-700">Create a new agency</h2>
        <p className="mt-1 text-xs text-gray-400">
          Creates the agency and its first Agency Head account together — the Head then
          creates accounts for their own Managers/Agents (Section 5).
        </p>
        <div className="mt-4">
          <CreateAgencyForm />
        </div>
      </div>
    </div>
  );
}
