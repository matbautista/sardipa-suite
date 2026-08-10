import { getScopedPrisma } from "@/lib/tenant-db";
import { hasMinimumLifeInfo } from "@/lib/life-details";
import { hasMinimumAutoInfo } from "@/lib/auto-details";
import { hasMinimumTravelInfo } from "@/lib/travel-details";
import { hasMinimumPropertyInfo } from "@/lib/property-details";
import { hasMinimumHealthInfo } from "@/lib/health-details";

// Policies — general (Section 10 phase 9 / Section 5's "Sales / Policies"
// and "Recording a Renewal / Payment"). Scoped to "my own policies" for
// every role, same reasoning as phase 7's leads.ts: cross-agent visibility
// is phase 12, not this one. Creation is lead-conversion only for now — the
// schema allows a policy with no leadId ("a walk-in renewal or a migrated
// legacy policy"), but the plan's phase 9 deliverable is specifically
// "convert a won lead into a policy," so that's the only creation path
// this phase builds a UI for.

type ActionResult = { ok: true } | { ok: false; error: string };

export type PolicyFormInput = {
  lineId: string;
  productId: string;
  premium: string;
  commission: string;
  startDate: string;
  renewalDate: string;
};

export async function listOwnPolicies(agencyId: string, ownerId: string) {
  return getScopedPrisma(agencyId).policy.findMany({
    where: { ownerId },
    orderBy: { startDate: "desc" },
    include: { line: true, product: true },
  });
}

/** For the "Convert to Policy" entry point on a lead's own detail page. */
export async function getPolicyForLead(agencyId: string, ownerId: string, leadId: string) {
  return getScopedPrisma(agencyId).policy.findFirst({ where: { leadId, ownerId } });
}

export async function getOwnPolicy(agencyId: string, ownerId: string, policyId: string) {
  const scoped = getScopedPrisma(agencyId);
  const policy = await scoped.policy.findUnique({
    where: { id: policyId },
    include: { line: true, product: true, lead: true },
  });
  if (!policy || policy.ownerId !== ownerId) {
    return null;
  }
  return policy;
}

function parsePolicyInput(scoped: ReturnType<typeof getScopedPrisma>, input: PolicyFormInput) {
  return (async (): Promise<
    | { ok: true; lineId: string; productId: string; premium: number; commission: number | null; startDate: Date; renewalDate: Date }
    | { ok: false; error: string }
  > => {
    if (!input.lineId) {
      return { ok: false, error: "Choose an insurance line." };
    }
    const line = await scoped.insuranceLine.findUnique({ where: { id: input.lineId } });
    if (!line) {
      return { ok: false, error: "That insurance line doesn't exist." };
    }
    if (!input.productId) {
      return { ok: false, error: "Choose a product." };
    }
    const product = await scoped.product.findUnique({ where: { id: input.productId } });
    if (!product || product.lineId !== line.id) {
      return { ok: false, error: "Choose a product that belongs to the selected line." };
    }
    const premium = Number(input.premium);
    if (!Number.isFinite(premium) || premium <= 0) {
      return { ok: false, error: "Enter a valid premium amount." };
    }
    const commission = input.commission.trim() ? Number(input.commission) : null;
    if (commission !== null && (!Number.isFinite(commission) || commission < 0)) {
      return { ok: false, error: "Enter a valid commission amount." };
    }
    if (!input.startDate) {
      return { ok: false, error: "Choose a start date." };
    }
    if (!input.renewalDate) {
      return { ok: false, error: "Choose a renewal date." };
    }
    return {
      ok: true,
      lineId: line.id,
      productId: product.id,
      premium,
      commission,
      startDate: new Date(input.startDate),
      renewalDate: new Date(input.renewalDate),
    };
  })();
}

export async function convertLeadToPolicy(
  agencyId: string,
  ownerId: string,
  leadId: string,
  input: PolicyFormInput
): Promise<{ ok: true; policyId: string } | { ok: false; error: string }> {
  const scoped = getScopedPrisma(agencyId);

  const lead = await scoped.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.ownerId !== ownerId) {
    return { ok: false, error: "Lead not found." };
  }
  if (lead.status !== "won") {
    return { ok: false, error: "Only a Won lead can be converted to a policy." };
  }
  const alreadyConverted = await scoped.policy.findFirst({ where: { leadId } });
  if (alreadyConverted) {
    return { ok: false, error: "This lead has already been converted to a policy." };
  }

  const parsed = await parsePolicyInput(scoped, input);
  if (!parsed.ok) {
    return parsed;
  }

  const policy = await scoped.policy.create({
    data: {
      agencyId,
      leadId,
      ownerId,
      lineId: parsed.lineId,
      productId: parsed.productId,
      premium: parsed.premium,
      commission: parsed.commission,
      startDate: parsed.startDate,
      renewalDate: parsed.renewalDate,
    },
  });

  return { ok: true, policyId: policy.id };
}

