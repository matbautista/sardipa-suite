import { redirect } from "next/navigation";
import { getSetupStatus, createSuperAdmin, addInitialStorageLocation } from "@/lib/setup";
import { describeVolume } from "@/lib/storage-path";

async function createSuperAdminAction(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password !== confirmPassword) {
    redirect(`/setup?error=${encodeURIComponent("Passwords don't match.")}`);
  }

  const result = await createSuperAdmin(name, email, password);
  if (!result.ok) {
    redirect(`/setup?error=${encodeURIComponent(result.error)}`);
  }
  redirect("/setup");
}

async function addStorageLocationAction(formData: FormData) {
  "use server";
  const storagePath = String(formData.get("path") ?? "");
  const label = String(formData.get("label") ?? "");

  const result = await addInitialStorageLocation(storagePath, label);
  if (!result.ok) {
    redirect(`/setup?error=${encodeURIComponent(result.error)}`);
  }
  redirect("/login");
}

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const status = await getSetupStatus();

  if (status.isComplete) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">Saripda Suite — First-Run Setup</h1>
        <p className="mt-1 text-sm text-gray-500">
          {!status.hasSuperAdmin
            ? "Step 1 of 2: create the Super Admin account"
            : "Step 2 of 2: choose a document storage location"}
        </p>

        {error && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        {!status.hasSuperAdmin ? (
          <form action={createSuperAdminAction} className="mt-6 space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                Your name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password (at least 10 characters)
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                Confirm password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Create Super Admin account
            </button>
          </form>
        ) : (
          <form action={addStorageLocationAction} className="mt-6 space-y-4">
            <p className="text-xs text-gray-500">
              This is where uploaded documents (Proof of Payment, valid IDs, etc.) will
              live — it must be on a <strong>different physical disk</strong> than the app
              itself (the app is currently on {describeVolume(process.cwd())}). A second
              internal drive, an external drive, or a network path all work. The app won&apos;t
              finish setup until a valid path is chosen.
            </p>
            <div>
              <label htmlFor="label" className="block text-sm font-medium text-gray-700">
                Label
              </label>
              <input
                id="label"
                name="label"
                type="text"
                placeholder="e.g. Internal Drive D:"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="path" className="block text-sm font-medium text-gray-700">
                Storage path
              </label>
              <input
                id="path"
                name="path"
                type="text"
                required
                placeholder="e.g. D:\SaripdaDocuments"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Finish setup
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
