import { getScopedPrisma } from "@/lib/tenant-db";

// Life insurance detail forms (Section 10 phase 10 / Section 11's Life
// Insurance field list). LifeInsured/LifeOwner/Beneficiary/Person carry no
// agencyId column of their own (Section 6) — they're reached only through
// a Policy's policyId, so every function here re-verifies policy ownership
// itself before touching any of them, the same way phase 9's documents.ts
// re-verifies through Policy rather than trusting a bare id.
//
// Unlike the core Policy fields (premium/dates/line/product, locked to
// draft-only editing per Section 5), nothing in the plan restricts editing
// Insured/Owner/Beneficiary data to draft policies only — this stays
// editable at any policy status (e.g. correcting an address after
// activation), gated only by the record lock like everything else on this
// page.

type ActionResult = { ok: true } | { ok: false; error: string };

export type PersonInput = {
  firstName: string;
  middleName: string;
  lastName: string;
  height: string;
  weightLbs: string;
  presentAddress: string;
  permanentAddress: string;
  mobileNo: string;
  telephoneNo: string;
  religion: string;
  civilStatus: string;
  birthdate: string;
  birthplace: string;
  genderAtBirth: string;
  weightAtBirth: string;
  fatherStatus: string;
  fatherAgeOrAgeAtDeath: string;
  motherStatus: string;
  motherAgeOrAgeAtDeath: string;
  brotherAge1: string;
  brotherAge2: string;
  brotherAge3: string;
  sisterAge1: string;
  sisterAge2: string;
  sisterAge3: string;
};

export type OwnerExtraInput = {
  employerBusinessName: string;
  employerBusinessAddress: string;
  natureOfBusiness: string;
  occupation: string;
  totalYearsEmployment: string;
  tinNo: string;
  sssNo: string;
  validIdType: string;
  validIdNo: string;
  validIdExpirationDate: string;
};

export type BeneficiaryInput = {
  firstName: string;
  middleName: string;
  lastName: string;
  permanentAddress: string;
  birthdate: string;
  mobileNo: string;
  relationshipToInsured: string;
};

export function computeAge(birthdate: Date): number {
  const today = new Date();
  let age = today.getFullYear() - birthdate.getFullYear();
  const hadBirthdayThisYear =
    today.getMonth() > birthdate.getMonth() ||
    (today.getMonth() === birthdate.getMonth() && today.getDate() >= birthdate.getDate());
  if (!hadBirthdayThisYear) age--;
  return age;
}

async function verifyOwnedPolicy(scoped: ReturnType<typeof getScopedPrisma>, ownerId: string, policyId: string) {
  const policy = await scoped.policy.findUnique({ where: { id: policyId } });
  return policy && policy.ownerId === ownerId ? policy : null;
}

export async function getLifeDetails(agencyId: string, ownerId: string, policyId: string) {
  const scoped = getScopedPrisma(agencyId);
  const policy = await scoped.policy.findUnique({ where: { id: policyId }, include: { line: true } });
  if (!policy || policy.ownerId !== ownerId || policy.line.category !== "life") return null;

  const [insured, owner, beneficiaries] = await Promise.all([
    scoped.lifeInsured.findUnique({ where: { policyId }, include: { person: true } }),
    scoped.lifeOwner.findUnique({ where: { policyId }, include: { person: true } }),
    scoped.beneficiary.findMany({ where: { policyId }, orderBy: [{ beneficiaryType: "asc" }, { slotNumber: "asc" }] }),
  ]);

  return { policy, insured, owner, beneficiaries };
}

