import { notFound, redirect } from "next/navigation";
import { requireAgencySession } from "@/lib/session";
import {
  getLifeDetails,
  saveInsured,
  saveOwner,
  saveBeneficiary,
  deleteBeneficiary,
  computeAge,
  type PersonInput,
  type OwnerExtraInput,
  type BeneficiaryInput,
} from "@/lib/life-details";
import { getLockStatus, checkOut, checkIn } from "@/lib/record-lock";
import { getPolicyOwnerId } from "@/lib/policies";
import { resolveAccessibleOwner } from "@/lib/team-access";

const RECORD_TYPE = "policy";

type PersonLike = {
  firstName: string;
  middleName: string | null;
  lastName: string;
  height: number | null;
  weightLbs: number | null;
  presentAddress: string | null;
  permanentAddress: string | null;
  mobileNo: string | null;
  telephoneNo: string | null;
  religion: string | null;
  civilStatus: string | null;
  birthdate: Date;
  birthplace: string | null;
  genderAtBirth: string | null;
  weightAtBirth: number | null;
  fatherStatus: string | null;
  fatherAgeOrAgeAtDeath: number | null;
  motherStatus: string | null;
  motherAgeOrAgeAtDeath: number | null;
  brotherAge1: number | null;
  brotherAge2: number | null;
  brotherAge3: number | null;
  sisterAge1: number | null;
  sisterAge2: number | null;
  sisterAge3: number | null;
} | null;

function toDateInputValue(date: Date | null | undefined): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

function readPersonInput(formData: FormData): PersonInput {
  const field = (name: string) => String(formData.get(name) ?? "");
  return {
    firstName: field("firstName"),
    middleName: field("middleName"),
    lastName: field("lastName"),
    height: field("height"),
    weightLbs: field("weightLbs"),
    presentAddress: field("presentAddress"),
    permanentAddress: field("permanentAddress"),
    mobileNo: field("mobileNo"),
    telephoneNo: field("telephoneNo"),
    religion: field("religion"),
    civilStatus: field("civilStatus"),
    birthdate: field("birthdate"),
    birthplace: field("birthplace"),
    genderAtBirth: field("genderAtBirth"),
    weightAtBirth: field("weightAtBirth"),
    fatherStatus: field("fatherStatus"),
    fatherAgeOrAgeAtDeath: field("fatherAgeOrAgeAtDeath"),
    motherStatus: field("motherStatus"),
    motherAgeOrAgeAtDeath: field("motherAgeOrAgeAtDeath"),
    brotherAge1: field("brotherAge1"),
    brotherAge2: field("brotherAge2"),
    brotherAge3: field("brotherAge3"),
    sisterAge1: field("sisterAge1"),
    sisterAge2: field("sisterAge2"),
    sisterAge3: field("sisterAge3"),
  };
}

