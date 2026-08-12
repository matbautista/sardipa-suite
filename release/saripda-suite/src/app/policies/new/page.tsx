import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAgencySession } from "@/lib/session";
import { getOwnLead, getLeadOwnerId } from "@/lib/leads";
import { convertLeadToPolicy } from "@/lib/policies";
import { listInsuranceLines } from "@/lib/insurance-lines";
import { resolveAccessibleOwner } from "@/lib/team-access";

export default async function NewPolicyPage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string; error?: string }>;
}) {
  const session = await requireAgencySession();
  const { leadId, error } = await searchParams;

  if (!leadId) {
    notFound();
  }

  // Resolves "which owner's lead may this caller touch" the same way
  // leads/[id]/page.tsx and policies/[id]/page.tsx already do — found
  // missing here in a full-app review: this page previously always used
  // the caller's own id, so a Manager/Head converting a subordinate's Won
  // lead (a link leads/[id]/page.tsx already shows them) 404'd instead of
  // working.
  const recordOwnerId = await getLeadOwnerId(session.user.agencyId, leadId);
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

  const lead = await getOwnLead(session.user.agencyId, accessibleOwnerId, leadId);
  if (!lead) {
    notFound();
  }
  if (lead.status !== "won") {
    redirect(`/leads/${leadId}?error=${encodeURIComponent("Only a Won lead can be converted to a policy.")}`);
  }

  async function convertLeadToPolicyAction(formData: FormData) {
    "use server";
    const session = await requireAgencySession();
    const recordOwnerId = await getLeadOwnerId(session.user.agencyId, leadId!);
    const accessibleOwnerId = await resolveAccessibleOwner(
      session.user.agencyId,
      session.user.id,
      session.user.role,
      recordOwnerId ?? null
    );
    if (!accessibleOwnerId) {
      redirect("/leads");
    }
    const result = await convertLeadToPolicy(session.user.agencyId, accessibleOwnerId, session.user.id, leadId!, {
      lineId: String(formData.get("lineId") ?? ""),
      productId: String(formData.get("productId") ?? ""),
      premium: String(formData.get("premium") ?? ""),
      commission: String(formData.get("commission") ?? ""),
      startDate: String(formData.get("startDate") ?? ""),
      renewalDate: String(formData.get("renewalDate") ?? ""),
    });
    if (!result.ok) {
      redirect(`/policies/new?leadId=${leadId}&error=${encodeURIComponent(result.error)}`);
    }
    redirect(`/policies/${result.policyId}`);
  }

  const lines = await listInsuranceLines(session.user.agencyId);
  const products = lines.flatMap((line) => line.products.map((product) => ({ ...product, lineName: line.name })));

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Convert &quot;{lead.name}&quot; to a Policy</h1>
        <Link href={`/leads/${leadId}`} className="text-sm text-gray-500 underline hover:text-gray-800">
          Back to lead
        </Link>
      </div>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <form action={convertLeadToPolicyAction} className="mt-8 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Insurance line</label>
            <select
              name="lineId"
              required
              defaultValue={lead.lineId ?? ""}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            >
              <option value="">— choose —</option>
              {lines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Product</label>
            <select
              name="productId"
              required
              defaultValue={lead.productId ?? ""}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            >
              <option value="">— choose —</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} ({product.lineName})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Premium</label>
            <input
              name="premium"
              type="number"
              step="0.01"
              min="0.01"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Commission (optional)</label>
            <input
              name="commission"
              type="number"
              step="0.01"
              min="0"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Start date</label>
            <input
              name="startDate"
              type="date"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Renewal date</label>
            <input
              name="renewalDate"
              type="date"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-400">
              For a Travel policy, this is the trip&apos;s end date rather than an annual renewal.
            </p>
          </div>
        </div>
        <button
          type="submit"
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Create draft policy
        </button>
      </form>
    </div>
  );
}
