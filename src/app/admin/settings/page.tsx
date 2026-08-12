import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSuperAdminSession } from "@/lib/session";
import { getHostAddress, updateHostAddress, buildLanUrl } from "@/lib/system-config";
import { listStorageLocations, addStorageLocation } from "@/lib/storage-locations";
import { describeVolume } from "@/lib/storage-path";

// System Configuration (Section 10 phase 17 / Section 5's "System
// Configuration (Super Admin)" — cross-referenced directly by Section 8's
// deployment guidance: "That same IP is entered into the app's System
// Configuration page so the app can display/share the correct LAN URL.")
// Never built in an earlier phase; added here since phase 17's packaging
// work is exactly what makes this settings page's purpose concrete — a
// real host IP to advertise on a real LAN deployment.

async function updateHostAddressAction(formData: FormData) {
  "use server";
  await requireSuperAdminSession();
  const hostIp = String(formData.get("hostIp") ?? "");
  const hostPort = String(formData.get("hostPort") ?? "");

  const result = await updateHostAddress(hostIp, hostPort);
  if (!result.ok) {
    redirect(`/admin/settings?error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/admin/settings?success=${encodeURIComponent("Saved.")}`);
}

async function addStorageLocationAction(formData: FormData) {
  "use server";
  const session = await requireSuperAdminSession();
  const storagePath = String(formData.get("path") ?? "");
  const label = String(formData.get("label") ?? "");

  const result = await addStorageLocation(session.user.id, storagePath, label);
  if (!result.ok) {
    redirect(`/admin/settings?error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/admin/settings?success=${encodeURIComponent("New storage location added and made active.")}`);
}

export default async function SystemSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  await requireSuperAdminSession();
  const { error, success } = await searchParams;
  const [{ hostIp, hostPort }, storageLocations] = await Promise.all([getHostAddress(), listStorageLocations()]);
  const lanUrl = buildLanUrl(hostIp, hostPort);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">System Configuration</h1>
        <Link href="/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
          Back to dashboard
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        The host machine&apos;s LAN address, so the app knows what to advertise on a &quot;share this
        link with your team&quot; screen. This doesn&apos;t configure the network itself — set a static IP
        at the OS or router level first (Section 8), then enter that same address here.
      </p>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {success && <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}

      <div className="mt-6 rounded-md border border-gray-200 p-4 text-sm">
        <p className="text-gray-500">Current LAN URL</p>
        <p className="mt-1 font-mono text-gray-900">{lanUrl ?? "Not set yet"}</p>
      </div>

      <form action={updateHostAddressAction} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Host IP address</label>
          <input
            name="hostIp"
            type="text"
            required
            defaultValue={hostIp ?? ""}
            placeholder="e.g. 192.168.1.50"
            className="mt-1 block w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Port (optional — defaults to 3000)</label>
          <input
            name="hostPort"
            type="number"
            defaultValue={hostPort ?? ""}
            placeholder="3000"
            className="mt-1 block w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="inline-block min-w-[170px] rounded-md btn-primary px-4 py-2 text-center text-sm font-medium"
        >
          Save
        </button>
      </form>

      <div className="mt-10 border-t border-gray-200 pt-8">
        <h2 className="text-sm font-medium text-gray-700">Document storage locations</h2>
        <p className="mt-1 text-xs text-gray-400">
          Only one location is active (where new uploads go) at a time. Adding a new one doesn&apos;t
          strand documents already saved on an older location — those keep working from wherever
          they already are (Section 5). See <Link href="/admin/health" className="underline">System health</Link> for
          free-space status per location.
        </p>
        <ul className="mt-3 divide-y divide-gray-200 rounded-md border border-gray-200">
          {storageLocations.map((location) => (
            <li key={location.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <span className="text-gray-800">{location.label}</span>
                <span className="ml-2 text-xs text-gray-400">{location.path}</span>
              </div>
              <span className={location.isActive ? "text-xs font-medium text-green-700" : "text-xs text-gray-400"}>
                {location.isActive ? "Active" : "Inactive"}
              </span>
            </li>
          ))}
          {storageLocations.length === 0 && (
            <li className="px-4 py-3 text-sm text-gray-400">None configured yet.</li>
          )}
        </ul>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-900">
            Add a new storage location
          </summary>
          <div className="mt-3 rounded-md border border-gray-200 p-4">
            <form action={addStorageLocationAction} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700">Label</label>
                <input
                  name="label"
                  type="text"
                  placeholder="e.g. Internal Drive E:"
                  className="mt-1 block w-full max-w-xs rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700">Storage path</label>
                <input
                  name="path"
                  type="text"
                  required
                  placeholder="e.g. E:\SaripdaDocuments"
                  className="mt-1 block w-full max-w-xs rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Must be on a different physical disk than the app itself (the app is currently on{" "}
                  {describeVolume(process.cwd())}).
                </p>
              </div>
              <button
                type="submit"
                className="inline-block min-w-[110px] rounded-md btn-primary px-2.5 py-1 text-center text-xs font-medium"
              >
                Add and make active
              </button>
            </form>
          </div>
        </details>
      </div>
    </div>
  );
}