function PersonFieldset({ person, required = true }: { person: PersonLike; required?: boolean }) {
  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-700">First name</label>
          <input name="firstName" required={required} defaultValue={person?.firstName ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700">Middle name</label>
          <input name="middleName" defaultValue={person?.middleName ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700">Last name</label>
          <input name="lastName" required={required} defaultValue={person?.lastName ?? ""} className={inputClass} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-700">Birthdate</label>
          <input
            name="birthdate"
            type="date"
            required={required}
            defaultValue={toDateInputValue(person?.birthdate)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700">Age</label>
          <input
            disabled
            readOnly
            value={person?.birthdate ? computeAge(person.birthdate) : ""}
            placeholder="computed"
            className={`${inputClass} bg-gray-50 text-gray-400`}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700">Birthplace</label>
          <input name="birthplace" defaultValue={person?.birthplace ?? ""} className={inputClass} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-700">Height</label>
          <input name="height" type="number" step="0.1" defaultValue={person?.height ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700">Weight (lbs)</label>
          <input name="weightLbs" type="number" step="0.1" defaultValue={person?.weightLbs ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700">Weight at birth (lbs)</label>
          <input name="weightAtBirth" type="number" step="0.1" defaultValue={person?.weightAtBirth ?? ""} className={inputClass} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-700">Present address</label>
          <input name="presentAddress" defaultValue={person?.presentAddress ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700">Permanent address</label>
          <input name="permanentAddress" defaultValue={person?.permanentAddress ?? ""} className={inputClass} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-700">Mobile no.</label>
          <input name="mobileNo" defaultValue={person?.mobileNo ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700">Telephone no.</label>
          <input name="telephoneNo" defaultValue={person?.telephoneNo ?? ""} className={inputClass} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-700">Religion</label>
          <input name="religion" defaultValue={person?.religion ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700">Civil status</label>
          <input name="civilStatus" defaultValue={person?.civilStatus ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700">Gender at birth</label>
          <input name="genderAtBirth" defaultValue={person?.genderAtBirth ?? ""} className={inputClass} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex gap-2">
          <select name="fatherStatus" defaultValue={person?.fatherStatus ?? ""} className={inputClass}>
            <option value="">Father —</option>
            <option value="alive">Alive</option>
            <option value="deceased">Deceased</option>
          </select>
          <input
            name="fatherAgeOrAgeAtDeath"
            type="number"
            placeholder="Age"
            defaultValue={person?.fatherAgeOrAgeAtDeath ?? ""}
            className={inputClass}
          />
        </div>
        <div className="flex gap-2">
          <select name="motherStatus" defaultValue={person?.motherStatus ?? ""} className={inputClass}>
            <option value="">Mother —</option>
            <option value="alive">Alive</option>
            <option value="deceased">Deceased</option>
          </select>
          <input
            name="motherAgeOrAgeAtDeath"
            type="number"
            placeholder="Age"
            defaultValue={person?.motherAgeOrAgeAtDeath ?? ""}
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">Brothers&apos; ages (up to 3)</label>
        <div className="grid grid-cols-3 gap-4">
          <input name="brotherAge1" type="number" defaultValue={person?.brotherAge1 ?? ""} className={inputClass} />
          <input name="brotherAge2" type="number" defaultValue={person?.brotherAge2 ?? ""} className={inputClass} />
          <input name="brotherAge3" type="number" defaultValue={person?.brotherAge3 ?? ""} className={inputClass} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">Sisters&apos; ages (up to 3)</label>
        <div className="grid grid-cols-3 gap-4">
          <input name="sisterAge1" type="number" defaultValue={person?.sisterAge1 ?? ""} className={inputClass} />
          <input name="sisterAge2" type="number" defaultValue={person?.sisterAge2 ?? ""} className={inputClass} />
          <input name="sisterAge3" type="number" defaultValue={person?.sisterAge3 ?? ""} className={inputClass} />
        </div>
      </div>
    </>
  );
}

const inputClass =
  "mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none";

const BENEFICIARY_SLOTS: { type: "primary" | "contingent"; slot: number; label: string }[] = [
  { type: "primary", slot: 1, label: "Primary Beneficiary 1" },
  { type: "primary", slot: 2, label: "Primary Beneficiary 2" },
  { type: "primary", slot: 3, label: "Primary Beneficiary 3" },
  { type: "contingent", slot: 1, label: "Contingent Beneficiary 1" },
  { type: "contingent", slot: 2, label: "Contingent Beneficiary 2" },
];

export default async function LifeDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireAgencySession();
  const { id } = await params;
  const { error } = await searchParams;

  // Same "resolve access once" pattern as policies/[id]/page.tsx (phase 12).
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

  async function saveInsuredAction(formData: FormData) {
    "use server";
    const session = await requireAgencySession();
    const ownerId = await resolveOwnerOrRedirect();
    const isSmoker = formData.get("isSmoker") === "on";
    const result = await saveInsured(session.user.agencyId, ownerId, id, isSmoker, readPersonInput(formData));
    if (!result.ok) {
      redirect(`/policies/${id}/life?error=${encodeURIComponent(result.error)}`);
    }
    redirect(`/policies/${id}/life`);
  }

  async function saveOwnerAction(formData: FormData) {
    "use server";
    const session = await requireAgencySession();
    const ownerId = await resolveOwnerOrRedirect();
    const isSameAsInsured = formData.get("isSameAsInsured") === "on";
    const extra: OwnerExtraInput = {
      employerBusinessName: String(formData.get("employerBusinessName") ?? ""),
      employerBusinessAddress: String(formData.get("employerBusinessAddress") ?? ""),
      natureOfBusiness: String(formData.get("natureOfBusiness") ?? ""),
      occupation: String(formData.get("occupation") ?? ""),
      totalYearsEmployment: String(formData.get("totalYearsEmployment") ?? ""),
      tinNo: String(formData.get("tinNo") ?? ""),
      sssNo: String(formData.get("sssNo") ?? ""),
      validIdType: String(formData.get("validIdType") ?? ""),
      validIdNo: String(formData.get("validIdNo") ?? ""),
      validIdExpirationDate: String(formData.get("validIdExpirationDate") ?? ""),
    };
    const result = await saveOwner(
      session.user.agencyId,
      ownerId,
      id,
      isSameAsInsured,
      readPersonInput(formData),
      extra
    );
    if (!result.ok) {
      redirect(`/policies/${id}/life?error=${encodeURIComponent(result.error)}`);
    }
    redirect(`/policies/${id}/life`);
  }

  async function saveBeneficiaryAction(formData: FormData) {
    "use server";
    const session = await requireAgencySession();
    const ownerId = await resolveOwnerOrRedirect();
    const beneficiaryType = String(formData.get("beneficiaryType") ?? "") as "primary" | "contingent";
    const slotNumber = Number(formData.get("slotNumber"));
    const input: BeneficiaryInput = {
      firstName: String(formData.get("firstName") ?? ""),
      middleName: String(formData.get("middleName") ?? ""),
      lastName: String(formData.get("lastName") ?? ""),
      permanentAddress: String(formData.get("permanentAddress") ?? ""),
      birthdate: String(formData.get("birthdate") ?? ""),
      mobileNo: String(formData.get("mobileNo") ?? ""),
      relationshipToInsured: String(formData.get("relationshipToInsured") ?? ""),
    };
    const result = await saveBeneficiary(session.user.agencyId, ownerId, id, beneficiaryType, slotNumber, input);
    if (!result.ok) {
      redirect(`/policies/${id}/life?error=${encodeURIComponent(result.error)}`);
    }
    redirect(`/policies/${id}/life`);
  }

  async function clearBeneficiaryAction(formData: FormData) {
    "use server";
    const session = await requireAgencySession();
    const ownerId = await resolveOwnerOrRedirect();
    const beneficiaryType = String(formData.get("beneficiaryType") ?? "");
    const slotNumber = Number(formData.get("slotNumber"));
    await deleteBeneficiary(session.user.agencyId, ownerId, id, beneficiaryType, slotNumber);
    redirect(`/policies/${id}/life`);
  }

  const recordOwnerId = await getPolicyOwnerId(session.user.agencyId, id);
  if (recordOwnerId === undefined) {
    notFound();
  }
  const accessibleOwnerId = await resolveAccessibleOwner(session.user.agencyId, session.user.id, session.user.role, recordOwnerId);
  if (!accessibleOwnerId) {
    notFound();
  }

  const details = await getLifeDetails(session.user.agencyId, accessibleOwnerId, id);
  if (!details) {
    notFound();
  }

  const lockStatus = await getLockStatus(session.user.agencyId, session.user.id, RECORD_TYPE, id);
  const lockedByOther = lockStatus.locked && !lockStatus.heldBySelf;
  if (!lockedByOther) {
    await checkOut(session.user.agencyId, session.user.id, RECORD_TYPE, id);
  }

  const { insured, owner, beneficiaries } = details;
  const beneficiaryByKey = new Map(beneficiaries.map((b) => [`${b.beneficiaryType}-${b.slotNumber}`, b]));

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Life Insurance Details</h1>
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

      <section className="mt-8">
        <h2 className="text-sm font-medium text-gray-700">Insured</h2>
        <form
          action={saveInsuredAction}
          inert={lockedByOther}
          className={`mt-3 space-y-4 rounded-md border border-gray-200 p-4 ${lockedByOther ? "opacity-50" : ""}`}
        >
          <PersonFieldset person={insured?.person ?? null} />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" name="isSmoker" defaultChecked={insured?.isSmoker ?? false} />
            Smoker
          </label>
          <button
            type="submit"
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            Save Insured
          </button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-gray-700">Owner</h2>
        <form
          action={saveOwnerAction}
          inert={lockedByOther}
          className={`mt-3 space-y-4 rounded-md border border-gray-200 p-4 ${lockedByOther ? "opacity-50" : ""}`}
        >
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" name="isSameAsInsured" defaultChecked={owner?.isSameAsInsured ?? false} />
            Same person as Insured
          </label>
          <p className="text-xs text-gray-400">
            If checked, the personal fields below are ignored and the Owner shares the Insured&apos;s record —
            save the Insured first. Employment/ID fields below always apply to the Owner regardless.
          </p>
          {/* Not required: when "Same person as Insured" is checked these
              fields are ignored server-side (saveOwner never reads them in
              that branch) — making them mandatory here would block
              submitting the form with them left blank, defeating the
              shortcut. Left genuinely empty and unchecked, the server-side
              validation in upsertPerson still catches it with a clear error. */}
          <PersonFieldset person={owner?.person ?? null} required={false} />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700">Employer / business name</label>
              <input name="employerBusinessName" defaultValue={owner?.employerBusinessName ?? ""} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">Employer / business address</label>
              <input
                name="employerBusinessAddress"
                defaultValue={owner?.employerBusinessAddress ?? ""}
                className={inputClass}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700">Nature of business</label>
              <input name="natureOfBusiness" defaultValue={owner?.natureOfBusiness ?? ""} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">Occupation</label>
              <input name="occupation" defaultValue={owner?.occupation ?? ""} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">Years in employment/business</label>
              <input
                name="totalYearsEmployment"
                type="number"
                defaultValue={owner?.totalYearsEmployment ?? ""}
                className={inputClass}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700">TIN No.</label>
              <input name="tinNo" defaultValue={owner?.tinNo ?? ""} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">SSS No.</label>
              <input name="sssNo" defaultValue={owner?.sssNo ?? ""} className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700">Valid ID type</label>
              <input name="validIdType" defaultValue={owner?.validIdType ?? ""} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">Valid ID No.</label>
              <input name="validIdNo" defaultValue={owner?.validIdNo ?? ""} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">Valid ID expiration</label>
              <input
                name="validIdExpirationDate"
                type="date"
                defaultValue={toDateInputValue(owner?.validIdExpirationDate)}
                className={inputClass}
              />
            </div>
          </div>
          <button
            type="submit"
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            Save Owner
          </button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-gray-700">Beneficiaries</h2>
        <p className="mt-1 text-xs text-gray-400">Up to 3 Primary and 2 Contingent beneficiaries.</p>
        <div className="mt-3 space-y-4">
          {BENEFICIARY_SLOTS.map(({ type, slot, label }) => {
            const existing = beneficiaryByKey.get(`${type}-${slot}`);
            return (
              <form
                key={`${type}-${slot}`}
                action={saveBeneficiaryAction}
                inert={lockedByOther}
                className={`space-y-3 rounded-md border border-gray-200 p-4 ${lockedByOther ? "opacity-50" : ""}`}
              >
                <input type="hidden" name="beneficiaryType" value={type} />
                <input type="hidden" name="slotNumber" value={slot} />
                <h3 className="text-xs font-medium text-gray-700">{label}</h3>
                <div className="grid grid-cols-3 gap-4">
                  <input
                    name="firstName"
                    placeholder="First name"
                    defaultValue={existing?.firstName ?? ""}
                    className={inputClass}
                  />
                  <input
                    name="middleName"
                    placeholder="Middle name"
                    defaultValue={existing?.middleName ?? ""}
                    className={inputClass}
                  />
                  <input
                    name="lastName"
                    placeholder="Last name"
                    defaultValue={existing?.lastName ?? ""}
                    className={inputClass}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <input
                    name="permanentAddress"
                    placeholder="Permanent address"
                    defaultValue={existing?.permanentAddress ?? ""}
                    className={inputClass}
                  />
                  <input
                    name="mobileNo"
                    placeholder="Mobile no."
                    defaultValue={existing?.mobileNo ?? ""}
                    className={inputClass}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700">Birthdate</label>
                    <input
                      name="birthdate"
                      type="date"
                      defaultValue={toDateInputValue(existing?.birthdate)}
                      className={inputClass}
                    />
                  </div>
                  <input
                    name="relationshipToInsured"
                    placeholder="Relationship to Insured"
                    defaultValue={existing?.relationshipToInsured ?? ""}
                    className={`${inputClass} self-end`}
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    type="submit"
                    className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
                  >
                    Save
                  </button>
                  {existing && (
                    <button
                      type="submit"
                      formAction={clearBeneficiaryAction}
                      className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </form>
            );
          })}
        </div>
      </section>
    </div>
  );
}
