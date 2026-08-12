import { getScopedPrisma } from "@/lib/tenant-db";

// Leads CRUD (Section 10 phase 7 / Section 5's Leads feature). The
// "ownerId" parameter throughout this file was originally always the
// calling user's own id (phase 7 scoped everything to "my own leads").
// Phase 12 adds Manager/Head cross-visibility on top: detail pages now
// resolve which owner's records the caller may touch via
// resolveAccessibleOwner() (src/lib/team-access.ts) and pass *that*
// resolved owner id in here — so every function below still does a real
// check, it's just checking against the record's actual owner rather than
// assuming it's always the caller.

const VALID_STATUSES = ["new", "contacted", "quoted", "negotiating", "won", "lost"] as const;

export type LeadInput = {
  name: string;
  phone: string;
  email: string;
  source: string;
  lineId: string;
  productId: string;
  status: string;
  notes: string;
  nextFollowUpDate: string;
};

type ActionResult = { ok: true } | { ok: false; error: string };

export async function listOwnLeads(agencyId: string, ownerId: string) {
  return getScopedPrisma(agencyId).lead.findMany({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    include: { line: true, product: true },
  });
}

export async function getOwnLead(agencyId: string, ownerId: string, leadId: string) {
  const scoped = getScopedPrisma(agencyId);
  // findUnique through the scoped client already verifies agencyId
  // ownership (see tenant-db.ts) — the ownerId check on top of that is
  // this phase's own rule (own leads only, not just own agency's leads).
  const lead = await scoped.lead.findUnique({
    where: { id: leadId },
    include: { line: true, product: true, owner: true },
  });
  if (!lead || lead.ownerId !== ownerId) {
    return null;
  }
  return lead;
}

async function resolveLineAndProduct(
  scoped: ReturnType<typeof getScopedPrisma>,
  lineId: string,
  productId: string
): Promise<{ ok: true; lineId: string | null; productId: string | null } | { ok: false; error: string }> {
  if (productId) {
    const product = await scoped.product.findUnique({ where: { id: productId } });
    if (!product) {
      return { ok: false, error: "That product doesn't exist." };
    }
    // A product's line is authoritative — ignore a mismatched lineId from
    // the form rather than erroring, same "derive, don't validate a
    // redundant field" approach as insurance-lines.ts.
    return { ok: true, lineId: product.lineId, productId: product.id };
  }
  if (lineId) {
    const line = await scoped.insuranceLine.findUnique({ where: { id: lineId } });
    if (!line) {
      return { ok: false, error: "That insurance line doesn't exist." };
    }
    return { ok: true, lineId: line.id, productId: null };
  }
  return { ok: true, lineId: null, productId: null };
}

export async function createLead(agencyId: string, ownerId: string, input: LeadInput): Promise<ActionResult> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return { ok: false, error: "Name is required." };
  }
  if (input.status && !VALID_STATUSES.includes(input.status as (typeof VALID_STATUSES)[number])) {
    return { ok: false, error: "Choose a valid status." };
  }

  const scoped = getScopedPrisma(agencyId);
  const resolved = await resolveLineAndProduct(scoped, input.lineId, input.productId);
  if (!resolved.ok) {
    return resolved;
  }

  const lead = await scoped.lead.create({
    // agencyId redundant at runtime (getScopedPrisma always overwrites
    // it), included only to satisfy Prisma's generated CreateInput type.
    data: {
      agencyId,
      ownerId,
      name: trimmedName,
      phone: input.phone.trim() || null,
      email: input.email.trim() || null,
      source: input.source.trim() || "Manual",
      lineId: resolved.lineId,
      productId: resolved.productId,
      status: input.status || "new",
      notes: input.notes.trim() || null,
      nextFollowUpDate: input.nextFollowUpDate ? new Date(input.nextFollowUpDate) : null,
    },
  });
  // createLead is always self-service (ownerId is always the caller's own
  // id here — see this file's header comment), so ownerId doubles as the
  // actor.
  await scoped.activityLog.create({ data: { userId: ownerId, leadId: lead.id, action: "lead_created", note: null } });

  return { ok: true };
}

