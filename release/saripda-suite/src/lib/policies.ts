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
    include: { line: true, product: true, lead: true, owner: true },
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

// ownerId: whose lead/policy this is — may be resolved to someone other
// than the caller by team-access.ts (a Manager/Head converting a
// subordinate's Won lead). actorId: who's actually clicking the button,
// always the real caller, for ActivityLog attribution. Found via a
// full-app review that this file's header comment ("creation is
// lead-conversion only for now") had drifted into an unstated "and always
// self-service" assumption that policies/new/page.tsx's own code baked
// in — but leads/[id]/page.tsx already links Manager/Head to convert a
// subordinate's Won lead, so that assumption was simply wrong, not a
// deliberate scope decision.
export async function convertLeadToPolicy(
  agencyId: string,
  ownerId: string,
  actorId: string,
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
  await scoped.activityLog.create({
    data: { userId: actorId, policyId: policy.id, action: "policy_created", note: null },
  });

  return { ok: true, policyId: policy.id };
}

export async function updateDraftPolicy(
  agencyId: string,
  ownerId: string,
  actorId: string,
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
  await scoped.activityLog.create({ data: { userId: actorId, policyId, action: "policy_updated", note: null } });

  return { ok: true };
}

// ownerId: whose policy this is, for the access check (may be resolved to
// someone other than the caller by team-access.ts, phase 12). actorId: who
// is actually clicking the button — always the real caller, never resolved
// — since ActivityLog must attribute to "the actual actor (not the
// subject)" (Section 5's Audit/Activity Log requirement).
export async function activatePolicy(
  agencyId: string,
  ownerId: string,
  actorId: string,
  policyId: string
): Promise<ActionResult> {
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
  if (policy.line.category === "life" && !(await hasMinimumLifeInfo(agencyId, ownerId, policyId))) {
    return { ok: false, error: "Fill in the Insured, Owner, and at least one Primary Beneficiary before activating." };
  }
  if (policy.line.category === "auto" && !(await hasMinimumAutoInfo(agencyId, ownerId, policyId))) {
    return { ok: false, error: "Fill in the Owner and Vehicle details before activating." };
  }
  if (policy.line.category === "travel" && !(await hasMinimumTravelInfo(agencyId, ownerId, policyId))) {
    return { ok: false, error: "Fill in the Travel details before activating." };
  }
  if (policy.line.category === "property" && !(await hasMinimumPropertyInfo(agencyId, ownerId, policyId))) {
    return { ok: false, error: "Fill in the Property details before activating." };
  }
  if (policy.line.category === "health" && !(await hasMinimumHealthInfo(agencyId, ownerId, policyId))) {
    return { ok: false, error: "Fill in the Health details before activating." };
  }

  await scoped.policy.update({ where: { id: policyId }, data: { status: "active" } });
  await scoped.activityLog.create({ data: { userId: actorId, policyId, action: "policy_activated", note: null } });

  return { ok: true };
}

// Reactivating a lapsed/grace_period policy (Section 5's "Recording a
// Renewal / Payment") — the caller is expected to have already uploaded a
// new Proof of Payment document via uploadDocument() before calling this,
// which is what actually satisfies step 1 of that section. That
// expectation is now also verified below, not just trusted (found in a
// full-app review: as written before, calling this directly with no fresh
// upload would reactivate the policy on the strength of a code comment
// alone) — mirrors how activatePolicy() re-checks proofOfPaymentDocId
// itself rather than trusting its own caller.
const RENEWAL_DOCUMENT_FRESHNESS_MS = 10 * 60 * 1000;

