import { NextResponse } from "next/server";
import { requireAgencySession } from "@/lib/session";
import { listOwnLeads, listTeamLeads } from "@/lib/leads";
import { getTeamMemberIds } from "@/lib/team-access";
import { toCsv } from "@/lib/csv";
import { LEAD_STATUS_LABELS } from "@/lib/status-labels";

// CSV export for Leads (Section 10 phase 16 / Section 5's "CSV export").
// scope=team requires Manager/Head — same role check /team/leads' own
// page.tsx effectively gets for free from proxy.ts, but this is a plain
// API route, not a page, so proxy.ts's /team/* gate doesn't cover it; the
// check is repeated here explicitly.
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
    const leads = await listTeamLeads(session.user.agencyId, ownerIds);
    csv = toCsv(
      ["Name", "Phone", "Email", "Source", "Line", "Product", "Status", "Owner", "Next follow-up", "Notes"],
      leads.map((lead) => [
        lead.name,
        lead.phone ?? "",
        lead.email ?? "",
        lead.source,
        lead.line?.name ?? "",
        lead.product?.name ?? "",
        LEAD_STATUS_LABELS[lead.status] ?? lead.status,
        lead.owner?.name ?? "",
        lead.nextFollowUpDate ? lead.nextFollowUpDate.toISOString().slice(0, 10) : "",
        lead.notes ?? "",
      ])
    );
  } else {
    const leads = await listOwnLeads(session.user.agencyId, session.user.id);
    csv = toCsv(
      ["Name", "Phone", "Email", "Source", "Line", "Product", "Status", "Next follow-up", "Notes"],
      leads.map((lead) => [
        lead.name,
        lead.phone ?? "",
        lead.email ?? "",
        lead.source,
        lead.line?.name ?? "",
        lead.product?.name ?? "",
        LEAD_STATUS_LABELS[lead.status] ?? lead.status,
        lead.nextFollowUpDate ? lead.nextFollowUpDate.toISOString().slice(0, 10) : "",
        lead.notes ?? "",
      ])
    );
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${scope === "team" ? "team" : "mine"}-${today}.csv"`,
    },
  });
}