export async function updateLead(
  agencyId: string,
  ownerId: string,
  actorId: string,
  leadId: string,
  input: LeadInput
): Promise<ActionResult> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return { ok: false, error: "Name is required." };
  }
  if (!VALID_STATUSES.includes(input.status as (typeof VALID_STATUSES)[number])) {
    return { ok: false, error: "Choose a valid status." };
  }

  const scoped = getScopedPrisma(agencyId);
  const existing = await scoped.lead.findUnique({ where: { id: leadId } });
  if (!existing || existing.ownerId !== ownerId) {
    return { ok: false, error: "Lead not found." };
  }

  const resolved = await resolveLineAndProduct(scoped, input.lineId, input.productId);
  if (!resolved.ok) {
    return resolved;
  }

  await scoped.lead.update({
    where: { id: leadId },
    data: {
      name: trimmedName,
      phone: input.phone.trim() || null,
      email: input.email.trim() || null,
      source: input.source.trim() || "Manual",
      lineId: resolved.lineId,
      productId: resolved.productId,
      status: input.status,
      notes: input.notes.trim() || null,
      nextFollowUpDate: input.nextFollowUpDate ? new Date(input.nextFollowUpDate) : null,
    },
  });
  await scoped.activityLog.create({ data: { userId: actorId, leadId, action: "lead_updated", note: null } });

  return { ok: true };
}

export async function deleteLead(
  agencyId: string,
  ownerId: string,
  actorId: string,
  leadId: string
): Promise<ActionResult> {
  const scoped = getScopedPrisma(agencyId);
  const existing = await scoped.lead.findUnique({ where: { id: leadId } });
  if (!existing || existing.ownerId !== ownerId) {
    return { ok: false, error: "Lead not found." };
  }

  // Logged before the delete, not after — ActivityLog.leadId has no
  // ON DELETE CASCADE-safe way to reference a row that no longer exists,
  // and Section 5 requires the delete itself to be audited, not just
  // creates/updates.
  await scoped.activityLog.create({
    data: { userId: actorId, leadId, action: "lead_deleted", note: `"${existing.name}" deleted` },
  });
  await scoped.lead.delete({ where: { id: leadId } });
  return { ok: true };
}

// undefined = no such lead in this agency; null = exists but unassigned
// (no owner yet); string = the current owner's id. Lets a detail page tell
// "not found" apart from "found, but nobody owns it yet" before deciding
// whether resolveAccessibleOwner() even applies (phase 12).
export async function getLeadOwnerId(agencyId: string, leadId: string): Promise<string | null | undefined> {
  const scoped = getScopedPrisma(agencyId);
  const lead = await scoped.lead.findUnique({ where: { id: leadId } });
  return lead ? lead.ownerId : undefined;
}

export type TeamLeadFilters = { status?: string; ownerId?: string };

