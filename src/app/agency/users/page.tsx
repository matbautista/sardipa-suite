import Link from "next/link";
import { requireHeadSession } from "@/lib/session";
import { listAgencyUsers } from "@/lib/agency-users";
import { toggleActiveAction, reassignManagerAction } from "./actions";
import { CreateManagerForm } from "./create-manager-form";
import { CreateAgentForm } from "./create-agent-form";
import { ResetPasswordButton } from "./reset-password-button";

// Agency Head's Manager/Agent account management (Section 5 / Section 10
// phase 6). Create+reset-password need one-time secret display, so those
// go through useActionState client components; deactivate/reactivate and
// manager reassignment don't, so those stay plain server actions here.
export default async function AgencyUsersPage() {
  const session = await requireHeadSession();
  const { managers, agents } = await listAgencyUsers(session.user.agencyId);

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Managers &amp; Agents</h1>
        <Link href="/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
          Back to dashboard
        </Link>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-medium text-gray-700">Managers</h2>
        <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
          {managers.map((manager) => (
            <li key={manager.id} className="px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-gray-800">{manager.name}</span>
                  <span className="ml-2 text-gray-400">{manager.email}</span>
                  {!manager.isActive && (
                    <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                      deactivated
                    </span>
                  )}
                </div>
                <form action={toggleActiveAction}>
                  <input type="hidden" name="targetUserId" value={manager.id} />
                  <input type="hidden" name="nextActive" value={(!manager.isActive).toString()} />
                  <button type="submit" className="text-xs text-gray-500 underline hover:text-gray-800">
                    {manager.isActive ? "Deactivate" : "Reactivate"}
                  </button>
                </form>
              </div>
              <div className="mt-2">
                <ResetPasswordButton userId={manager.id} />
              </div>
            </li>
          ))}
          {managers.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">No managers yet.</li>}
        </ul>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-medium text-gray-700">Add a manager</h2>
        <div className="mt-3">
          <CreateManagerForm />
        </div>
      </div>

      <div className="mt-10">
        <h2 className="text-sm font-medium text-gray-700">Agents</h2>
        <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
          {agents.map((agent) => (
            <li key={agent.id} className="px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-gray-800">{agent.name}</span>
                  <span className="ml-2 text-gray-400">{agent.email}</span>
                  {!agent.isActive && (
                    <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                      deactivated
                    </span>
                  )}
                </div>
                <form action={toggleActiveAction}>
                  <input type="hidden" name="targetUserId" value={agent.id} />
                  <input type="hidden" name="nextActive" value={(!agent.isActive).toString()} />
                  <button type="submit" className="text-xs text-gray-500 underline hover:text-gray-800">
                    {agent.isActive ? "Deactivate" : "Reactivate"}
                  </button>
                </form>
              </div>

              <form action={reassignManagerAction} className="mt-2 flex items-center gap-2">
                <input type="hidden" name="agentUserId" value={agent.id} />
                <label className="text-xs text-gray-500">Manager:</label>
                <select
                  key={agent.managerId ?? "unassigned"}
                  name="managerId"
                  defaultValue={agent.managerId ?? ""}
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
                >
                  <option value="">— unassigned —</option>
                  {managers.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.name}
                    </option>
                  ))}
                </select>
                <button type="submit" className="text-xs text-gray-500 underline hover:text-gray-800">
                  Save
                </button>
              </form>

              <div className="mt-2">
                <ResetPasswordButton userId={agent.id} />
              </div>
            </li>
          ))}
          {agents.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">No agents yet.</li>}
        </ul>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-medium text-gray-700">Add an agent</h2>
        <div className="mt-3">
          <CreateAgentForm managers={managers.map((m) => ({ id: m.id, name: m.name }))} />
        </div>
      </div>
    </div>
  );
}
