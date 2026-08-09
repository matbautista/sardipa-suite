import { getScopedPrisma } from "@/lib/tenant-db";

// Leads CRUD (Section 10 phase 7 / Section 5's Leads feature). Scoped to
// "my own leads" only for every role — Section 3's cross-agent visibility
// (Manager sees their team, Head sees the whole agency) is explicitly a
// later phase (12), not this one, so ownership here is always the calling
// user's own id, regardless of role.

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
  const lead = await scoped.lead.findUnique({ where: { id: leadId }, include: { line: true, product: true } });
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

  await scoped.lead.create({
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

  return { ok: true };
}

export async function updateLead(
  agencyId: string,
  ownerId: string,
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

  return { ok: true };
}

export async function deleteLead(agencyId: string, ownerId: string, leadId: string): Promise<ActionResult> {
  const scoped = getScopedPrisma(agencyId);
  const existing = await scoped.lead.findUnique({ where: { id: leadId } });
  if (!existing || existing.ownerId !== ownerId) {
    return { ok: false, error: "Lead not found." };
  }

  await scoped.lead.delete({ where: { id: leadId } });
  return { ok: true };
}
