import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { changePassword } from "@/lib/change-password";
import { signOut } from "@/auth";

async function changePasswordAction(formData: FormData) {
  "use server";
  const session = await requireSession();

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmNewPassword = String(formData.get("confirmNewPassword") ?? "");

  const result = await changePassword(session.user.id, currentPassword, newPassword, confirmNewPassword);
  if (!result.ok) {
    redirect(`/change-password?error=${encodeURIComponent(result.error)}`);
  }

  // The session's JWT still carries the old mustChangePassword value (it's
  // a snapshot from login time, Section 7) — sign out so the next login
  // issues a fresh one, rather than trying to patch the current token.
  await signOut({ redirectTo: "/login?passwordChanged=1" });
}

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireSession();
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">Change your password</h1>
        <p className="mt-1 text-sm text-gray-500">
          {session.user.mustChangePassword
            ? "You're signed in with a temporary password — set your own before continuing."
            : `Signed in as ${session.user.name}.`}
        </p>

        {error && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <form action={changePasswordAction} className="mt-6 space-y-4">
          <div>
            <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700">
              Current password
            </label>
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
              New password (at least 10 characters)
            </label>
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="confirmNewPassword" className="block text-sm font-medium text-gray-700">
              Confirm new password
            </label>
            <input
              id="confirmNewPassword"
              name="confirmNewPassword"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md btn-primary px-3 py-2 text-sm font-medium"
          >
            Change password
          </button>
        </form>
      </div>
    </div>
  );
}
