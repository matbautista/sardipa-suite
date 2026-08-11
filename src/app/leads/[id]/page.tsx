import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAgencySession } from "@/lib/session";
import { getOwnLead, getLeadOwnerId, updateLead, deleteLead, type LeadInput } from "@/lib/leads";
import { listInsuranceLines } from "@/lib/insurance-lines";
import { getLockStatus, checkOut, checkIn } from "@/lib/record-lock";
import { getPolicyForLead } from "@/lib/policies";
import { resolveAccessibleOwner } from "@/lib/team-access";

const RECORD_TYPE = "lead";

const STATUSES = ["new", "contacted", "quoted", "negotiating", "won", "lost"] as const;

function readLeadInput(formData: FormData): LeadInput {
  return {
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
    source: String(formData.get("source") ?? ""),
    lineId: String(formData.get("lineId") ?? ""),
    productId: String(formData.get("productId") ?? ""),
    status: String(formData.get("status") ?? "new"),
    notes: String(formData.get("notes") ?? ""),
    nextFollowUpDate: String(formData.get("nextFollowUpDate") ?? ""),
  };
}

// Date input wants "YYYY-MM-DD" — DateTime from the DB carries a time
// component that would make the input reject its own defaultValue.
function toDateInputValue(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAgencySession();
  const { id } = await params;

  // Resolves "which owner's lead may this caller touch" once, the same
  // pattern as policies/[id]/page.tsx (phase 12). Re-derives its own
  // session rather than accepting one as a parameter — a plain closure
  // referenced from inside another "use server" action isn't itself a
  // valid server reference unless it's independently marked "use server",
  // and a "use server" function's bound args must be plain serializable
  // values, not a NextAuth session object. Redirects rather than
  // notFound() inside a Server Action, since actions can't render a 404.
  async function resolveOwnerOrRedirect(): Promise<string> {
    "use server";
    const session = await requireAgencySession();
    const recordOwnerId = await getLeadOwnerId(session.user.agencyId, id);
    if (recordOwnerId === undefined || recordOwnerId === null) {
      redirect("/leads");
    }
    const accessibleOwnerId = await resolveAccessibleOwner(
      session.user.agencyId,
      session.user.id,
      session.user.role,
      recordOwnerId
    );
    if (!accessibleOwnerId) {
      redirect("/leads");
    }
    return accessibleOwnerId;
  }

  async function updateLeadAction(formData: FormData) {
    "use server";
    const session = await requireAgencySession();
    const ownerId = await resolveOwnerOrRedirect();
    const result = await updateLead(session.user.agencyId, ownerId, session.user.id, id, readLeadInput(formData));
    if (!result.ok) {
      redirect(`/leads/${id}?error=${encodeURIComponent(result.error)}`);
    }
    // "Checked in automatically when the editor saves" (Section 5) — always
    // the real caller's lock, never the resolved owner's.
    await checkIn(session.user.agencyId, session.user.id, RECORD_TYPE, id);
    redirect(`/leads/${id}`);
  }

  async function deleteLeadAction() {
    "use server";
    const session = await requireAgencySession();
    const ownerId = await resolveOwnerOrRedirect();
    await deleteLead(session.user.agencyId, ownerId, session.user.id, id);
    await checkIn(session.user.agencyId, session.user.id, RECORD_TYPE, id);
    redirect("/leads");
  }

  // "Checked in automatically when... navigating away/closes the edit
  // form" (Section 5) — the one exit path this app can reliably catch
  // server-side. Anything less deliberate (back button, closing the tab)
  // falls back to the lock's own auto-release timeout, same as the plan
  // expects ("covers someone closing their browser without properly
  // exiting the form").
  async function backToLeadsAction() {
    "use server";
    const session = await requireAgencySession();
    await checkIn(session.user.agencyId, session.user.id, RECORD_TYPE, id);
    const recordOwnerId = await getLeadOwnerId(session.user.agencyId, id);
    redirect(recordOwnerId === session.user.id ? "/leads" : "/team/leads");
  }

  const recordOwnerId = await getLeadOwnerId(session.user.agencyId, id);
  if (recordOwnerId === undefined || recordOwnerId === null) {
    notFound();
  }
  const accessibleOwnerId = await resolveAccessibleOwner(
    session.user.agencyId,
    session.user.id,
    session.user.role,
    recordOwnerId
  );
  if (!accessibleOwnerId) {
    notFound();
  }
  const viewingOwnRecord = accessibleOwnerId === session.user.id;

  const [lead, lines] = await Promise.all([
    getOwnLead(session.user.agencyId, accessibleOwnerId, id),
    listInsuranceLines(session.user.agencyId),
  ]);

  if (!lead) {
    notFound();
  }

  // Opening this page doubles as entering edit mode — there's no separate
  // read-only view yet. The lock itself is always keyed to the real caller
  // (session.user.id), never the resolved owner — see record-lock.ts.
  const lockStatus = await getLockStatus(session.user.agencyId, session.user.id, RECORD_TYPE, id);
  const lockedByOther = lockStatus.locked && !lockStatus.heldBySelf;
  if (!lockedByOther) {
    await checkOut(session.user.agencyId, session.user.id, RECORD_TYPE, id);
  }

  const products = lines.flatMap((line) => line.products.map((product) => ({ ...product, lineName: line.name })));
  const existingPolicy =
    lead.status === "won" ? await getPolicyForLead(session.user.agencyId, accessibleOwnerId, id) : null;

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">{lead.name}</h1>
        <form action={backToLeadsAction}>
          <button type="submit" className="text-sm text-gray-500 underline hover:text-gray-800">
            {viewingOwnRecord ? "Back to my leads" : "Back to team leads"}
          </button>
        </form>
      </div>

      {!viewingOwnRecord && <p className="mt-1 text-sm text-gray-500">Owned by {lead.owner?.name ?? "—"}</p>}

      {lead.status === "won" && (
        <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {existingPolicy ? (
            <>
              Already converted to a policy —{" "}
              <Link href={`/policies/${existingPolicy.id}`} className="underline hover:text-green-900">
                view it
              </Link>
              .
            </>
          ) : (
            <>
              This lead is Won —{" "}
              <Link href={`/policies/new?leadId=${id}`} className="underline hover:text-green-900">
                convert it to a policy
              </Link>
              .
            </>
          )}
        </p>
      )}

      {lockedByOther && lockStatus.locked && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Currently being edited by {lockStatus.holderName}, since{" "}
          {lockStatus.lockedAt.toLocaleString()}. Read-only until they save or the lock expires.
        </p>
      )}

      <form
        action={updateLeadAction}
        inert={lockedByOther}
        className={`mt-8 space-y-4 ${lockedByOther ? "opacity-50" : ""}`}
      >
        <div>
          <label className="block text-sm font-medium text-gray-700">Name</label>
          <input
            name="name"
            type="text"
            required
            defaultValue={lead.name}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Phone</label>
            <input
              name="phone"
              type="text"
              defaultValue={lead.phone ?? ""}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              name="email"
              type="email"
              defaultValue={lead.email ?? ""}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Source</label>
          <input
            name="source"
            type="text"
            defaultValue={lead.source}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Status</label>
          <select
            name="status"
            defaultValue={lead.status}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Insurance line (optional)</label>
            <select
              key={lead.lineId ?? "none"}
              name="lineId"
              defaultValue={lead.lineId ?? ""}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            >
              <option value="">— none yet —</option>
              {lines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Product (optional)</label>
            <select
              key={lead.productId ?? "none"}
              name="productId"
              defaultValue={lead.productId ?? ""}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            >
              <option value="">— none yet —</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} ({product.lineName})
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-gray-400">
          Picking a product sets its line automatically — no need to also match the line dropdown.
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-700">Next follow-up date (optional)</label>
          <input
            name="nextFollowUpDate"
            type="date"
            defaultValue={toDateInputValue(lead.nextFollowUpDate)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Notes</label>
          <textarea
            name="notes"
            rows={4}
            defaultValue={lead.notes ?? ""}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Save changes
        </button>
      </form>

      {!lockedByOther && (
        <form action={deleteLeadAction} className="mt-4">
          <button type="submit" className="text-sm text-red-600 underline hover:text-red-800">
            Delete this lead
          </button>
        </form>
      )}
    </div>
  );
}
