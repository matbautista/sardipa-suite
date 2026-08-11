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
// Lead has explicit name/phone/email columns to match directly. Policy
// has none of its own — the actual customer's name lives in whichever
// category-specific detail table applies (Section 11), or on the Lead it
// was converted from. Matching is done in JS across a bounded, already
// owner-scoped fetch rather than DB-level `contains` filters, for two
// reasons: SQLite string comparison in Prisma isn't case-insensitive
// (`mode: "insensitive"` isn't supported on this provider — same
// constraint email-intake.ts's line-matching already worked around), and
// the fields worth matching are scattered across several optional
// relations rather than one column.

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
  const q = query.trim().toLowerCase();
  if (!q) return { leads: [], policies: [] };

  const scoped = getScopedPrisma(agencyId);

  const leads = await scoped.lead.findMany({
    where: { ownerId: { in: ownerIds } },
    include: { owner: true },
  });
  const matchedLeads = leads.filter((lead) =>
    [lead.name, lead.phone, lead.email].some((field) => field?.toLowerCase().includes(q))
  );

  const policies = await scoped.policy.findMany({
    where: { ownerId: { in: ownerIds } },
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
  });

  const matchedPolicies: PolicySearchResult[] = [];
  for (const policy of policies) {
    const personName = (first: string, last: string) => `${first} ${last}`;
    const candidates: Array<{ value: string | null | undefined; label: string }> = [
      { value: policy.lead?.name, label: "lead name" },
      { value: policy.lead?.phone, label: "lead phone" },
      { value: policy.lead?.email, label: "lead email" },
      { value: policy.autoOwner?.completeName, label: "vehicle owner" },
      { value: policy.travelDetail?.travelerName, label: "traveler" },
      { value: policy.healthDetail?.insuredName, label: "insured" },
      { value: policy.propertyDetail?.propertyAddress, label: "property address" },
      {
        value: policy.lifeInsured?.person ? personName(policy.lifeInsured.person.firstName, policy.lifeInsured.person.lastName) : null,
        label: "insured",
      },
      { value: policy.lifeInsured?.person?.mobileNo, label: "insured mobile" },
      {
        value: policy.lifeOwner?.person ? personName(policy.lifeOwner.person.firstName, policy.lifeOwner.person.lastName) : null,
        label: "owner",
      },
      { value: policy.lifeOwner?.person?.mobileNo, label: "owner mobile" },
    ];

    const match = candidates.find((c) => c.value?.toLowerCase().includes(q));
    if (match) {
      matchedPolicies.push({
        id: policy.id,
        ownerName: policy.owner.name,
        lineName: policy.line.name,
        productName: policy.product.name,
        status: policy.status,
        matchedOn: match.label,
      });
    }
  }

  return {
    leads: matchedLeads.map((lead) => ({
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