// Manager/Head cross-visibility list (Section 10 phase 12). `ownerIds` is
// already resolved by the caller via getTeamMemberIds() — this function
// doesn't itself decide who's in scope, just lists leads within a given set.
//
// filters.ownerId comes straight from a query-string param on /team/leads,
// so it's untrusted: it's only honored when it's actually a member of
// ownerIds (intersected, not substituted). A crafted id outside the
// caller's team silently falls back to the full team scope rather than
// leaking another team's records — found and fixed after a full-app
// review flagged this as an IDOR (a Manager could otherwise pass another
// team's agent id and see their leads).
export async function listTeamLeads(agencyId: string, ownerIds: string[], filters: TeamLeadFilters = {}) {
  const scoped = getScopedPrisma(agencyId);
  const ownerFilter = filters.ownerId && ownerIds.includes(filters.ownerId) ? filters.ownerId : { in: ownerIds };
  return scoped.lead.findMany({
    where: {
      ownerId: ownerFilter,
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { line: true, product: true, owner: true },
  });
}

// The shared unassigned/needs-review pool (Section 5) — visible to every
// Manager and Head agency-wide, not scoped to "own team" like everything
// else here, since sub-team scoping "only restricts visibility into leads
// already assigned to another team, not this shared unassigned pool"
// (Section 3). Nothing in the app creates unassigned leads yet (that's the
// Website Inquiry Intake, phase 14) — this stays correctly empty until then.
export async function listUnassignedOrNeedsReviewLeads(agencyId: string) {
  const scoped = getScopedPrisma(agencyId);
  return scoped.lead.findMany({
    where: { OR: [{ ownerId: null }, { needsReview: true }] },
    orderBy: { createdAt: "desc" },
    include: { line: true, product: true },
  });
}

// targetOwnerId: found in a full-app review that this previously always
// assigned to callerId — the claiming Manager/Head themselves — with no
// way to hand it straight to one of their agents, contradicting Section
// 5's "a Manager assigns them to one of their own team's agents, or
// Agency Head to anyone" (point 6). Defaults to the caller (preserving the
// original one-click "Claim into my own queue" behavior) when omitted;
// when given, callerOwnerIds (already resolved by the caller via
// getTeamMemberIds(), same pattern as reassignLead) proves it's actually
// one of the caller's own team members — a Manager still can't hand an
// unassigned lead to someone outside their team.
export async function claimLead(
  agencyId: string,
  callerId: string,
  leadId: string,
  callerOwnerIds: string[],
  targetOwnerId?: string
): Promise<ActionResult> {
  if (targetOwnerId && !callerOwnerIds.includes(targetOwnerId)) {
    return { ok: false, error: "Choose a valid team member to assign to." };
  }
  const ownerId = targetOwnerId ?? callerId;
  const scoped = getScopedPrisma(agencyId);
  const lead = await scoped.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    return { ok: false, error: "Lead not found." };
  }
  if (lead.ownerId !== null) {
    return { ok: false, error: "This lead is already assigned to someone." };
  }
  await scoped.lead.update({ where: { id: leadId }, data: { ownerId } });
  await scoped.activityLog.create({ data: { userId: callerId, leadId, action: "lead_claimed", note: null } });
  return { ok: true };
}

// Reassign leads between agents (Section 3): Manager within their own team,
// Head to anyone in the agency. `newOwnerId` must already be a valid team
// member id from getTeamMemberIds() for the caller's own role — this
// function trusts that was checked by the caller (the page/action calling
// it builds its <select> options from that exact same list), same
// "resolve once, trust downstream" shape as resolveAccessibleOwner().
//
// `callerOwnerIds` (the same getTeamMemberIds() result the caller already
// computed to validate newOwnerId) is also used to verify the lead's
// *current* owner is within the caller's scope — found missing in a
// full-app review: without it, a Manager could pass a leadId belonging to
// another team's agent (with a newOwnerId validated only against their
// own team) and reassign it into their own team, an IDOR the "trust the
// caller validated newOwnerId" comment above never covered for ownerId.
export async function reassignLead(
  agencyId: string,
  actorId: string,
  callerOwnerIds: string[],
  leadId: string,
  newOwnerId: string
): Promise<ActionResult> {
  const scoped = getScopedPrisma(agencyId);
  const lead = await scoped.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    return { ok: false, error: "Lead not found." };
  }
  if (!lead.ownerId || !callerOwnerIds.includes(lead.ownerId)) {
    return { ok: false, error: "That lead isn't in your team." };
  }
  await scoped.lead.update({ where: { id: leadId }, data: { ownerId: newOwnerId } });
  await scoped.activityLog.create({
    data: { userId: actorId, leadId, action: "lead_reassigned", note: `Reassigned to a different agent` },
  });
  return { ok: true };
}
