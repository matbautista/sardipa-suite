import { notFound, redirect } from "next/navigation";
import { requireAgencySession } from "@/lib/session";
import { getTravelDetails, saveTravelDetails, type TravelDetailsInput } from "@/lib/travel-details";
import { getLockStatus, checkOut, checkIn } from "@/lib/record-lock";
import { getPolicyOwnerId } from "@/lib/policies";
import { resolveAccessibleOwner } from "@/lib/team-access";

const RECORD_TYPE = "policy";
const COVERAGE_TYPES = ["medical", "baggage", "trip_cancellation", "comprehensive"] as const;

const inputClass =
  "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none";

export default async function TravelDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireAgencySession();
  const { id } = await params;
  const { error } = await searchParams;

  async function resolveOwnerOrRedirect(): Promise<string> {
    "use server";
    const session = await requireAgencySession();
    const recordOwnerId = await getPolicyOwnerId(session.user.agencyId, id);
    if (recordOwnerId === undefined) {
      redirect(`/policies/${id}`);
    }
    const accessibleOwnerId = await resolveAccessibleOwner(session.user.agencyId, session.user.id, session.user.role, recordOwnerId);
    if (!accessibleOwnerId) {
      redirect(`/policies/${id}`);
    }
    return accessibleOwnerId;
  }

  async function backToPolicyAction() {
    "use server";
    const session = await requireAgencySession();
    await checkIn(session.user.agencyId, session.user.id, RECORD_TYPE, id);
    redirect(`/policies/${id}`);
  }

  async function saveAction(formData: FormData) {
    "use server";
    const session = await requireAgencySession();
    const ownerId = await resolveOwnerOrRedirect();
    const input: TravelDetailsInput = {
      travelerName: String(formData.get("travelerName") ?? ""),
      passportNo: String(formData.get("passportNo") ?? ""),
      destination: String(formData.get("destination") ?? ""),
      purposeOfTravel: String(formData.get("purposeOfTravel") ?? ""),
      coverageType: String(formData.get("coverageType") ?? ""),
    };
    const result = await saveTravelDetails(session.user.agencyId, ownerId, id, input);
    if (!result.ok) {
      redirect(`/policies/${id}/travel?error=${encodeURIComponent(result.error)}`);
    }
    await checkIn(session.user.agencyId, session.user.id, RECORD_TYPE, id);
    redirect(`/policies/${id}`);
  }

  const recordOwnerId = await getPolicyOwnerId(session.user.agencyId, id);
  if (recordOwnerId === undefined) {
    notFound();
  }
  const accessibleOwnerId = await resolveAccessibleOwner(session.user.agencyId, session.user.id, session.user.role, recordOwnerId);
  if (!accessibleOwnerId) {
    notFound();
  }

  const detail = await getTravelDetails(session.user.agencyId, accessibleOwnerId, id);
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
        <h1 className="text-xl font-semibold text-gray-900">Travel Details</h1>
        <form action={backToPolicyAction}>
          <button type="submit" className="text-sm text-gray-500 underline hover:text-gray-800">
            Back to policy
          </button>
        </form>
      </div>

      <p className="mt-1 text-xs text-gray-400">
        Trip start/end dates are the policy&apos;s own Start date / Renewal date fields — not repeated here.
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
            <label className="block text-sm font-medium text-gray-700">Traveler name</label>
            <input name="travelerName" required defaultValue={detail?.travelerName ?? ""} className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Passport number</label>
            <input name="passportNo" required defaultValue={detail?.passportNo ?? ""} className={inputClass} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Destination(s)</label>
          <input name="destination" required defaultValue={detail?.destination ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Purpose of travel (optional)</label>
          <input name="purposeOfTravel" defaultValue={detail?.purposeOfTravel ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Coverage type</label>
          <select name="coverageType" required defaultValue={detail?.coverageType ?? ""} className={inputClass}>
            <option value="">— choose —</option>
            {COVERAGE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace("_", " ")}
              </option>
            ))}
          </select>
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
