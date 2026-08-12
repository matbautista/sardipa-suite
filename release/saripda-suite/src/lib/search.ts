import { getScopedPrisma } from "@/lib/tenant-db";

// Search across Leads and Policies (Section 10 phase 16 / Section 5's
// Users feature: "a simple text search (by name, phone, or email) across
// Leads and Policies, scoped to what that user's role can already see").
// `ownerIds` is resolved by the caller via team-access.ts's
// getTeamMemberIds() — same "resolve scope once, trust downstream" shape
// as listTeamLeads/listTeamPolicies, and it already returns just
// [callerId] for an Agent, so this one function serves every role without
// branching on it itself.
//
// Matching is pushed to the database via Prisma's `contains` filter
// (including across Policy's relations — Prisma supports filtering on
// nested relations directly) rather than fetching every owner-scoped
// Lead/Policy and filtering in JS, which a full-app review flagged as
// unbounded: cost grew with total agency history (never auto-deleted,
// Section 5), not with how many results actually matched. `contains`
// compiles to SQLite's LIKE, which is already case-insensitive for ASCII
// by default (verified empirically) — no `mode: "insensitive"` needed
// (that option isn't supported on SQLite anyway; a raw `equals` would
// still be case-sensitive, but `contains` never uses one).
//
// One real behavior narrowing from this: Life's Insured/Owner name was
// previously matched as a JS-concatenated "First Last" string, so a
// query spanning both (e.g. the complete full name) matched even when it
// crossed the firstName/lastName column boundary. Pushed to the DB, the
// OR is across the two columns separately, so a query matching only when
// concatenated (rare — most searches are a single name token or a phone
// number) may no longer. Take caps below are a second line of defense,
// not the primary fix, for the same reason a cap is not itself "search."
const RESULT_LIMIT = 200;

export type LeadSearchResult = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: string;
  ownerName: string | null;
};

export type PolicySearchResult = {
  id: string;
  ownerName: string;
  lineName: string;
  productName: string;
  status: string;
  matchedOn: string;
};

export async function searchLeadsAndPolicies(
  agencyId: string,
  ownerIds: string[],
  query: string
): Promise<{ leads: LeadSearchResult[]; policies: PolicySearchResult[] }> {
  const q = query.trim();
  if (!q) return { leads: [], policies: [] };

  const scoped = getScopedPrisma(agencyId);

  const leads = await scoped.lead.findMany({
    where: {
      ownerId: { in: ownerIds },
      OR: [{ name: { contains: q } }, { phone: { contains: q } }, { email: { contains: q } }],
    },
    include: { owner: true },
    orderBy: { createdAt: "desc" },
    take: RESULT_LIMIT,
  });

  // matchedOn is still computed in JS (which specific field matched) —
  // cheap now that the DB has already done the actual filtering, and
  // Prisma's query builder has no way to report which OR branch matched.
  const policies = await scoped.policy.findMany({
    where: {
      ownerId: { in: ownerIds },
      OR: [
        { lead: { name: { contains: q } } },
        { lead: { phone: { contains: q } } },
        { lead: { email: { contains: q } } },
        { autoOwner: { completeName: { contains: q } } },
        { travelDetail: { travelerName: { contains: q } } },
        { healthDetail: { insuredName: { contains: q } } },
        { propertyDetail: { propertyAddress: { contains: q } } },
        { lifeInsured: { person: { firstName: { contains: q } } } },
        { lifeInsured: { person: { lastName: { contains: q } } } },
        { lifeInsured: { person: { mobileNo: { contains: q } } } },
        { lifeOwner: { person: { firstName: { contains: q } } } },
        { lifeOwner: { person: { lastName: { contains: q } } } },
        { lifeOwner: { person: { mobileNo: { contains: q } } } },
      ],
    },
    include: {
      owner: true,
      line: true,
      product: true,
      lead: true,
      autoOwner: true,
      travelDetail: true,
      healthDetail: true,
      propertyDetail: true,
      lifeInsured: { include: { person: true } },
      lifeOwner: { include: { person: true } },
    },
    orderBy: { startDate: "desc" },
    take: RESULT_LIMIT,
  });

  const lowerQ = q.toLowerCase();
  const matchedPolicies: PolicySearchResult[] = policies.map((policy) => {
    const candidates: Array<{ value: string | null | undefined; label: string }> = [
      { value: policy.lead?.name, label: "lead name" },
      { value: policy.lead?.phone, label: "lead phone" },
      { value: policy.lead?.email, label: "lead email" },
      { value: policy.autoOwner?.completeName, label: "vehicle owner" },
      { value: policy.travelDetail?.travelerName, label: "traveler" },
      { value: policy.healthDetail?.insuredName, label: "insured" },
      { value: policy.propertyDetail?.propertyAddress, label: "property address" },
      { value: policy.lifeInsured?.person?.firstName, label: "insured" },
      { value: policy.lifeInsured?.person?.lastName, label: "insured" },
      { value: policy.lifeInsured?.person?.mobileNo, label: "insured mobile" },
      { value: policy.lifeOwner?.person?.firstName, label: "owner" },
      { value: policy.lifeOwner?.person?.lastName, label: "owner" },
      { value: policy.lifeOwner?.person?.mobileNo, label: "owner mobile" },
    ];
    // The DB's WHERE already guarantees some candidate matches — this
    // just recovers which one, for display, without a second DB hit.
    const match = candidates.find((c) => c.value?.toLowerCase().includes(lowerQ));

    return {
      id: policy.id,
      ownerName: policy.owner.name,
      lineName: policy.line.name,
      productName: policy.product.name,
      status: policy.status,
      matchedOn: match?.label ?? "policy",
    };
  });

  return {
    leads: leads.map((lead) => ({
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      status: lead.status,
      ownerName: lead.owner?.name ?? null,
    })),
    policies: matchedPolicies,
  };
}
