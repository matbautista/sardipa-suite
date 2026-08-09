import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAgencySession } from "@/lib/session";
import { listOwnLeads, createLead, type LeadInput } from "@/lib/leads";
import { listInsuranceLines } from "@/lib/insurance-lines";

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
};

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

async function createLeadAction(formData: FormData) {
  "use server";
  const session = await requireAgencySession();
  const result = await createLead(session.user.agencyId, session.user.id, readLeadInput(formData));
  if (!result.ok) {
    redirect(`/leads?error=${encodeURIComponent(result.error)}`);
  }
  redirect("/leads");
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await requireAgencySession();
  const { error } = await searchParams;
  const [leads, lines] = await Promise.all([
    listOwnLeads(session.user.agencyId, session.user.id),
    listInsuranceLines(session.user.agencyId),
  ]);
  const products = lines.flatMap((line) => line.products.map((product) => ({ ...product, lineName: line.name })));

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">My Leads</h1>
        <Link href="/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
          Back to dashboard
        </Link>
      </div>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <ul className="mt-8 divide-y divide-gray-200 rounded-md border border-gray-200">
        {leads.map((lead) => (
          <li key={lead.id} className="px-4 py-3 text-sm">
            <Link href={`/leads/${lead.id}`} className="flex items-center justify-between hover:underline">
              <span className="text-gray-800">{lead.name}</span>
              <span className="text-gray-400">
                {lead.product ? `${lead.product.name} (${lead.line?.name})` : lead.line ? lead.line.name : "—"}
                {" · "}
                {STATUS_LABELS[lead.status] ?? lead.status}
              </span>
            </Link>
          </li>
        ))}
        {leads.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">No leads yet — add one below.</li>}
      </ul>

      <div className="mt-8">
        <h2 className="text-sm font-medium text-gray-700">Add a lead</h2>
        <form action={createLeadAction} className="mt-3 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input
              name="name"
              type="text"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Phone</label>
              <input
                name="phone"
                type="text"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <input
                name="email"
                type="email"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Source</label>
            <input
              name="source"
              type="text"
              defaultValue="Manual"
              placeholder="e.g. Referral, Manual, Walk-in"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Insurance line (optional)</label>
              <select
                name="lineId"
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
                name="productId"
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
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Notes</label>
            <textarea
              name="notes"
              rows={3}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Add lead
          </button>
        </form>
      </div>
    </div>
  );
}
