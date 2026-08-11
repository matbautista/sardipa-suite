import { NextResponse } from "next/server";
import { requireAgencySession } from "@/lib/session";
import { listOwnPolicies, listTeamPolicies } from "@/lib/policies";
import { getTeamMemberIds } from "@/lib/team-access";
import { toCsv } from "@/lib/csv";
import { POLICY_STATUS_LABELS } from "@/lib/status-labels";

// CSV export for Policies — same shape as /api/export/leads.
export async function GET(request: Request) {
  const session = await requireAgencySession();
  const scope = new URL(request.url).searchParams.get("scope");
  const today = new Date().toISOString().slice(0, 10);

  let csv: string;
  if (scope === "team") {
    if (session.user.role !== "manager" && session.user.role !== "head") {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    }
    const ownerIds = await getTeamMemberIds(session.user.agencyId, session.user.id, session.user.role);
    const policies = await listTeamPolicies(session.user.agencyId, ownerIds);
    csv = toCsv(
      ["Line", "Product", "Status", "Owner", "Premium", "Commission", "Start date", "Renewal date"],
      policies.map((policy) => [
        policy.line.name,
        policy.product.name,
        POLICY_STATUS_LABELS[policy.status] ?? policy.status,
        policy.owner.name,
        policy.premium,
        policy.commission ?? "",
        policy.startDate.toISOString().slice(0, 10),
        policy.renewalDate.toISOString().slice(0, 10),
      ])
    );
  } else {
    const policies = await listOwnPolicies(session.user.agencyId, session.user.id);
    csv = toCsv(
      ["Line", "Product", "Status", "Premium", "Commission", "Start date", "Renewal date"],
      policies.map((policy) => [
        policy.line.name,
        policy.product.name,
        POLICY_STATUS_LABELS[policy.status] ?? policy.status,
        policy.premium,
        policy.commission ?? "",
        policy.startDate.toISOString().slice(0, 10),
        policy.renewalDate.toISOString().slice(0, 10),
      ])
    );
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="policies-${scope === "team" ? "team" : "mine"}-${today}.csv"`,
    },
  });
}
