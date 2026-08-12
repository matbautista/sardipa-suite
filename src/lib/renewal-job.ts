import { prisma } from "@/lib/prisma";
import { getSystemActorId } from "@/lib/system-actor";

// Policy Renewal & Lapsing daily job (Section 10 phase 9 / Section 5's
// "Policy Renewal & Lapsing Rules"). Runs across every agency — like
// setup.ts's storage-location lookup, this is host-level, not something a
// single agency's tenant-scoped client can express, so it uses the plain
// prisma singleton directly rather than getScopedPrisma.
//
// Every automatic transition below writes to ActivityLog, attributed to a
// reserved "system" actor (getSystemActorId(), system-actor.ts) — found in
// a full-app review that this had been skipped ("ActivityLog.userId is
// required, and there's no real user to attribute an automated status
// change to"), but Section 5's Audit/Activity Log requirement doesn't carve
// out an exception for automated changes: "every create/update/delete on a
// ... Policy ... is written to ActivityLog" applies here exactly as much as
// to a human-triggered one. Policy.updatedAt (schema) is the row-level
// fallback for "when," same role it plays on every other table.

const GRACE_PERIOD_DAYS = 30;

export type RenewalJobResult = {
  lapsed: number;
  enteredGracePeriod: number;
  completed: number;
  gracePeriodLapsed: number;
};

export async function runRenewalJob(): Promise<RenewalJobResult> {
  const now = new Date();
  const result: RenewalJobResult = { lapsed: 0, enteredGracePeriod: 0, completed: 0, gracePeriodLapsed: 0 };
  const systemActorId = await getSystemActorId();

  const dueActivePolicies = await prisma.policy.findMany({
    where: { status: "active", renewalDate: { lte: now } },
    include: { line: true, product: true },
  });

  for (const policy of dueActivePolicies) {
    if (policy.line.category === "travel") {
      // Per-trip coverage: once the end date (renewalDate) passes, it's
      // simply done — no lapsing, no grace period, no renewal.
      await prisma.policy.update({ where: { id: policy.id }, data: { status: "completed" } });
      await prisma.activityLog.create({
        data: { userId: systemActorId, agencyId: policy.agencyId, policyId: policy.id, action: "policy_completed", note: null },
      });
      result.completed++;
      continue;
    }

    if (policy.line.category === "life" && policy.product.lifePolicyType === "vul") {
      // VUL never lapses off renewalDate — only vulFundBalance reaching
      // zero lapses it, and that's a manually-updated figure, not
      // something this job evaluates.
      continue;
    }

    if (policy.line.category === "life" && policy.product.lifePolicyType === "non_term_traditional") {
      const gracePeriodEndsAt = new Date(policy.renewalDate);
      gracePeriodEndsAt.setDate(gracePeriodEndsAt.getDate() + GRACE_PERIOD_DAYS);
      await prisma.policy.update({
        where: { id: policy.id },
        data: { status: "grace_period", gracePeriodEndsAt },
      });
      await prisma.activityLog.create({
        data: {
          userId: systemActorId,
          agencyId: policy.agencyId,
          policyId: policy.id,
          action: "policy_entered_grace_period",
          note: `Grace period ends ${gracePeriodEndsAt.toLocaleDateString()}`,
        },
      });
      result.enteredGracePeriod++;
      continue;
    }

    // Everything else — non-life yearly lines (Auto/Property/Health) and
    // Life Term/Traditional — lapses immediately.
    await prisma.policy.update({ where: { id: policy.id }, data: { status: "lapsed" } });
    await prisma.activityLog.create({
      data: { userId: systemActorId, agencyId: policy.agencyId, policyId: policy.id, action: "policy_auto_lapsed", note: null },
    });
    result.lapsed++;
  }

  const dueGracePeriodPolicies = await prisma.policy.findMany({
    where: { status: "grace_period", gracePeriodEndsAt: { lte: now } },
  });
  for (const policy of dueGracePeriodPolicies) {
    await prisma.policy.update({
      where: { id: policy.id },
      data: { status: "lapsed", gracePeriodEndsAt: null },
    });
    await prisma.activityLog.create({
      data: {
        userId: systemActorId,
        agencyId: policy.agencyId,
        policyId: policy.id,
        action: "policy_auto_lapsed",
        note: "Grace period ended without a recorded renewal",
      },
    });
    result.gracePeriodLapsed++;
  }

  return result;
}
