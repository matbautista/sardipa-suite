import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSuperAdminSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { checkAllStorageLocations, getStorageSpaceInfo, stripLocationMarker } from "@/lib/storage-health";

// System Health page (Section 10 phase 15 / Section 9's Self-Healing:
// "shows current status of each storage location, app uptime, last few
// restart events, and any active alerts ... so self-healing stays visible
// and auditable rather than being invisible magic"). Super Admin only —
// this is host-level infrastructure, not scoped to any one agency.

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

const ALERT_TYPE_LABELS: Record<string, string> = {
  storage_full: "Storage running low",
  storage_unreachable: "Storage unreachable",
  email_intake_failure: "Email intake failure",
  restart_loop: "Restart loop",
  other: "Alert",
};

async function checkStorageNowAction() {
  "use server";
  const session = await requireSuperAdminSession();
  await checkAllStorageLocations();
  // Found in a full-app review: every other mutating action in this app
  // writes to ActivityLog; these two self-healing-surface actions
  // (Section 9) didn't. agencyId: null since this is host-level
  // infrastructure, same as storage-locations.ts's own writes.
  await prisma.activityLog.create({
    data: { userId: session.user.id, agencyId: null, action: "storage_check_run", note: null },
  });
  redirect(`/admin/health?success=${encodeURIComponent("Storage check complete.")}`);
}

async function resolveAlertAction(formData: FormData) {
  "use server";
  const session = await requireSuperAdminSession();
  const alertId = String(formData.get("alertId") ?? "");
  // Found in a full-app review: this previously updated straight away with
  // no existence check — a stale alertId (e.g. a double-submit, or the
  // alert already resolved from another tab) threw an unhandled Prisma
  // error instead of a friendly redirect.
  const alert = await prisma.systemAlert.findUnique({ where: { id: alertId } });
  if (!alert) {
    redirect(`/admin/health?error=${encodeURIComponent("That alert no longer exists — it may already be resolved.")}`);
  }
  await prisma.systemAlert.update({ where: { id: alertId }, data: { resolvedAt: new Date() } });
  // agencyId: alert.agencyId (not necessarily null) — an agency-scoped
  // alert (e.g. email intake failure) resolved by the Super Admin should
  // still show up on that agency's own activity log, per Section 9's "the
  // Agency Head (it's their mailbox) and Super Admin" both caring about it.
  await prisma.activityLog.create({
    data: {
      userId: session.user.id,
      agencyId: alert.agencyId,
      action: "alert_resolved",
      note: `${ALERT_TYPE_LABELS[alert.type] ?? alert.type}: ${alert.message}`,
    },
  });
  redirect(`/admin/health?success=${encodeURIComponent("Alert marked resolved.")}`);
}

export default async function SystemHealthPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  await requireSuperAdminSession();
  const { success, error } = await searchParams;

  const [storageLocations, restartEvents, activeAlerts, agencies] = await Promise.all([
    prisma.storageLocation.findMany({ orderBy: { addedAt: "asc" } }),
    prisma.restartEvent.findMany({ orderBy: { restartedAt: "desc" }, take: 10 }),
    prisma.systemAlert.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: "desc" } }),
    prisma.agency.findMany(),
  ]);
  const agencyNameById = new Map(agencies.map((agency) => [agency.id, agency.name]));

  // Live free-space read for display, on top of the periodic job's stored
  // isReachable/lastCheckedAt — this is a cheap, on-demand statfs call, not
  // another round of alert bookkeeping (that stays the periodic job's job).
  const freeSpaceByLocationId = new Map<string, string>();
  await Promise.all(
    storageLocations
      .filter((location) => location.isReachable)
      .map(async (location) => {
        try {
          const info = await getStorageSpaceInfo(location.path);
          freeSpaceByLocationId.set(location.id, `${formatBytes(info.freeBytes)} free (${Math.round(info.usedFraction * 100)}% used)`);
        } catch {
          // Live read failed even though the last periodic check passed —
          // just omit the figure rather than showing something stale/wrong.
        }
      })
  );

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">System Health</h1>
        <Link href="/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
          Back to dashboard
        </Link>
      </div>

      {success && <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}
      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-8">
        <h2 className="text-sm font-medium text-gray-700">App uptime</h2>
        <p className="mt-1 text-lg font-semibold text-gray-900">{formatUptime(process.uptime())}</p>
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">Active alerts ({activeAlerts.length})</h2>
        </div>
        <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
          {activeAlerts.map((alert) => (
            <li key={alert.id} className="px-4 py-3 text-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="font-medium text-red-700">{ALERT_TYPE_LABELS[alert.type] ?? alert.type}</span>
                  {alert.agencyId && (
                    <span className="ml-2 text-xs text-gray-400">
                      {agencyNameById.get(alert.agencyId) ?? "Unknown agency"}
                    </span>
                  )}
                  <p className="mt-1 text-gray-600">{stripLocationMarker(alert.message)}</p>
                  <p className="mt-1 text-xs text-gray-400">Since {alert.createdAt.toLocaleString()}</p>
                </div>
                <form action={resolveAlertAction}>
                  <input type="hidden" name="alertId" value={alert.id} />
                  <button type="submit" className="whitespace-nowrap text-xs text-gray-500 underline hover:text-gray-800">
                    Mark resolved
                  </button>
                </form>
              </div>
            </li>
          ))}
          {activeAlerts.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">No active alerts.</li>}
        </ul>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">Storage locations</h2>
          <form action={checkStorageNowAction}>
            <button type="submit" className="text-xs text-gray-500 underline hover:text-gray-800">
              Check now
            </button>
          </form>
        </div>
        <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
          {storageLocations.map((location) => (
            <li key={location.id} className="px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-800">
                  {location.label}
                  {location.isActive && <span className="ml-2 text-xs text-gray-400">(active)</span>}
                </span>
                <span className={location.isReachable ? "text-green-700" : "text-red-600"}>
                  {location.isReachable ? "Reachable" : "Unreachable"}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {location.path}
                {freeSpaceByLocationId.has(location.id) && <> · {freeSpaceByLocationId.get(location.id)}</>}
                {" · last checked "}
                {location.lastCheckedAt ? location.lastCheckedAt.toLocaleString() : "never"}
              </p>
            </li>
          ))}
          {storageLocations.length === 0 && (
            <li className="px-4 py-3 text-sm text-gray-400">No storage locations configured.</li>
          )}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-gray-700">Recent restart events</h2>
        <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
          {restartEvents.map((event) => (
            <li key={event.id} className="flex justify-between px-4 py-3 text-sm">
              <span className="text-gray-800">{event.reason}</span>
              <span className="text-gray-400">{event.restartedAt.toLocaleString()}</span>
            </li>
          ))}
          {restartEvents.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">No restarts recorded.</li>}
        </ul>
      </section>
    </div>
  );
}
