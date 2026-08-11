import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAgencySession } from "@/lib/session";
import {
  getOwnPolicy,
  getPolicyOwnerId,
  updateDraftPolicy,
  activatePolicy,
  recordRenewal,
  type PolicyFormInput,
} from "@/lib/policies";
import { uploadDocument, listPolicyDocuments } from "@/lib/documents";
import { listInsuranceLines } from "@/lib/insurance-lines";
import { getLockStatus, checkOut, checkIn, forceRelease } from "@/lib/record-lock";
import { resolveAccessibleOwner } from "@/lib/team-access";

const RECORD_TYPE = "policy";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  grace_period: "Grace period",
  lapsed: "Lapsed",
  cancelled: "Cancelled",
  completed: "Completed",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  proof_of_payment: "Proof of Payment",
  valid_id: "Valid ID",
  other: "Other",
};

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function readPolicyInput(formData: FormData): PolicyFormInput {
  return {
    lineId: String(formData.get("lineId") ?? ""),
    productId: String(formData.get("productId") ?? ""),
    premium: String(formData.get("premium") ?? ""),
    commission: String(formData.get("commission") ?? ""),
    startDate: String(formData.get("startDate") ?? ""),
    renewalDate: String(formData.get("renewalDate") ?? ""),
  };
}

export default async function PolicyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireAgencySession();
  const { id } = await params;
  const { error } = await searchParams;

  // Resolves which owner's policy this caller may act on (phase 12's
  // Manager/Head cross-visibility) — themselves, or (for Manager/Head) the
  // record's real owner once resolveAccessibleOwner confirms access.
  // Re-derives its own session rather than accepting one as a parameter — a
  // plain closure referenced from inside another "use server" action isn't
  // itself a valid server reference unless independently marked
  // "use server", and a "use server" function's bound args must be plain
  // serializable values, not a NextAuth session object. Redirects away
  // rather than 404ing from inside a server action, since notFound() only
  // works from a page render.
  async function resolveOwnerOrRedirect(): Promise<string> {
    "use server";
    const session = await requireAgencySession();
    const recordOwnerId = await getPolicyOwnerId(session.user.agencyId, id);
    if (recordOwnerId === undefined) {
      redirect("/policies");
    }
    const accessibleOwnerId = await resolveAccessibleOwner(session.user.agencyId, session.user.id, session.user.role, recordOwnerId);
    if (!accessibleOwnerId) {
      redirect("/policies");
    }
    return accessibleOwnerId;
  }

  async function updatePolicyAction(formData: FormData) {
    "use server";
    const session = await requireAgencySession();
    const ownerId = await resolveOwnerOrRedirect();
    const result = await updateDraftPolicy(session.user.agencyId, ownerId, session.user.id, id, readPolicyInput(formData));
    if (!result.ok) {
      redirect(`/policies/${id}?error=${encodeURIComponent(result.error)}`);
    }
    await checkIn(session.user.agencyId, session.user.id, RECORD_TYPE, id);
    redirect(`/policies/${id}`);
  }

  async function activatePolicyAction() {
    "use server";
    const session = await requireAgencySession();
    const ownerId = await resolveOwnerOrRedirect();
    const result = await activatePolicy(session.user.agencyId, ownerId, session.user.id, id);
    if (!result.ok) {
      redirect(`/policies/${id}?error=${encodeURIComponent(result.error)}`);
    }
    redirect(`/policies/${id}`);
  }

  async function uploadDocumentAction(formData: FormData) {
    "use server";
    const session = await requireAgencySession();
    const ownerId = await resolveOwnerOrRedirect();
    const file = formData.get("document") as File;
    const docType = String(formData.get("docType") ?? "");
    const result = await uploadDocument(session.user.agencyId, id, ownerId, session.user.id, docType, file);
    if (!result.ok) {
      redirect(`/policies/${id}?error=${encodeURIComponent(result.error)}`);
    }
    redirect(`/policies/${id}`);
  }

  async function renewalPaymentAction(formData: FormData) {
    "use server";
    const session = await requireAgencySession();
    const ownerId = await resolveOwnerOrRedirect();
    const file = formData.get("document") as File;
    const uploadResult = await uploadDocument(session.user.agencyId, id, ownerId, session.user.id, "proof_of_payment", file);
    if (!uploadResult.ok) {
      redirect(`/policies/${id}?error=${encodeURIComponent(uploadResult.error)}`);
    }
    const result = await recordRenewal(session.user.agencyId, ownerId, session.user.id, id);
    if (!result.ok) {
      redirect(`/policies/${id}?error=${encodeURIComponent(result.error)}`);
    }
    redirect(`/policies/${id}`);
  }

  // Manager/Head force-release override (Section 5) — same fix and
  // reasoning as leads/[id]/page.tsx's forceReleaseAction, found missing
  // in a full-app review. Releases the one shared policy-level lock this
  // page and all five detail sub-pages (/life, /auto, /travel, /property,
  // /health) key off, so releasing here clears it everywhere.
  async function forceReleaseAction() {
    "use server";
    const session = await requireAgencySession();
    if (session.user.role !== "manager" && session.user.role !== "head") {
      redirect(`/policies/${id}?error=${encodeURIComponent("Only a Manager or Agency Head can force-release a lock.")}`);
    }
    await resolveOwnerOrRedirect();
    await forceRelease(session.user.agencyId, session.user.id, RECORD_TYPE, id);
    redirect(`/policies/${id}`);
  }

  async function backToPoliciesAction() {
    "use server";
    const session = await requireAgencySession();
    await checkIn(session.user.agencyId, session.user.id, RECORD_TYPE, id);
    const ownerId = await getPolicyOwnerId(session.user.agencyId, id);
    redirect(ownerId === session.user.id ? "/policies" : "/team/policies");
  }

  const recordOwnerId = await getPolicyOwnerId(session.user.agencyId, id);
  if (recordOwnerId === undefined) {
    notFound();
  }
  const accessibleOwnerId = await resolveAccessibleOwner(session.user.agencyId, session.user.id, session.user.role, recordOwnerId);
  if (!accessibleOwnerId) {
    notFound();
  }
  const viewingOwnRecord = accessibleOwnerId === session.user.id;

  const policy = await getOwnPolicy(session.user.agencyId, accessibleOwnerId, id);
  if (!policy) {
    notFound();
  }

  const lockStatus = await getLockStatus(session.user.agencyId, session.user.id, RECORD_TYPE, id);
  const lockedByOther = lockStatus.locked && !lockStatus.heldBySelf;
  if (!lockedByOther) {
    await checkOut(session.user.agencyId, session.user.id, RECORD_TYPE, id);
  }

  const [lines, documents] = await Promise.all([
    listInsuranceLines(session.user.agencyId),
    listPolicyDocuments(session.user.agencyId, accessibleOwnerId, id),
  ]);
  const products = lines.flatMap((line) => line.products.map((product) => ({ ...product, lineName: line.name })));

  const canRenew = policy.status === "lapsed" || policy.status === "grace_period";

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">
          {policy.product.name} ({policy.line.name})
        </h1>
        <form action={backToPoliciesAction}>
          <button type="submit" className="text-sm text-gray-500 underline hover:text-gray-800">
            {viewingOwnRecord ? "Back to my policies" : "Back to team policies"}
          </button>
        </form>
      </div>

      {!viewingOwnRecord && (
        <p className="mt-1 text-sm text-gray-500">Owned by {policy.owner.name}</p>
      )}
      <p className="mt-1 text-sm text-gray-500">Status: {STATUS_LABELS[policy.status] ?? policy.status}</p>
      {policy.status === "grace_period" && policy.gracePeriodEndsAt && (
        <p className="mt-1 text-sm text-amber-700">
          Grace period ends {policy.gracePeriodEndsAt.toLocaleDateString()} — collect payment before then to
          avoid the policy lapsing.
        </p>
      )}
      {policy.line.category === "life" && policy.product.lifePolicyType === "vul" && (
        <p className="mt-1 text-xs text-gray-400">
          VUL fund balance: {policy.vulFundBalance ?? "not yet recorded"} (periodic balance updates aren&apos;t
          built yet — VUL policies don&apos;t lapse off the renewal date shown below).
        </p>
      )}
      {policy.line.category === "life" && (
        <p className="mt-2">
          <Link href={`/policies/${policy.id}/life`} className="text-sm text-gray-500 underline hover:text-gray-800">
            Insured, Owner &amp; Beneficiary details
          </Link>
        </p>
      )}
      {policy.line.category === "auto" && (
        <p className="mt-2">
          <Link href={`/policies/${policy.id}/auto`} className="text-sm text-gray-500 underline hover:text-gray-800">
            Owner &amp; Vehicle details
          </Link>
        </p>
      )}
      {policy.line.category === "travel" && (
        <p className="mt-2">
          <Link href={`/policies/${policy.id}/travel`} className="text-sm text-gray-500 underline hover:text-gray-800">
            Travel details
          </Link>
        </p>
      )}
      {policy.line.category === "property" && (
        <p className="mt-2">
          <Link href={`/policies/${policy.id}/property`} className="text-sm text-gray-500 underline hover:text-gray-800">
            Property details
          </Link>
        </p>
      )}
      {policy.line.category === "health" && (
        <p className="mt-2">
          <Link href={`/policies/${policy.id}/health`} className="text-sm text-gray-500 underline hover:text-gray-800">
            Health details
          </Link>
        </p>
      )}

      {lockedByOther && lockStatus.locked && (
        <div className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p>
            Currently being edited by {lockStatus.holderName}, since {lockStatus.lockedAt.toLocaleString()}.
            Read-only until they save or the lock expires.
          </p>
          {(session.user.role === "manager" || session.user.role === "head") && (
            <form action={forceReleaseAction} className="mt-2">
              <button type="submit" className="text-xs font-medium text-amber-900 underline hover:text-amber-950">
                Force-release lock
              </button>
            </form>
          )}
        </div>
      )}

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {policy.status === "draft" ? (
        <>
          <form
            action={updatePolicyAction}
            inert={lockedByOther}
            className={`mt-8 space-y-4 ${lockedByOther ? "opacity-50" : ""}`}
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Insurance line</label>
                <select
                  key={policy.lineId}
                  name="lineId"
                  required
                  defaultValue={policy.lineId}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
                >
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
                  key={policy.productId}
                  name="productId"
                  required
                  defaultValue={policy.productId}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
                >
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
                  defaultValue={policy.premium}
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
                  defaultValue={policy.commission ?? ""}
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
                  defaultValue={toDateInputValue(policy.startDate)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Renewal date</label>
                <input
                  name="renewalDate"
                  type="date"
                  required
                  defaultValue={toDateInputValue(policy.renewalDate)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
                />
              </div>
            </div>
            <button
              type="submit"
              className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Save changes
            </button>
          </form>

          <form action={activatePolicyAction} inert={lockedByOther} className="mt-4">
            <button
              type="submit"
              disabled={!policy.proofOfPaymentDocId}
              className="w-full rounded-md bg-green-700 px-3 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Activate policy
            </button>
            {!policy.proofOfPaymentDocId && (
              <p className="mt-1 text-xs text-gray-400">Upload a Proof of Payment document below first.</p>
            )}
          </form>
        </>
      ) : (
        <dl className="mt-8 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-gray-500">Premium</dt>
          <dd className="text-gray-800">₱{policy.premium.toLocaleString()}</dd>
          <dt className="text-gray-500">Commission</dt>
          <dd className="text-gray-800">{policy.commission ? `₱${policy.commission.toLocaleString()}` : "—"}</dd>
          <dt className="text-gray-500">Start date</dt>
          <dd className="text-gray-800">{policy.startDate.toLocaleDateString()}</dd>
          <dt className="text-gray-500">Renewal date</dt>
          <dd className="text-gray-800">{policy.renewalDate.toLocaleDateString()}</dd>
        </dl>
      )}

      {canRenew && (
        <form
          action={renewalPaymentAction}
          inert={lockedByOther}
          className={`mt-8 space-y-3 rounded-md border border-gray-200 p-4 ${lockedByOther ? "opacity-50" : ""}`}
        >
          <h2 className="text-sm font-medium text-gray-700">Record Renewal / Payment</h2>
          <p className="text-xs text-gray-400">
            Upload the new Proof of Payment to reactivate this policy — required every time, whether it&apos;s
            a same-day non-life renewal or a payment collected near the end of a grace period.
          </p>
          <input
            name="document"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            required
            className="block w-full text-sm text-gray-700"
          />
          <button
            type="submit"
            className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Renew policy
          </button>
        </form>
      )}

      <div className="mt-8">
        <h2 className="text-sm font-medium text-gray-700">Documents</h2>
        <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
          {documents.map((document) => (
            <li key={document.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <a
                href={`/api/documents/${document.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-gray-800 hover:underline"
              >
                {DOC_TYPE_LABELS[document.type] ?? document.type}
              </a>
              <span className="text-xs text-gray-400">
                {(document.fileSizeBytes / 1024).toFixed(0)} KB · {document.uploadedAt.toLocaleDateString()}
              </span>
            </li>
          ))}
          {documents.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">No documents yet.</li>}
        </ul>

        <form
          action={uploadDocumentAction}
          inert={lockedByOther}
          className={`mt-3 space-y-3 ${lockedByOther ? "opacity-50" : ""}`}
        >
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700">Document type</label>
              <select
                name="docType"
                required
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
              >
                <option value="proof_of_payment">Proof of Payment</option>
                <option value="valid_id">Valid ID</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">File (PDF, JPG, or PNG — max 5MB)</label>
              <input
                name="document"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                required
                className="mt-1 block w-full text-sm text-gray-700"
              />
            </div>
          </div>
          <button
            type="submit"
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
          >
            Upload document
          </button>
        </form>
      </div>
    </div>
  );
}
