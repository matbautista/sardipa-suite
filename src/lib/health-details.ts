import { getScopedPrisma } from "@/lib/tenant-db";
import { verifyOwnedPolicy } from "@/lib/policy-access";

// Health/HMO insurance requirement checklist (Section 10 phase 11 /
// Section 11's Health field list). Same provisional status as Property —
// Section 11 marks this line's entire field list as an unverified
// industry-typical draft (Section 12), modeled and built exactly as
// drafted rather than blocked on confirmation.
//
// Dependents are a single free-text field, not a structured table — unlike
// Beneficiaries, which has an explicit "up to 3/2" cap (Section 11),
// nothing caps dependent count here, so the fixed-slot pattern from
// life-details.ts doesn't fit.

type ActionResult = { ok: true } | { ok: false; error: string };

export type HealthDetailsInput = {
  insuredName: string;
  insuredBirthdate: string;
  existingMedicalConditions: string;
  planCoverageTier: string;
  dependents: string;
  roomBoardLimit: string;
  preexistingConditionDisclosure: string;
};

// undefined = no such policy (caller should 404); null = policy exists but
// no HealthDetail saved yet (caller should render an empty form, not 404)
export async function getHealthDetails(agencyId: string, ownerId: string, policyId: string) {
  const scoped = getScopedPrisma(agencyId);
  const policy = await verifyOwnedPolicy(scoped, ownerId, policyId, "health");
  if (!policy) return undefined;
  return scoped.healthDetail.findUnique({ where: { policyId } });
}

export async function saveHealthDetails(
  agencyId: string,
  ownerId: string,
  policyId: string,
  input: HealthDetailsInput
): Promise<ActionResult> {
  const scoped = getScopedPrisma(agencyId);
  const policy = await verifyOwnedPolicy(scoped, ownerId, policyId, "health");
  if (!policy) {
    return { ok: false, error: "Policy not found." };
  }

  const insuredName = input.insuredName.trim();
  if (!insuredName) {
    return { ok: false, error: "Insured's name is required." };
  }
  if (!input.insuredBirthdate) {
    return { ok: false, error: "Insured's birthdate is required." };
  }

  const data = {
    insuredName,
    insuredBirthdate: new Date(input.insuredBirthdate),
    existingMedicalConditions: input.existingMedicalConditions.trim() || null,
    planCoverageTier: input.planCoverageTier.trim() || null,
    dependents: input.dependents.trim() || null,
    roomBoardLimit: input.roomBoardLimit ? Number(input.roomBoardLimit) : null,
    preexistingConditionDisclosure: input.preexistingConditionDisclosure.trim() || null,
  };

  await scoped.healthDetail.upsert({
    where: { policyId },
    update: data,
    create: { policyId, ...data },
  });

  return { ok: true };
}

export async function hasMinimumHealthInfo(agencyId: string, ownerId: string, policyId: string): Promise<boolean> {
  const scoped = getScopedPrisma(agencyId);
  if (!(await verifyOwnedPolicy(scoped, ownerId, policyId, "health"))) {
    return false;
  }
  const detail = await scoped.healthDetail.findUnique({ where: { policyId } });
  return !!detail;
}
