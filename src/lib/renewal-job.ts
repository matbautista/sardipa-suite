import { prisma } from "@/lib/prisma";

// Policy Renewal & Lapsing daily job (Section 10 phase 9 / Section 5's
// "Policy Renewal & Lapsing Rules"). Runs across every agency — like
// setup.ts's storage-location lookup, this is host-level, not something a
// single agency's tenant-scoped client can express, so it uses the plain
// prisma singleton directly rather than getScopedPrisma.
//
// No ActivityLog entry is written for these automatic transitions:
// ActivityLog.userId is required (Section 6), and there's no real user to
// attribute an automated status change to — a synthetic "system" actor
// wasn't part of what this phase was asked to build. The Policy's own
// status field is still the source of truth for what happened and when.

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

  const dueActivePolicies = await prisma.policy.findMany({
    where: { status: "active", renewalDate: { lte: now } },
    include: { line: true, product: true },
  });

  for (const policy of dueActivePolicies) {
    if (policy.line.category === "travel") {
      // Per-trip coverage: once the end date (renewalDate) passes, it's
      // simply done — no lapsing, no grace period, no renewal.
      await prisma.policy.update({ where: { id: policy.id }, data: { status: "completed" } });
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
      result.enteredGracePeriod++;
      continue;
    }

    // Everything else — non-life yearly lines (Auto/Property/Health) and
    // Life Term/Traditional — lapses immediately.
    await prisma.policy.update({ where: { id: policy.id }, data: { status: "lapsed" } });
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
    result.gracePeriodLapsed++;
  }

  return result;
}
