import { getScopedPrisma } from "@/lib/tenant-db";
import { LEAD_STATUSES, POLICY_STATUSES } from "@/lib/status-labels";

export { LEAD_STATUSES, POLICY_STATUSES, LEAD_STATUS_LABELS, POLICY_STATUS_LABELS } from "@/lib/status-labels";

// Metrics & Dashboards (Section 10 phase 13 / Section 5's "Metrics &
// Dashboards"). Two shapes, matching the plan's own split:
//   - getMyDashboardMetrics: "Agent: my pipeline, my conversion rate, my
//     sales this month, follow-ups due (including my policies in
//     grace_period)" — every agency role gets this for their own records
//     (a Manager/Head has their own leads/policies too, same as /leads and
//     /policies already treat them).
//   - getTeamDashboardMetrics: "Manager/Head: leaderboard by agent,
//     conversion rate by insurance line, revenue/commission totals,
//     pipeline funnel, trends over time, policies by status" — scoped to
//     the caller's team via team-access.ts, same as /team/leads and
//     /team/policies (phase 12).
//
// "A sale counts the instant status reaches active" (Section 5) — sales
// this month and the monthly trend both key off ActivityLog's
// "policy_activated" entries, not Policy.startDate, since Policy has no
// createdAt of its own and startDate can be backdated by the agent.

export type FollowUpItem = {
  type: "lead" | "policy";
  id: string;
  label: string;
  dueDate: Date;
  href: string;
  overdue: boolean;
};

export async function getMyDashboardMetrics(agencyId: string, ownerId: string) {
  const scoped = getScopedPrisma(agencyId);
  const now = new Date();

  const leads = await scoped.lead.findMany({ where: { ownerId }, select: { status: true } });
  const pipeline = LEAD_STATUSES.map((status) => ({
    status,
    count: leads.filter((l) => l.status === status).length,
  }));
  const won = pipeline.find((p) => p.status === "won")!.count;
  const lost = pipeline.find((p) => p.status === "lost")!.count;
  const conversionRate = won + lost > 0 ? won / (won + lost) : null;

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const activationsThisMonth = await scoped.activityLog.findMany({
    where: { action: "policy_activated", timestamp: { gte: monthStart }, policy: { ownerId } },
    include: { policy: true },
  });
  const salesThisMonth = {
    count: activationsThisMonth.length,
    premium: activationsThisMonth.reduce((sum, a) => sum + (a.policy?.premium ?? 0), 0),
  };

  const followUps = await getMyFollowUps(agencyId, ownerId);

  return { pipeline, conversionRate, salesThisMonth, followUps };
}

