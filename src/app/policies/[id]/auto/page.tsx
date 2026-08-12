import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAgencySession } from "@/lib/session";
import { getAutoDetails, saveAutoDetails, type AutoDetailsInput } from "@/lib/auto-details";
import { getLockStatus, checkOut, checkIn, isLockedByOther } from "@/lib/record-lock";
import { getPolicyOwnerId } from "@/lib/policies";
import { resolveAccessibleOwner } from "@/lib/team-access";

const RECORD_TYPE = "policy";

const inputClass =
  "mt-1 block w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none";

export default async function AutoDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; edit?: string }>;
}) {
  const session = await requireAgencySession();
  const { id } = await params;
  const { error, edit } = await searchParams;

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
    if (await isLockedByOther(session.user.agencyId, session.user.id, RECORD_TYPE, id)) {
      redirect(`/policies/${id}/auto?error=${encodeURIComponent("This record is being edited by someone else.")}`);
    }
    const input: AutoDetailsInput = {
      completeName: String(formData.get("completeName") ?? ""),
      carMaker: String(formData.get("carMaker") ?? ""),
      carModel: String(formData.get("carModel") ?? ""),
      yearReleased: String(formData.get("yearReleased") ?? ""),
    };
    const result = await saveAutoDetails(session.user.agencyId, ownerId, id, input);
    if (!result.ok) {
      redirect(`/policies/${id}/auto?error=${encodeURIComponent(result.error)}`);
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

  const details = await getAutoDetails(session.user.agencyId, accessibleOwnerId, id);
  if (!details) {
    notFound();
  }

  // Only "?edit=1" (the Edit button below) checks the record out — plain
  // viewing never does (Section 5: "viewing a record never requires a
  // lock — only entering edit mode does").
  const editMode = edit === "1";
  const lockStatus = await getLockStatus(session.user.agencyId, session.user.id, RECORD_TYPE, id);
  const lockedByOther = lockStatus.locked && !lockStatus.heldBySelf;
  if (editMode && !lockedByOther) {
    await checkOut(session.user.agencyId, session.user.id, RECORD_TYPE, id);
  }
  const formInert = lockedByOther || !editMode;

  const { autoOwner, vehicle } = details;

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Owner &amp; Vehicle Details</h1>
        <div className="flex items-center gap-4">
          {!editMode && !lockedByOther && (
            <Link href={`/policies/${id}/auto?edit=1`} className="text-sm text-gray-500 underline hover:text-gray-800">
              Edit
            </Link>
          )}
          <form action={backToPolicyAction}>
            <button type="submit" className="text-sm text-gray-500 underline hover:text-gray-800">
              Back to policy
            </button>
          </form>
        </div>
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
        inert={formInert}
        className={`mt-8 space-y-4 rounded-md border border-gray-200 p-4 ${formInert ? "opacity-50" : ""}`}
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
          className="inline-block min-w-[170px] rounded-md btn-primary px-4 py-2 text-center text-sm font-medium"
        >
          Save
        </button>
      </form>
    </div>
  );
}