export async function updateDraftPolicy(
  agencyId: string,
  ownerId: string,
  policyId: string,
  input: PolicyFormInput
): Promise<ActionResult> {
  const scoped = getScopedPrisma(agencyId);
  const existing = await scoped.policy.findUnique({ where: { id: policyId } });
  if (!existing || existing.ownerId !== ownerId) {
    return { ok: false, error: "Policy not found." };
  }
  // Once active/lapsed/etc., changes go through the dedicated Activate and
  // Renewal actions instead of a raw field edit (Section 5).
  if (existing.status !== "draft") {
    return { ok: false, error: "Only a draft policy can be edited directly." };
  }

  const parsed = await parsePolicyInput(scoped, input);
  if (!parsed.ok) {
    return parsed;
  }

  await scoped.policy.update({
    where: { id: policyId },
    data: {
      lineId: parsed.lineId,
      productId: parsed.productId,
      premium: parsed.premium,
      commission: parsed.commission,
      startDate: parsed.startDate,
      renewalDate: parsed.renewalDate,
    },
  });

  return { ok: true };
}

export async function activatePolicy(agencyId: string, ownerId: string, policyId: string): Promise<ActionResult> {
  const scoped = getScopedPrisma(agencyId);
  const policy = await scoped.policy.findUnique({ where: { id: policyId }, include: { line: true } });
  if (!policy || policy.ownerId !== ownerId) {
    return { ok: false, error: "Policy not found." };
  }
  if (policy.status !== "draft") {
    return { ok: false, error: "Only a draft policy can be activated." };
  }
  if (!policy.proofOfPaymentDocId) {
    return { ok: false, error: "Upload a Proof of Payment document before activating." };
  }
  // Per-line minimum-required-info gates (Section 11, phases 10-11).
  // "other" has no structured checklist in the plan, so it's gated on
  // Proof of Payment alone, same as every category was before this phase.
  if (policy.line.category === "life" && !(await hasMinimumLifeInfo(agencyId, policyId))) {
    return { ok: false, error: "Fill in the Insured, Owner, and at least one Primary Beneficiary before activating." };
  }
  if (policy.line.category === "auto" && !(await hasMinimumAutoInfo(agencyId, policyId))) {
    return { ok: false, error: "Fill in the Owner and Vehicle details before activating." };
  }
  if (policy.line.category === "travel" && !(await hasMinimumTravelInfo(agencyId, policyId))) {
    return { ok: false, error: "Fill in the Travel details before activating." };
  }
  if (policy.line.category === "property" && !(await hasMinimumPropertyInfo(agencyId, policyId))) {
    return { ok: false, error: "Fill in the Property details before activating." };
  }
  if (policy.line.category === "health" && !(await hasMinimumHealthInfo(agencyId, policyId))) {
    return { ok: false, error: "Fill in the Health details before activating." };
  }

  await scoped.policy.update({ where: { id: policyId }, data: { status: "active" } });
  await scoped.activityLog.create({ data: { userId: ownerId, policyId, action: "policy_activated", note: null } });

  return { ok: true };
}

// Reactivating a lapsed/grace_period policy (Section 5's "Recording a
// Renewal / Payment") — the caller is expected to have already uploaded a
// new Proof of Payment document via uploadDocument() before calling this,
// which is what actually satisfies step 1 of that section.
export async function recordRenewal(agencyId: string, ownerId: string, policyId: string): Promise<ActionResult> {
  const scoped = getScopedPrisma(agencyId);
  const policy = await scoped.policy.findUnique({ where: { id: policyId } });
  if (!policy || policy.ownerId !== ownerId) {
    return { ok: false, error: "Policy not found." };
  }
  if (policy.status !== "lapsed" && policy.status !== "grace_period") {
    return { ok: false, error: "Only a lapsed or grace-period policy can be renewed." };
  }

  const oneYearForward = (from: Date) => {
    const next = new Date(from);
    next.setFullYear(next.getFullYear() + 1);
    return next;
  };
  // From grace_period: one year forward from the *original* renewal_date,
  // so a payment made partway through the 30-day window doesn't shift the
  // policy's yearly anniversary. From lapsed: one year forward from today
  // — it reactivates going forward, not retroactively (Section 5).
  const newRenewalDate =
    policy.status === "grace_period" ? oneYearForward(policy.renewalDate) : oneYearForward(new Date());

  await scoped.policy.update({
    where: { id: policyId },
    data: { status: "active", gracePeriodEndsAt: null, renewalDate: newRenewalDate },
  });
  await scoped.activityLog.create({ data: { userId: ownerId, policyId, action: "policy_renewed", note: null } });

  return { ok: true };
}
