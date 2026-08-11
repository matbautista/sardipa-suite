import { getScopedPrisma } from "@/lib/tenant-db";
import { verifyOwnedPolicy } from "@/lib/policy-access";

// Property/Fire insurance requirement checklist (Section 10 phase 11 /
// Section 11's Property field list). Section 11 marks this line's entire
// field list as an unverified industry-typical draft (Section 12's open
// questions) — modeled and built exactly as drafted, per Section 12's own
// framing of these drafts as usable defaults rather than blockers.
// "Proof of Ownership" is a document (type "proof_of_ownership"), not a
// field here, same as Proof of Payment elsewhere.

const CONSTRUCTION_TYPES = ["concrete", "wood", "mixed"] as const;
const OCCUPANCY_USES = ["residential", "commercial", "industrial"] as const;

type ActionResult = { ok: true } | { ok: false; error: string };

export type PropertyDetailsInput = {
  propertyAddress: string;
  constructionType: string;
  occupancyUse: string;
  sumInsured: string;
  perilsCovered: string;
};

// undefined = no such policy (caller should 404); null = policy exists but
// no PropertyDetail saved yet (caller should render an empty form, not 404)
export async function getPropertyDetails(agencyId: string, ownerId: string, policyId: string) {
  const scoped = getScopedPrisma(agencyId);
  const policy = await verifyOwnedPolicy(scoped, ownerId, policyId, "property");
  if (!policy) return undefined;
  return scoped.propertyDetail.findUnique({ where: { policyId } });
}

export async function savePropertyDetails(
  agencyId: string,
  ownerId: string,
  policyId: string,
  input: PropertyDetailsInput
): Promise<ActionResult> {
  const scoped = getScopedPrisma(agencyId);
  const policy = await verifyOwnedPolicy(scoped, ownerId, policyId, "property");
  if (!policy) {
    return { ok: false, error: "Policy not found." };
  }

  const propertyAddress = input.propertyAddress.trim();
  if (!propertyAddress) {
    return { ok: false, error: "Property address is required." };
  }
  if (input.constructionType && !CONSTRUCTION_TYPES.includes(input.constructionType as (typeof CONSTRUCTION_TYPES)[number])) {
    return { ok: false, error: "Choose a valid construction type." };
  }
  if (input.occupancyUse && !OCCUPANCY_USES.includes(input.occupancyUse as (typeof OCCUPANCY_USES)[number])) {
    return { ok: false, error: "Choose a valid occupancy/use." };
  }

  const data = {
    propertyAddress,
    constructionType: input.constructionType || null,
    occupancyUse: input.occupancyUse || null,
    sumInsured: input.sumInsured ? Number(input.sumInsured) : null,
    perilsCovered: input.perilsCovered.trim() || null,
  };

  await scoped.propertyDetail.upsert({
    where: { policyId },
    update: data,
    create: { policyId, ...data },
  });

  return { ok: true };
}

export async function hasMinimumPropertyInfo(agencyId: string, ownerId: string, policyId: string): Promise<boolean> {
  const scoped = getScopedPrisma(agencyId);
  if (!(await verifyOwnedPolicy(scoped, ownerId, policyId, "property"))) {
    return false;
  }
  const detail = await scoped.propertyDetail.findUnique({ where: { policyId } });
  return !!detail;
}
