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

// Human-readable labels for ActivityLog.action (Section 10 phase 16's
// Activity Log viewer) — every distinct action string written anywhere in
// src/lib. Falls back to the raw action string for anything not listed
// here, so a future mutating feature that adds a new action without
// updating this map still shows *something*, just less polished.
export const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  lead_created: "Lead created",
  lead_updated: "Lead updated",
  lead_deleted: "Lead deleted",
  lead_claimed: "Lead claimed",
  lead_reassigned: "Lead reassigned",
  policy_created: "Policy created",
  policy_updated: "Policy updated",
  policy_activated: "Policy activated",
  policy_renewed: "Policy renewed",
  document_uploaded: "Document uploaded",
  lock_force_released: "Record lock force-released",
  manager_account_created: "Manager account created",
  agent_account_created: "Agent account created",
  password_reset_by_head: "Password reset (by Agency Head)",
  password_changed: "Password changed",
  manager_reassigned: "Agent reassigned to a different manager",
  user_reactivated: "User reactivated",
  user_deactivated: "User deactivated",
  super_admin_created: "Super Admin account created",
  storage_location_added: "Storage location added",
  agency_and_head_created: "Agency and Agency Head created",
  login_success: "Login succeeded",
  login_failed: "Login failed",
  login_locked_out: "Login attempted while locked out",
  login_failed_lockout_triggered: "Login failed — account locked",
};
