import { getScopedPrisma } from "@/lib/tenant-db";

// Shared ownership check for the five category detail modules (auto-,
// life-, travel-, property-, health-details.ts) — found in a full-app
// review that each of those files had its own copy-pasted version of this,
// and they'd already drifted apart: life-details.ts's also verified the
// policy's line category matched (since it, uniquely, gets reached from a
// URL that doesn't otherwise imply which category the policy actually is),
// while the other four didn't. A category-mismatched detail page 404s the
// same way an ownership mismatch already did, rather than silently
// rendering/saving fields against the wrong kind of policy — now true for
// all five, not just Life, and only needs fixing in one place if it ever
// needs to change again.
export async function verifyOwnedPolicy(
  scoped: ReturnType<typeof getScopedPrisma>,
  ownerId: string,
  policyId: string,
  category?: "life" | "auto" | "travel" | "property" | "health"
) {
  const policy = await scoped.policy.findUnique({ where: { id: policyId }, include: { line: true } });
  if (!policy || policy.ownerId !== ownerId) return null;
  if (category && policy.line.category !== category) return null;
  return policy;
}