function personData(input: PersonInput) {
  return {
    firstName: input.firstName.trim(),
    middleName: input.middleName.trim() || null,
    lastName: input.lastName.trim(),
    height: input.height ? Number(input.height) : null,
    weightLbs: input.weightLbs ? Number(input.weightLbs) : null,
    presentAddress: input.presentAddress.trim() || null,
    permanentAddress: input.permanentAddress.trim() || null,
    mobileNo: input.mobileNo.trim() || null,
    telephoneNo: input.telephoneNo.trim() || null,
    religion: input.religion.trim() || null,
    civilStatus: input.civilStatus.trim() || null,
    birthdate: new Date(input.birthdate),
    birthplace: input.birthplace.trim() || null,
    genderAtBirth: input.genderAtBirth.trim() || null,
    weightAtBirth: input.weightAtBirth ? Number(input.weightAtBirth) : null,
    fatherStatus: input.fatherStatus || null,
    fatherAgeOrAgeAtDeath: input.fatherAgeOrAgeAtDeath ? Number(input.fatherAgeOrAgeAtDeath) : null,
    motherStatus: input.motherStatus || null,
    motherAgeOrAgeAtDeath: input.motherAgeOrAgeAtDeath ? Number(input.motherAgeOrAgeAtDeath) : null,
    brotherAge1: input.brotherAge1 ? Number(input.brotherAge1) : null,
    brotherAge2: input.brotherAge2 ? Number(input.brotherAge2) : null,
    brotherAge3: input.brotherAge3 ? Number(input.brotherAge3) : null,
    sisterAge1: input.sisterAge1 ? Number(input.sisterAge1) : null,
    sisterAge2: input.sisterAge2 ? Number(input.sisterAge2) : null,
    sisterAge3: input.sisterAge3 ? Number(input.sisterAge3) : null,
  };
}

async function upsertPerson(
  scoped: ReturnType<typeof getScopedPrisma>,
  existingPersonId: string | null,
  input: PersonInput
): Promise<{ ok: true; personId: string } | { ok: false; error: string }> {
  if (!input.firstName.trim() || !input.lastName.trim()) {
    return { ok: false, error: "First and last name are required." };
  }
  if (!input.birthdate) {
    return { ok: false, error: "Birthdate is required." };
  }

  const data = personData(input);
  if (existingPersonId) {
    await scoped.person.update({ where: { id: existingPersonId }, data });
    return { ok: true, personId: existingPersonId };
  }
  const created = await scoped.person.create({ data });
  return { ok: true, personId: created.id };
}

export async function saveInsured(
  agencyId: string,
  ownerId: string,
  policyId: string,
  isSmoker: boolean,
  input: PersonInput
): Promise<ActionResult> {
  const scoped = getScopedPrisma(agencyId);
  const policy = await verifyOwnedPolicy(scoped, ownerId, policyId);
  if (!policy) {
    return { ok: false, error: "Policy not found." };
  }

  const existing = await scoped.lifeInsured.findUnique({ where: { policyId } });
  const personResult = await upsertPerson(scoped, existing?.personId ?? null, input);
  if (!personResult.ok) {
    return personResult;
  }

  if (existing) {
    await scoped.lifeInsured.update({ where: { policyId }, data: { isSmoker } });
  } else {
    await scoped.lifeInsured.create({ data: { policyId, personId: personResult.personId, isSmoker } });
  }

  return { ok: true };
}