// Extracted so /reminders (Section 10 phase 16 / Section 5's "Follow-up
// reminders list") can show the *full* list — the dashboard above only
// ever shows the top 5.
export async function getMyFollowUps(agencyId: string, ownerId: string): Promise<FollowUpItem[]> {
  const scoped = getScopedPrisma(agencyId);
  const now = new Date();

  const [dueLeads, gracePolicies] = await Promise.all([
    scoped.lead.findMany({
      where: { ownerId, nextFollowUpDate: { not: null }, status: { notIn: ["won", "lost"] } },
      orderBy: { nextFollowUpDate: "asc" },
      select: { id: true, name: true, nextFollowUpDate: true },
    }),
    scoped.policy.findMany({
      where: { ownerId, status: "grace_period" },
      orderBy: { gracePeriodEndsAt: "asc" },
      include: { product: true },
    }),
  ]);

  return [
    ...dueLeads.map((l) => ({
      type: "lead" as const,
      id: l.id,
      label: l.name,
      dueDate: l.nextFollowUpDate!,
      href: `/leads/${l.id}`,
      overdue: l.nextFollowUpDate! < now,
    })),
    ...gracePolicies
      .filter((p) => p.gracePeriodEndsAt)
      .map((p) => ({
        type: "policy" as const,
        id: p.id,
        label: `${p.product.name} — grace period ends`,
        dueDate: p.gracePeriodEndsAt!,
        href: `/policies/${p.id}`,
        overdue: p.gracePeriodEndsAt! < now,
      })),
  ].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

export type TeamDashboardFilters = {
  startDate?: string;
  endDate?: string;
  lineId?: string;
  ownerId?: string;
  status?: string;
};

function buildDateRange(startDate?: string, endDate?: string): { gte?: Date; lte?: Date } | undefined {
  if (!startDate && !endDate) return undefined;
  const range: { gte?: Date; lte?: Date } = {};
  if (startDate) range.gte = new Date(startDate);
  if (endDate) {
    // Inclusive of the whole end day, not just midnight
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    range.lte = end;
  }
  return range;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type TeamMember = { id: string; name: string; role: string };

// Members is passed in (already resolved by the caller via
// team-access.ts's listTeamMembers, same as /team/leads and /team/policies)
// rather than re-derived here, so this file doesn't need a callerId/role of
// its own — it just aggregates over whatever member/owner set it's given.
export async function getTeamDashboardMetrics(
  agencyId: string,
  ownerIds: string[],
  members: TeamMember[],
  filters: TeamDashboardFilters
) {
  const scoped = getScopedPrisma(agencyId);
  // An explicit agent filter narrows the whole dashboard to just that
  // person — the leaderboard rows for everyone else then correctly show
  // zero, since their leads/policies were never fetched.
  const effectiveOwnerIds = filters.ownerId ? [filters.ownerId] : ownerIds;
  const dateRange = buildDateRange(filters.startDate, filters.endDate);

  const leads = await scoped.lead.findMany({
    where: {
      ownerId: { in: effectiveOwnerIds },
      ...(filters.lineId ? { lineId: filters.lineId } : {}),
      ...(dateRange ? { createdAt: dateRange } : {}),
    },
    include: { line: true },
  });

  const pipelineFunnel = LEAD_STATUSES.map((status) => ({
    status,
    count: leads.filter((l) => l.status === status).length,
  }));

  const lineMap = new Map<string, { line: string; leadsTotal: number; won: number; lost: number }>();
  for (const lead of leads) {
    if (!lead.line) continue; // no line chosen on this lead yet
    const entry = lineMap.get(lead.line.id) ?? { line: lead.line.name, leadsTotal: 0, won: 0, lost: 0 };
    entry.leadsTotal += 1;
    if (lead.status === "won") entry.won += 1;
    if (lead.status === "lost") entry.lost += 1;
    lineMap.set(lead.line.id, entry);
  }
  const conversionByLine = [...lineMap.values()]
    .map((e) => ({ ...e, conversionRate: e.won + e.lost > 0 ? e.won / (e.won + e.lost) : null }))
    .sort((a, b) => b.leadsTotal - a.leadsTotal);

  const policies = await scoped.policy.findMany({
    where: {
      ownerId: { in: effectiveOwnerIds },
      ...(filters.lineId ? { lineId: filters.lineId } : {}),
      ...(dateRange ? { startDate: dateRange } : {}),
    },
  });

  // Deliberately ignores the status filter — this chart's whole purpose is
  // showing the breakdown across every status, so applying that filter
  // would collapse it to a single bar.
  const policiesByStatus = POLICY_STATUSES.map((status) => ({
    status,
    count: policies.filter((p) => p.status === status).length,
  }));

  // "Revenue/commission totals count active status and later — a draft
  // policy isn't a completed sale yet" (Section 5) is the default; an
  // explicit status filter (even "draft") overrides that default so the
  // filter behaves the way every other filter on this page does.
  const revenuePolicies = filters.status ? policies.filter((p) => p.status === filters.status) : policies.filter((p) => p.status !== "draft");
  const revenueTotals = {
    count: revenuePolicies.length,
    premium: revenuePolicies.reduce((s, p) => s + p.premium, 0),
    commission: revenuePolicies.reduce((s, p) => s + (p.commission ?? 0), 0),
  };

  const leaderboard = members.map((member) => {
    const memberLeads = leads.filter((l) => l.ownerId === member.id);
    const won = memberLeads.filter((l) => l.status === "won").length;
    const lost = memberLeads.filter((l) => l.status === "lost").length;
    const memberPolicies = policies.filter((p) => p.ownerId === member.id && p.status !== "draft");
    return {
      member,
      leadsTotal: memberLeads.length,
      won,
      conversionRate: won + lost > 0 ? won / (won + lost) : null,
      policiesCount: memberPolicies.length,
      totalPremium: memberPolicies.reduce((s, p) => s + p.premium, 0),
      totalCommission: memberPolicies.reduce((s, p) => s + (p.commission ?? 0), 0),
    };
  });

  // Trend over time (Section 5): fixed trailing 6-month window, filtered by
  // agent/line like everything else here, but deliberately NOT by the
  // date-range or status filters — it already carries its own time
  // dimension, and a status filter has no sensible meaning against
  // "activated this month" events.
  const now = new Date();
  const trendStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const activations = await scoped.activityLog.findMany({
    where: {
      action: "policy_activated",
      timestamp: { gte: trendStart },
      policy: { ownerId: { in: effectiveOwnerIds }, ...(filters.lineId ? { lineId: filters.lineId } : {}) },
    },
    include: { policy: true },
  });
  const trend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const key = monthKey(d);
    const inMonth = activations.filter((a) => monthKey(a.timestamp) === key);
    return {
      month: key,
      label: d.toLocaleString("en-US", { month: "short" }),
      salesCount: inMonth.length,
      premium: inMonth.reduce((s, a) => s + (a.policy?.premium ?? 0), 0),
    };
  });

  return { leaderboard, conversionByLine, revenueTotals, pipelineFunnel, policiesByStatus, trend };
}
