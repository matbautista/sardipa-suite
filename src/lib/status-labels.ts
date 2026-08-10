// Plain constants shared between server data-fetching code
// (dashboard-metrics.ts) and client chart components (team/dashboard's
// charts.tsx). Deliberately has zero imports of its own — dashboard-metrics.ts
// pulls in tenant-db.ts -> prisma.ts -> better-sqlite3, which is Node-only and
// can't be bundled for the browser; a client component importing any of
// those consts *from* dashboard-metrics.ts would drag that whole chain into
// the client bundle and fail the production build. Keeping these labels in
// their own import-free file is what lets both sides use the same source of
// truth safely.

export const LEAD_STATUSES = ["new", "contacted", "quoted", "negotiating", "won", "lost"] as const;
export const POLICY_STATUSES = ["draft", "active", "grace_period", "lapsed", "cancelled", "completed"] as const;

export const LEAD_STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
};

export const POLICY_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  grace_period: "Grace period",
  lapsed: "Lapsed",
  cancelled: "Cancelled",
  completed: "Completed",
};
