import { notFound, redirect } from "next/navigation";
import { requireAgencySession } from "@/lib/session";
import { getPropertyDetails, savePropertyDetails, type PropertyDetailsInput } from "@/lib/property-details";
import { getLockStatus, checkOut, checkIn } from "@/lib/record-lock";

const RECORD_TYPE = "policy";
const CONSTRUCTION_TYPES = ["concrete", "wood", "mixed"] as const;
const OCCUPANCY_USES = ["residential", "commercial", "industrial"] as const;

const inputClass =
  "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none";

export default async function PropertyDetailsPage({
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
    const input: PropertyDetailsInput = {
      propertyAddress: String(formData.get("propertyAddress") ?? ""),
      constructionType: String(formData.get("constructionType") ?? ""),
      occupancyUse: String(formData.get("occupancyUse") ?? ""),
      sumInsured: String(formData.get("sumInsured") ?? ""),
      perilsCovered: String(formData.get("perilsCovered") ?? ""),
    };
    const result = await savePropertyDetails(session.user.agencyId, session.user.id, id, input);
    if (!result.ok) {
      redirect(`/policies/${id}/property?error=${encodeURIComponent(result.error)}`);
    }
    await checkIn(session.user.agencyId, session.user.id, RECORD_TYPE, id);
    redirect(`/policies/${id}`);
  }

  const detail = await getPropertyDetails(session.user.agencyId, session.user.id, id);
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
        <h1 className="text-xl font-semibold text-gray-900">Property Details</h1>
        <form action={backToPolicyAction}>
          <button type="submit" className="text-sm text-gray-500 underline hover:text-gray-800">
            Back to policy
          </button>
        </form>
      </div>

      <p className="mt-1 text-xs text-gray-400">
        These fields are an industry-typical draft, not yet verified against this agency&apos;s actual forms
        (Section 11/12) — expect them to change once that&apos;s confirmed. Proof of Ownership is uploaded as a
        document on the policy page, not entered here.
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
        <div>
          <label className="block text-sm font-medium text-gray-700">Property address / location</label>
          <input name="propertyAddress" required defaultValue={detail?.propertyAddress ?? ""} className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Construction type</label>
            <select name="constructionType" defaultValue={detail?.constructionType ?? ""} className={inputClass}>
              <option value="">— none —</option>
              {CONSTRUCTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Occupancy / use</label>
            <select name="occupancyUse" defaultValue={detail?.occupancyUse ?? ""} className={inputClass}>
              <option value="">— none —</option>
              {OCCUPANCY_USES.map((use) => (
                <option key={use} value={use}>
                  {use}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Sum insured / property value</label>
          <input name="sumInsured" type="number" step="0.01" defaultValue={detail?.sumInsured ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Perils covered</label>
          <input
            name="perilsCovered"
            placeholder="e.g. fire, lightning, earthquake, flood/typhoon"
            defaultValue={detail?.perilsCovered ?? ""}
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
