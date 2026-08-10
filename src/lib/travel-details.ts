import { getScopedPrisma } from "@/lib/tenant-db";

// Travel insurance requirement checklist (Section 10 phase 11 / Section
// 11's Travel Insurance field list). Trip start/end dates aren't collected
// here — Policy.startDate/renewalDate already double as the trip's dates
// for Travel-category policies (Section 5), reused rather than duplicated.

const COVERAGE_TYPES = ["medical", "baggage", "trip_cancellation", "comprehensive"] as const;

type ActionResult = { ok: true } | { ok: false; error: string };

export type TravelDetailsInput = {
  travelerName: string;
  passportNo: string;
  destination: string;
  purposeOfTravel: string;
  coverageType: string;
};

async function verifyOwnedPolicy(scoped: ReturnType<typeof getScopedPrisma>, ownerId: string, policyId: string) {
  const policy = await scoped.policy.findUnique({ where: { id: policyId } });
  return policy && policy.ownerId === ownerId ? policy : null;
}

// undefined = no such policy (caller should 404); null = policy exists but
// no TravelDetail saved yet (caller should render an empty form, not 404)
export async function getTravelDetails(agencyId: string, ownerId: string, policyId: string) {
  const scoped = getScopedPrisma(agencyId);
  const policy = await verifyOwnedPolicy(scoped, ownerId, policyId);
  if (!policy) return undefined;
  return scoped.travelDetail.findUnique({ where: { policyId } });
}

export async function saveTravelDetails(
  agencyId: string,
  ownerId: string,
  policyId: string,
  input: TravelDetailsInput
): Promise<ActionResult> {
  const scoped = getScopedPrisma(agencyId);
  const policy = await verifyOwnedPolicy(scoped, ownerId, policyId);
  if (!policy) {
    return { ok: false, error: "Policy not found." };
  }

  const travelerName = input.travelerName.trim();
  const passportNo = input.passportNo.trim();
  const destination = input.destination.trim();
  if (!travelerName || !passportNo || !destination) {
    return { ok: false, error: "Traveler name, passport number, and destination are required." };
  }
  if (!COVERAGE_TYPES.includes(input.coverageType as (typeof COVERAGE_TYPES)[number])) {
    return { ok: false, error: "Choose a valid coverage type." };
  }

  const data = {
    travelerName,
    passportNo,
    destination,
    purposeOfTravel: input.purposeOfTravel.trim() || null,
    coverageType: input.coverageType,
  };

  await scoped.travelDetail.upsert({
    where: { policyId },
    update: data,
    create: { policyId, ...data },
  });

  return { ok: true };
}

export async function hasMinimumTravelInfo(agencyId: string, ownerId: string, policyId: string): Promise<boolean> {
  const scoped = getScopedPrisma(agencyId);
  if (!(await verifyOwnedPolicy(scoped, ownerId, policyId))) {
    return false;
  }
  const detail = await scoped.travelDetail.findUnique({ where: { policyId } });
  return !!detail;
}
