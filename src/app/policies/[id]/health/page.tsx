import { notFound, redirect } from "next/navigation";
import { requireAgencySession } from "@/lib/session";
import { getHealthDetails, saveHealthDetails, type HealthDetailsInput } from "@/lib/health-details";
import { getLockStatus, checkOut, checkIn } from "@/lib/record-lock";

const RECORD_TYPE = "policy";

const inputClass =
  "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none";

function toDateInputValue(date: Date | null | undefined): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

export default async function HealthDetailsPage({
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
    const input: HealthDetailsInput = {
      insuredName: String(formData.get("insuredName") ?? ""),
      insuredBirthdate: String(formData.get("insuredBirthdate") ?? ""),
      existingMedicalConditions: String(formData.get("existingMedicalConditions") ?? ""),
      planCoverageTier: String(formData.get("planCoverageTier") ?? ""),
      dependents: String(formData.get("dependents") ?? ""),
      roomBoardLimit: String(formData.get("roomBoardLimit") ?? ""),
      preexistingConditionDisclosure: String(formData.get("preexistingConditionDisclosure") ?? ""),
    };
    const result = await saveHealthDetails(session.user.agencyId, session.user.id, id, input);
    if (!result.ok) {
      redirect(`/policies/${id}/health?error=${encodeURIComponent(result.error)}`);
    }
    await checkIn(session.user.agencyId, session.user.id, RECORD_TYPE, id);
    redirect(`/policies/${id}`);
  }

  const detail = await getHealthDetails(session.user.agencyId, session.user.id, id);
  if (detail === undefined) {
    notFound();
  }

  const lockStatus = await getLockStatus(session.user.agencyId, session.user.id, RECORD_TYPE, id);
  const lockedByOther = lockStatus.locked && !lockStatus.heldBySelf;
  if (!lockedByOther) {
    await checkOut(session.user.agencyId, session.user.id, RECORD_TYPE, id);
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Health Details</h1>
        <form action={backToPolicyAction}>
          <button type="submit" className="text-sm text-gray-500 underline hover:text-gray-800">
            Back to policy
          </button>
        </form>
      </div>

      <p className="mt-1 text-xs text-gray-400">
        These fields are an industry-typical draft, not yet verified against this agency&apos;s actual forms
        (Section 11/12) — expect them to change once that&apos;s confirmed.
      </p>

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
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Insured&apos;s name</label>
            <input name="insuredName" required defaultValue={detail?.insuredName ?? ""} className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Insured&apos;s birthdate</label>
            <input
              name="insuredBirthdate"
              type="date"
              required
              defaultValue={toDateInputValue(detail?.insuredBirthdate)}
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Existing medical conditions / history</label>
          <textarea
            name="existingMedicalConditions"
            rows={3}
            defaultValue={detail?.existingMedicalConditions ?? ""}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Plan / coverage tier</label>
          <input name="planCoverageTier" defaultValue={detail?.planCoverageTier ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Dependents (if family/group plan)</label>
          <textarea
            name="dependents"
            rows={3}
            placeholder="One per line: name, relationship, birthdate"
            defaultValue={detail?.dependents ?? ""}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Room &amp; board limit</label>
          <input
            name="roomBoardLimit"
            type="number"
            step="0.01"
            defaultValue={detail?.roomBoardLimit ?? ""}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Pre-existing condition disclosure</label>
          <textarea
            name="preexistingConditionDisclosure"
            rows={3}
            defaultValue={detail?.preexistingConditionDisclosure ?? ""}
            className={inputClass}
          />
        </div>
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
