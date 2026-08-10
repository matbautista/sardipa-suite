import { notFound, redirect } from "next/navigation";
import { requireAgencySession } from "@/lib/session";
import { getAutoDetails, saveAutoDetails, type AutoDetailsInput } from "@/lib/auto-details";
import { getLockStatus, checkOut, checkIn } from "@/lib/record-lock";

const RECORD_TYPE = "policy";

const inputClass =
  "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none";

export default async function AutoDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireAgencySession();
  const { id } = await params;
  const { error } = await searchParams;

  async function backToPolicyAction() {
    "use server";
    const session = await requireAgencySession();
    await checkIn(session.user.agencyId, session.user.id, RECORD_TYPE, id);
    redirect(`/policies/${id}`);
  }

  async function saveAction(formData: FormData) {
    "use server";
    const session = await requireAgencySession();
    const input: AutoDetailsInput = {
      completeName: String(formData.get("completeName") ?? ""),
      carMaker: String(formData.get("carMaker") ?? ""),
      carModel: String(formData.get("carModel") ?? ""),
      yearReleased: String(formData.get("yearReleased") ?? ""),
    };
    const result = await saveAutoDetails(session.user.agencyId, session.user.id, id, input);
    if (!result.ok) {
      redirect(`/policies/${id}/auto?error=${encodeURIComponent(result.error)}`);
    }
    await checkIn(session.user.agencyId, session.user.id, RECORD_TYPE, id);
    redirect(`/policies/${id}`);
  }

  const details = await getAutoDetails(session.user.agencyId, session.user.id, id);
  if (!details) {
    notFound();
  }

  const lockStatus = await getLockStatus(session.user.agencyId, session.user.id, RECORD_TYPE, id);
  const lockedByOther = lockStatus.locked && !lockStatus.heldBySelf;
  if (!lockedByOther) {
    await checkOut(session.user.agencyId, session.user.id, RECORD_TYPE, id);
  }

  const { autoOwner, vehicle } = details;

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Owner &amp; Vehicle Details</h1>
        <form action={backToPolicyAction}>
          <button type="submit" className="text-sm text-gray-500 underline hover:text-gray-800">
            Back to policy
          </button>
        </form>
      </div>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {lockedByOther && lockStatus.locked && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Currently being edited by {lockStatus.holderName}, since {lockStatus.lockedAt.toLocaleString()}.
          Read-only until they save or the lock expires.
        </p>
      )}

      <form
        action={saveAction}
        inert={lockedByOther}
        className={`mt-8 space-y-4 rounded-md border border-gray-200 p-4 ${lockedByOther ? "opacity-50" : ""}`}
      >
        <div>
          <label className="block text-sm font-medium text-gray-700">Complete name of owner</label>
          <input
            name="completeName"
            required
            defaultValue={autoOwner?.completeName ?? ""}
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Car maker</label>
            <input name="carMaker" required defaultValue={vehicle?.carMaker ?? ""} className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Car model</label>
            <input name="carModel" required defaultValue={vehicle?.carModel ?? ""} className={inputClass} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Year released</label>
          <input
            name="yearReleased"
            type="number"
            required
            defaultValue={vehicle?.yearReleased ?? ""}
            className={inputClass}
          />
        </div>
        <p className="text-xs text-gray-400">
          Extended fields (plate number, chassis number, OR/CR, coverage type, etc.) are proposed but not yet
          confirmed against this agency&apos;s actual forms (Section 11) — not built yet.
        </p>
        <button
          type="submit"
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Save
        </button>
      </form>
    </div>
  );
}
