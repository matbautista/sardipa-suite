import Link from "next/link";
import { redirect } from "next/navigation";
import { requireHeadSession } from "@/lib/session";
import {
  getEmailIntakeConfig,
  saveEmailIntakeConfig,
  pollMailboxForAgency,
  getActiveEmailIntakeAlert,
  type EmailIntakeConfigInput,
} from "@/lib/email-intake";

// Agency Head's mailbox settings for Website Inquiry Intake (Section 10
// phase 14 / Section 5's "Website Inquiry Intake"). One config row per
// agency; an agency may simply never fill this in if it doesn't want the
// feature (Section 6's EmailIntakeConfig comment).

async function saveConfigAction(formData: FormData) {
  "use server";
  const session = await requireHeadSession();

  const input: EmailIntakeConfigInput = {
    imapHost: String(formData.get("imapHost") ?? ""),
    imapPort: Number(formData.get("imapPort") ?? 0),
    username: String(formData.get("username") ?? ""),
    password: String(formData.get("password") ?? ""),
    folder: String(formData.get("folder") ?? ""),
    useSsl: formData.get("useSsl") === "on",
    isEnabled: formData.get("isEnabled") === "on",
  };

  const result = await saveEmailIntakeConfig(session.user.agencyId, input);
  if (!result.ok) {
    redirect(`/agency/email-intake?error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/agency/email-intake?success=${encodeURIComponent("Settings saved.")}`);
}

async function pollNowAction() {
  "use server";
  const session = await requireHeadSession();
  await pollMailboxForAgency(session.user.agencyId);
  redirect(`/agency/email-intake?success=${encodeURIComponent("Poll complete — see status below.")}`);
}

export default async function EmailIntakePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const session = await requireHeadSession();
  const { error, success } = await searchParams;

  const [config, activeAlert] = await Promise.all([
    getEmailIntakeConfig(session.user.agencyId),
    getActiveEmailIntakeAlert(session.user.agencyId),
  ]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Website Inquiry Intake</h1>
        <Link href="/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
          Back to dashboard
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        The CRM polls this inbox every 5 minutes over IMAP and turns structured inquiry emails into
        unassigned Leads (Section 5). An email that doesn&apos;t match the expected format still becomes
        a Lead, flagged for review, so nothing from the public site is ever silently dropped.
      </p>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {success && <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}

      {activeAlert && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Can&apos;t check this inbox for new inquiries — connection failed since{" "}
          {activeAlert.createdAt.toLocaleString()}. It will keep retrying on the normal schedule; emails
          aren&apos;t lost, they just wait until it&apos;s reachable again.
        </p>
      )}

      {config && (
        <div className="mt-6 rounded-md border border-gray-200 p-4 text-sm">
          <h2 className="text-sm font-medium text-gray-700">Current status</h2>
          <dl className="mt-2 space-y-1 text-gray-600">
            <div className="flex justify-between">
              <dt>Enabled</dt>
              <dd>{config.isEnabled ? "Yes" : "No"}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Last polled</dt>
              <dd>{config.lastPolledAt ? config.lastPolledAt.toLocaleString() : "Never"}</dd>
            </div>
            {config.lastErrorMessage && (
              <div className="flex justify-between gap-4">
                <dt>Last error</dt>
                <dd className="text-right text-red-600">{config.lastErrorMessage}</dd>
              </div>
            )}
          </dl>
          <form action={pollNowAction} className="mt-3">
            <button type="submit" className="text-xs text-gray-500 underline hover:text-gray-800">
              Poll now
            </button>
          </form>
        </div>
      )}

      <form action={saveConfigAction} className="mt-8 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">IMAP host</label>
          <input
            name="imapHost"
            type="text"
            required
            defaultValue={config?.imapHost ?? "imap.gmail.com"}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Port</label>
          <input
            name="imapPort"
            type="number"
            required
            defaultValue={config?.imapPort ?? 993}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Username</label>
          <input
            name="username"
            type="text"
            required
            defaultValue={config?.username ?? ""}
            placeholder="inquiries@youragency.com"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            {config ? "Password (leave blank to keep the current one)" : "Password"}
          </label>
          <p className="text-xs text-gray-400">
            For Gmail, this is an App Password generated with 2-Step Verification on, not the normal
            account password. Stored encrypted; never shown again after entry.
          </p>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Folder</label>
          <input
            name="folder"
            type="text"
            defaultValue={config?.folder ?? "INBOX"}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="useSsl"
            name="useSsl"
            type="checkbox"
            defaultChecked={config?.useSsl ?? true}
            className="h-4 w-4 rounded border-gray-300"
          />
          <label htmlFor="useSsl" className="text-sm text-gray-700">
            Use SSL/TLS
          </label>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="isEnabled"
            name="isEnabled"
            type="checkbox"
            defaultChecked={config?.isEnabled ?? true}
            className="h-4 w-4 rounded border-gray-300"
          />
          <label htmlFor="isEnabled" className="text-sm text-gray-700">
            Enabled — poll this mailbox on the regular schedule
          </label>
        </div>
        <button
          type="submit"
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          {config ? "Save changes" : "Set up mailbox intake"}
        </button>
      </form>
    </div>
  );
}
