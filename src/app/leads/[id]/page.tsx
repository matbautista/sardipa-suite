import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAgencySession } from "@/lib/session";
import { getOwnLead, updateLead, deleteLead, type LeadInput } from "@/lib/leads";
import { listInsuranceLines } from "@/lib/insurance-lines";

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

  async function updateLeadAction(formData: FormData) {
    "use server";
    const session = await requireAgencySession();
    const result = await updateLead(session.user.agencyId, session.user.id, id, readLeadInput(formData));
    if (!result.ok) {
      redirect(`/leads/${id}?error=${encodeURIComponent(result.error)}`);
    }
    redirect(`/leads/${id}`);
  }

  async function deleteLeadAction() {
    "use server";
    const session = await requireAgencySession();
    await deleteLead(session.user.agencyId, session.user.id, id);
    redirect("/leads");
  }

  const [lead, lines] = await Promise.all([
    getOwnLead(session.user.agencyId, session.user.id, id),
    listInsuranceLines(session.user.agencyId),
  ]);

  if (!lead) {
    notFound();
  }

  const products = lines.flatMap((line) => line.products.map((product) => ({ ...product, lineName: line.name })));

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">{lead.name}</h1>
        <Link href="/leads" className="text-sm text-gray-500 underline hover:text-gray-800">
          Back to my leads
        </Link>
      </div>

      <form action={updateLeadAction} className="mt-8 space-y-4">
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

      <form action={deleteLeadAction} className="mt-4">
        <button type="submit" className="text-sm text-red-600 underline hover:text-red-800">
          Delete this lead
        </button>
      </form>
    </div>
  );
}