export async function recordRenewal(
  agencyId: string,
  ownerId: string,
  actorId: string,
  policyId: string
): Promise<ActionResult> {
  const scoped = getScopedPrisma(agencyId);
  const policy = await scoped.policy.findUnique({ where: { id: policyId } });
  if (!policy || policy.ownerId !== ownerId) {
    return { ok: false, error: "Policy not found." };
  }
  if (policy.status !== "lapsed" && policy.status !== "grace_period") {
    return { ok: false, error: "Only a lapsed or grace-period policy can be renewed." };
  }
  if (!policy.proofOfPaymentDocId) {
    return { ok: false, error: "Upload a new Proof of Payment document before renewing." };
  }
  const proofOfPayment = await scoped.document.findUnique({ where: { id: policy.proofOfPaymentDocId } });
  // uploadDocument() always repoints proofOfPaymentDocId at whichever
  // proof_of_payment document was uploaded most recently, so a fresh
  // enough uploadedAt here means this really is a new document from this
  // renewal, not a stale pointer left over from the original Activate.
  if (!proofOfPayment || Date.now() - proofOfPayment.uploadedAt.getTime() > RENEWAL_DOCUMENT_FRESHNESS_MS) {
    return { ok: false, error: "Upload a new Proof of Payment document before renewing." };
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
  await scoped.activityLog.create({ data: { userId: actorId, policyId, action: "policy_renewed", note: null } });

  return { ok: true };
}

// undefined = no such policy in this agency; string = its owner. Every
// policy has an owner (unlike Lead, whose ownerId is nullable), so there's
// no "unassigned" case to represent here (Section 10 phase 12).
export async function getPolicyOwnerId(agencyId: string, policyId: string): Promise<string | undefined> {
  const scoped = getScopedPrisma(agencyId);
  const policy = await scoped.policy.findUnique({ where: { id: policyId } });
  return policy?.ownerId;
}

// Found in a full-app review: this didn't exist at all, but Section 5's
// Deactivation bullet requires it ("a Manager/Agency Head reassigns their
// open leads/policies to someone active") — team/policies/page.tsx's own
// header comment previously justified having no reassignment control by
// citing Section 3's permissions table, which only calls out lead
// reassignment, but that table is about day-to-day pipeline management,
// not this deactivation-cleanup requirement a few sections later. Same
// shape as leads.ts's reassignLead: callerOwnerIds (already resolved by
// the caller via getTeamMemberIds()) proves both the policy's *current*
// owner and newOwnerId are within the caller's own team scope — a Manager
// can't use this to pull a policy from, or push one into, another team.
export async function reassignPolicy(
  agencyId: string,
  actorId: string,
  callerOwnerIds: string[],
  policyId: string,
  newOwnerId: string
): Promise<ActionResult> {
  if (!callerOwnerIds.includes(newOwnerId)) {
    return { ok: false, error: "Choose a valid team member to reassign to." };
  }
  const scoped = getScopedPrisma(agencyId);
  const policy = await scoped.policy.findUnique({ where: { id: policyId } });
  if (!policy) {
    return { ok: false, error: "Policy not found." };
  }
  if (!callerOwnerIds.includes(policy.ownerId)) {
    return { ok: false, error: "That policy isn't in your team." };
  }
  await scoped.policy.update({ where: { id: policyId }, data: { ownerId: newOwnerId } });
  await scoped.activityLog.create({
    data: { userId: actorId, policyId, action: "policy_reassigned", note: "Reassigned to a different agent" },
  });
  return { ok: true };
}

export type TeamPolicyFilters = { status?: string; ownerId?: string };

// Manager/Head cross-visibility list (Section 10 phase 12) — same shape as
// leads.ts's listTeamLeads: `ownerIds` is resolved by the caller via
// getTeamMemberIds() first.
//
// filters.ownerId is untrusted (a query-string param) — intersected with
// ownerIds, never substituted for it, same IDOR fix as listTeamLeads.
export async function listTeamPolicies(agencyId: string, ownerIds: string[], filters: TeamPolicyFilters = {}) {
  const scoped = getScopedPrisma(agencyId);
  const ownerFilter = filters.ownerId && ownerIds.includes(filters.ownerId) ? filters.ownerId : { in: ownerIds };
  return scoped.policy.findMany({
    where: {
      ownerId: ownerFilter,
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: { startDate: "desc" },
    include: { line: true, product: true, owner: true },
  });
}
