import { getScopedPrisma } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";

// Audit/Activity Log viewer (Section 10 phase 16 / Section 5's "Audit /
// Activity Log": "Agency Head can view their agency's log; Super Admin can
// view host-level events... a simple filterable list (by record, by user,
// by date range) is enough"). The writes themselves live throughout
// src/lib (leads.ts, policies.ts, documents.ts, agency-users.ts, etc.) —
// this file is read-only.

export type ActivityLogFilters = {
  userId?: string;
  startDate?: string;
  endDate?: string;
  recordType?: "lead" | "policy";
  recordId?: string;
};

const PAGE_SIZE = 200;

function dateRange(startDate?: string, endDate?: string): { gte?: Date; lte?: Date } | undefined {
  if (!startDate && !endDate) return undefined;
  const range: { gte?: Date; lte?: Date } = {};
  if (startDate) range.gte = new Date(startDate);
  if (endDate) {
    // Inclusive of the whole end day, not just midnight — same convention
    // as dashboard-metrics.ts's buildDateRange.
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    range.lte = end;
  }
  return range;
}

function buildWhere(filters: ActivityLogFilters) {
  const range = dateRange(filters.startDate, filters.endDate);
  return {
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(range ? { timestamp: range } : {}),
    ...(filters.recordType === "lead" && filters.recordId ? { leadId: filters.recordId } : {}),
    ...(filters.recordType === "policy" && filters.recordId ? { policyId: filters.recordId } : {}),
  };
}

// Agency Head's own agency, whole-agency scope (no Manager version — the
// plan only mentions Head/Super Admin for this feature, unlike leads/
// policies' Manager-scoped team views).
export async function listAgencyActivityLog(agencyId: string, filters: ActivityLogFilters = {}) {
  const scoped = getScopedPrisma(agencyId);
  return scoped.activityLog.findMany({
    where: buildWhere(filters),
    orderBy: { timestamp: "desc" },
    take: PAGE_SIZE,
    include: { user: true, lead: true, policy: true },
  });
}

// Super Admin's host-level events only (agencyId null — their own logins
// and onboarding actions) — not every agency's log, which would break the
// tenant-isolation story the rest of the app maintains.
export async function listHostActivityLog(filters: Omit<ActivityLogFilters, "recordType" | "recordId"> = {}) {
  return prisma.activityLog.findMany({
    where: { agencyId: null, ...buildWhere(filters) },
    orderBy: { timestamp: "desc" },
    take: PAGE_SIZE,
    include: { user: true },
  });
}