export async function saveOwner(
  agencyId: string,
  ownerId: string,
  policyId: string,
  isSameAsInsured: boolean,
  input: PersonInput,
  extra: OwnerExtraInput
): Promise<ActionResult> {
  const scoped = getScopedPrisma(agencyId);
  const policy = await verifyOwnedPolicy(scoped, ownerId, policyId);
  if (!policy) {
    return { ok: false, error: "Policy not found." };
  }

  const existingOwner = await scoped.lifeOwner.findUnique({ where: { policyId } });

  let personId: string;
  if (isSameAsInsured) {
    const insured = await scoped.lifeInsured.findUnique({ where: { policyId } });
    if (!insured) {
      return { ok: false, error: "Save the Insured's details first before marking the Owner as the same person." };
    }
    // Points at the SAME Person row as LifeInsured, not a copy — editing
    // the Insured later automatically keeps the Owner's shared fields in
    // sync (Section 6's own comment on this relationship).
    personId = insured.personId;
  } else {
    // Only reuse an existing owner-specific Person row if the owner wasn't
    // previously "same as insured" — otherwise that id actually belongs to
    // the Insured, and editing it here would silently edit their record too.
    const existingOwnPersonId = existingOwner && !existingOwner.isSameAsInsured ? existingOwner.personId : null;
    const personResult = await upsertPerson(scoped, existingOwnPersonId, input);
    if (!personResult.ok) {
      return personResult;
    }
    personId = personResult.personId;
  }

  const extraData = {
    employerBusinessName: extra.employerBusinessName.trim() || null,
    employerBusinessAddress: extra.employerBusinessAddress.trim() || null,
    natureOfBusiness: extra.natureOfBusiness.trim() || null,
    occupation: extra.occupation.trim() || null,
    totalYearsEmployment: extra.totalYearsEmployment ? Number(extra.totalYearsEmployment) : null,
    tinNo: extra.tinNo.trim() || null,
    sssNo: extra.sssNo.trim() || null,
    validIdType: extra.validIdType.trim() || null,
    validIdNo: extra.validIdNo.trim() || null,
    validIdExpirationDate: extra.validIdExpirationDate ? new Date(extra.validIdExpirationDate) : null,
  };

  if (existingOwner) {
    await scoped.lifeOwner.update({ where: { policyId }, data: { personId, isSameAsInsured, ...extraData } });
  } else {
    await scoped.lifeOwner.create({ data: { policyId, personId, isSameAsInsured, ...extraData } });
  }

  return { ok: true };
}

export async function saveBeneficiary(
  agencyId: string,
  ownerId: string,
  policyId: string,
  beneficiaryType: "primary" | "contingent",
  slotNumber: number,
  input: BeneficiaryInput
): Promise<ActionResult> {
  const scoped = getScopedPrisma(agencyId);
  const policy = await verifyOwnedPolicy(scoped, ownerId, policyId);
  if (!policy) {
    return { ok: false, error: "Policy not found." };
  }
  if (!input.firstName.trim() || !input.lastName.trim()) {
    return { ok: false, error: "First and last name are required." };
  }
  if (!input.birthdate) {
    return { ok: false, error: "Birthdate is required." };
  }

  const data = {
    firstName: input.firstName.trim(),
    middleName: input.middleName.trim() || null,
    lastName: input.lastName.trim(),
    permanentAddress: input.permanentAddress.trim() || null,
    birthdate: new Date(input.birthdate),
    mobileNo: input.mobileNo.trim() || null,
    relationshipToInsured: input.relationshipToInsured.trim() || null,
  };

  const existing = await scoped.beneficiary.findFirst({ where: { policyId, beneficiaryType, slotNumber } });
  if (existing) {
    await scoped.beneficiary.update({ where: { id: existing.id }, data });
  } else {
    await scoped.beneficiary.create({ data: { policyId, beneficiaryType, slotNumber, ...data } });
  }

  return { ok: true };
}

export async function deleteBeneficiary(
  agencyId: string,
  ownerId: string,
  policyId: string,
  beneficiaryType: string,
  slotNumber: number
): Promise<ActionResult> {
  const scoped = getScopedPrisma(agencyId);
  const policy = await verifyOwnedPolicy(scoped, ownerId, policyId);
  if (!policy) {
    return { ok: false, error: "Policy not found." };
  }

  await scoped.beneficiary.deleteMany({ where: { policyId, beneficiaryType, slotNumber } });
  return { ok: true };
}

// Activate's minimum-required-info gate for Life policies (Section 5) —
// Insured, Owner, and at least one Primary Beneficiary. The plan doesn't
// mark individual fields within those as mandatory beyond what Person/
// Beneficiary already require (name + birthdate), so this checks that the
// three sub-records exist, not that every optional field is filled in.
export async function hasMinimumLifeInfo(agencyId: string, policyId: string): Promise<boolean> {
  const scoped = getScopedPrisma(agencyId);
  const [insured, owner, primaryBeneficiaryCount] = await Promise.all([
    scoped.lifeInsured.findUnique({ where: { policyId } }),
    scoped.lifeOwner.findUnique({ where: { policyId } }),
    scoped.beneficiary.count({ where: { policyId, beneficiaryType: "primary" } }),
  ]);
  return !!insured && !!owner && primaryBeneficiaryCount > 0;
}
