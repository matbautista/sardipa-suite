import Link from "next/link";
import { redirect } from "next/navigation";
import { requireHeadSession } from "@/lib/session";
import { listInsuranceLines, createInsuranceLine, createProduct } from "@/lib/insurance-lines";

const CATEGORIES = ["life", "auto", "property", "health", "travel", "other"] as const;
const LIFE_POLICY_TYPES = ["term", "non_term_traditional", "vul"] as const;

async function createLineAction(formData: FormData) {
  "use server";
  const session = await requireHeadSession();
  const name = String(formData.get("name") ?? "");
  const category = String(formData.get("category") ?? "");

  const result = await createInsuranceLine(session.user.agencyId, name, category);
  if (!result.ok) {
    redirect(`/agency/lines?error=${encodeURIComponent(result.error)}`);
  }
  redirect("/agency/lines");
}

async function createProductAction(formData: FormData) {
  "use server";
  const session = await requireHeadSession();
  const lineId = String(formData.get("lineId") ?? "");
  const name = String(formData.get("name") ?? "");
  const description = String(formData.get("description") ?? "");
  const lifePolicyType = String(formData.get("lifePolicyType") ?? "");

  const result = await createProduct(session.user.agencyId, lineId, name, description, lifePolicyType);
  if (!result.ok) {
    redirect(`/agency/lines?error=${encodeURIComponent(result.error)}`);
  }
  redirect("/agency/lines");
}

export default async function InsuranceLinesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireHeadSession();
  const { error } = await searchParams;
  const lines = await listInsuranceLines(session.user.agencyId);

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Insurance Lines &amp; Products</h1>
        <Link href="/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
          Back to dashboard
        </Link>
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-8 space-y-6">
        {lines.map((line) => (
          <div key={line.id} className="rounded-md border border-gray-200 p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-medium text-gray-800">{line.name}</h2>
              <span className="text-xs text-gray-400">{line.category}</span>
            </div>

            <ul className="mt-2 divide-y divide-gray-100">
              {line.products.map((product) => (
                <li key={product.id} className="py-2 text-sm text-gray-700">
                  {product.name}
                  {product.lifePolicyType && (
                    <span className="ml-2 text-xs text-gray-400">({product.lifePolicyType})</span>
                  )}
                </li>
              ))}
              {line.products.length === 0 && (
                <li className="py-2 text-sm text-gray-400">No products yet.</li>
              )}
            </ul>

            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-800">
                Add a product to {line.name}
              </summary>
              <form action={createProductAction} className="mt-3 space-y-3">
                <input type="hidden" name="lineId" value={line.id} />
                <div>
                  <label className="block text-xs font-medium text-gray-700">Product name</label>
                  <input
                    name="name"
                    type="text"
                    required
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">Description (optional)</label>
                  <input
                    name="description"
                    type="text"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
                  />
                </div>
                {line.category === "life" && (
                  <div>
                    <label className="block text-xs font-medium text-gray-700">
                      Life policy type (drives the renewal/lapsing rule — Section 5)
                    </label>
                    <select
                      name="lifePolicyType"
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
                    >
                      <option value="">— choose —</option>
                      {LIFE_POLICY_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <button
                  type="submit"
                  className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
                >
                  Add product
                </button>
              </form>
            </details>
          </div>
        ))}
        {lines.length === 0 && (
          <p className="text-sm text-gray-400">No insurance lines yet — add one below.</p>
        )}
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-medium text-gray-700">Add a new insurance line</h2>
        <form action={createLineAction} className="mt-3 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input
              name="name"
              type="text"
              required
              placeholder='e.g. "Life" or something marketing-y like "Family Protection Plan"'
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Category</label>
            <p className="text-xs text-gray-400">
              Fixed set the app&apos;s logic keys off of — forms, required documents, and
              renewal rules are wired to this, not to the name above (Section 4).
            </p>
            <select
              name="category"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            >
              <option value="">— choose —</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Add line
          </button>
        </form>
      </div>
    </div>
  );
}
