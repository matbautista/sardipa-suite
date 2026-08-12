import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireHeadSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getScopedPrisma } from "@/lib/tenant-db";
import { THEME_LIST, setAgencyTheme } from "@/lib/themes";
import {
  getEmailIntakeConfig,
  saveEmailIntakeConfig,
  pollMailboxForAgency,
  getActiveEmailIntakeAlert,
  type EmailIntakeConfigInput,
} from "@/lib/email-intake";
import {
  listInsuranceLines,
  createInsuranceLine,
  createProduct,
  renameInsuranceLine,
  updateProduct,
  deleteInsuranceLine,
  deleteProduct,
} from "@/lib/insurance-lines";
import { listAgencyUsers } from "@/lib/agency-users";
import { listAgencyActivityLog } from "@/lib/activity-log";
import { ACTIVITY_ACTION_LABELS } from "@/lib/status-labels";
import { Tabs } from "@/components/tabs";
import { toggleActiveAction, reassignManagerAction } from "../users/actions";
import { CreateManagerForm } from "../users/create-manager-form";
import { CreateAgentForm } from "../users/create-agent-form";
import { ResetPasswordButton } from "../users/reset-password-button";

// Every Agency Head-only, agency-scoped setting lives here as one tab each,
// instead of each getting its own top-level menu entry: Insurance Lines &
// Products, Managers & Agents, Website Inquiry Intake, Activity Log, and
// Theme. Every mutating action below redirects back with `?tab=<key>` so
// the Head lands back on the tab they were using, not the first one —
// see components/tabs.tsx's `initialKey`.

const CATEGORIES = ["life", "auto", "property", "health", "travel", "other"] as const;
const LIFE_POLICY_TYPES = ["term", "non_term_traditional", "vul"] as const;

const CATEGORY_LABELS: Record<string, string> = {
  life: "Life",
  auto: "Auto",
  property: "Property",
  health: "Health",
  travel: "Travel",
  other: "Other",
};

async function updateThemeAction(formData: FormData) {
  "use server";
  const session = await requireHeadSession();
  const theme = String(formData.get("theme") ?? "");

  const result = await setAgencyTheme(session.user.agencyId, theme);
  if (!result.ok) {
    redirect(`/agency/settings?tab=theme&error=${encodeURIComponent(result.error)}`);
  }
  // Found live: without this, the new theme sits in the DB correctly but
  // doesn't visibly apply until a hard reload — the root layout reads
  // agency.theme once per render, and Next's client-side Router Cache
  // otherwise keeps serving that same render across this action's own
  // redirect, since the URL's route segments haven't changed. "layout"
  // (not the default "page") is required here specifically because the
  // theme is read in src/app/layout.tsx, above every route, not in this
  // page itself.
  revalidatePath("/", "layout");
  redirect(`/agency/settings?tab=theme&success=${encodeURIComponent("Theme updated.")}`);
}

async function saveEmailIntakeConfigAction(formData: FormData) {
  "use server";
  const session = await requireHeadSession();

  const input: EmailIntakeConfigInput = {
    imapHost: String(formData.get("imapHost") ?? ""),
    imapPort: Number(formData.get("imapPort") ?? 0),
    username: String(formData.get("username") ?? ""),
    password: String(formData.get("password") ?? ""),
    folder: String(formData.get("folder") ?? ""),
    useSsl: formData.get("useSsl") === "on",
    isEnabled: formData.get("isEnabled") === "on",
  };

  const result = await saveEmailIntakeConfig(session.user.agencyId, input);
  if (!result.ok) {
    redirect(`/agency/settings?tab=email-intake&error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/agency/settings?tab=email-intake&success=${encodeURIComponent("Settings saved.")}`);
}

async function pollNowAction() {
  "use server";
  const session = await requireHeadSession();
  await pollMailboxForAgency(session.user.agencyId);
  redirect(`/agency/settings?tab=email-intake&success=${encodeURIComponent("Poll complete — see status below.")}`);
}

async function createLineAction(formData: FormData) {
  "use server";
  const session = await requireHeadSession();
  const name = String(formData.get("name") ?? "");
  const category = String(formData.get("category") ?? "");

  const result = await createInsuranceLine(session.user.agencyId, name, category);
  if (!result.ok) {
    redirect(`/agency/settings?tab=lines&error=${encodeURIComponent(result.error)}`);
  }
  redirect("/agency/settings?tab=lines");
}

async function renameLineAction(formData: FormData) {
  "use server";
  const session = await requireHeadSession();
  const lineId = String(formData.get("lineId") ?? "");
  const name = String(formData.get("name") ?? "");

  const result = await renameInsuranceLine(session.user.agencyId, lineId, name);
  if (!result.ok) {
    // Sends the Head back to the same edit panel (not just the bare list)
    // so a validation error doesn't silently drop their in-progress edit.
    redirect(`/agency/settings?tab=lines&editLineId=${lineId}&error=${encodeURIComponent(result.error)}`);
  }
  redirect("/agency/settings?tab=lines");
}

async function updateProductAction(formData: FormData) {
  "use server";
  const session = await requireHeadSession();
  const productId = String(formData.get("productId") ?? "");
  const name = String(formData.get("name") ?? "");
  const description = String(formData.get("description") ?? "");
  const lifePolicyType = String(formData.get("lifePolicyType") ?? "");

  const result = await updateProduct(session.user.agencyId, productId, name, description, lifePolicyType);
  if (!result.ok) {
    redirect(`/agency/settings?tab=lines&editProductId=${productId}&error=${encodeURIComponent(result.error)}`);
  }
  redirect("/agency/settings?tab=lines");
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
    redirect(`/agency/settings?tab=lines&error=${encodeURIComponent(result.error)}`);
  }
  redirect("/agency/settings?tab=lines");
}

async function deleteLineAction(formData: FormData) {
  "use server";
  const session = await requireHeadSession();
  const lineId = String(formData.get("lineId") ?? "");

  const result = await deleteInsuranceLine(session.user.agencyId, session.user.id, lineId);
  if (!result.ok) {
    redirect(`/agency/settings?tab=lines&error=${encodeURIComponent(result.error)}`);
  }
  redirect("/agency/settings?tab=lines");
}

async function deleteProductAction(formData: FormData) {
  "use server";
  const session = await requireHeadSession();
  const productId = String(formData.get("productId") ?? "");

  const result = await deleteProduct(session.user.agencyId, session.user.id, productId);
  if (!result.ok) {
    redirect(`/agency/settings?tab=lines&error=${encodeURIComponent(result.error)}`);
  }
  redirect("/agency/settings?tab=lines");
}

export default async function AgencySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    error?: string;
    success?: string;
    warning?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
    recordType?: string;
    recordId?: string;
    editLineId?: string;
    editProductId?: string;
    editAgentId?: string;
  }>;
}) {
  const session = await requireHeadSession();
  const {
    tab,
    error,
    success,
    warning,
    userId,
    startDate,
    endDate,
    recordType,
    recordId,
    editLineId,
    editProductId,
    editAgentId,
  } = await searchParams;

  const scoped = getScopedPrisma(session.user.agencyId);
  const [agency, emailIntakeConfig, emailIntakeAlert, lines, { managers, agents }, activityEntries, activityUsers, systemActor] =
    await Promise.all([
      // Agency isn't in tenant-db.ts's TENANT_SCOPED_MODELS (it's the tenant
      // root, not a row scoped to one) — same reason system-config.ts and
      // src/lib/themes.ts's own write go through the plain client, not
      // getScopedPrisma.
      prisma.agency.findUniqueOrThrow({ where: { id: session.user.agencyId }, select: { theme: true } }),
      getEmailIntakeConfig(session.user.agencyId),
      getActiveEmailIntakeAlert(session.user.agencyId),
      listInsuranceLines(session.user.agencyId),
      listAgencyUsers(session.user.agencyId),
      listAgencyActivityLog(session.user.agencyId, {
        userId: userId || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        recordType: recordType === "lead" || recordType === "policy" ? recordType : undefined,
        recordId: recordId || undefined,
      }),
      scoped.user.findMany({ orderBy: { name: "asc" } }),
      // The renewal job's automated ActivityLog entries (renewal-job.ts) are
      // attributed to a reserved "system" User row that, like Super Admin,
      // sits outside every agency (agencyId: null) — so the tenant-scoped
      // findMany above can never return it, even though its entries do show
      // up unfiltered in this agency's log below. Fetched separately (via
      // the unscoped client — there's nothing tenant-specific to leak, it's
      // one fixed, host-wide row) so the User filter can actually reach them.
      prisma.user.findFirst({ where: { role: "system" } }),
    ]);
  const activityFilterUsers = systemActor ? [...activityUsers, systemActor] : activityUsers;

  const linesByCategory = new Map<string, typeof lines>();
  for (const line of lines) {
    const forCategory = linesByCategory.get(line.category) ?? [];
    forCategory.push(line);
    linesByCategory.set(line.category, forCategory);
  }

  // One shared edit panel per record type, driven by the URL (?editLineId=
  // / ?editProductId=), instead of a collapsible edit form rendered inline
  // for every single line/product — at a few hundred products that meant a
  // few hundred forms shipped in the HTML whether expanded or not. Same
  // "?edit=1" convention leads/[id] and policies/[id] already use for
  // single-record edit mode.
  const editingLine = editLineId ? (lines.find((l) => l.id === editLineId) ?? null) : null;
  const editingProduct = editProductId
    ? (lines.flatMap((l) => l.products.map((p) => ({ ...p, line: l }))).find((p) => p.id === editProductId) ?? null)
    : null;
  // Whichever category the record being edited belongs to — so following an
  // Edit link also switches the Life/Auto/... sub-tab to match, rather than
  // silently landing the edit panel on a category tab that isn't showing.
  const editingCategory = editingLine?.category ?? editingProduct?.line.category;

  // Agents grouped under their manager — same "nest the children under
  // their parent's card" presentation as products under their line, instead
  // of a flat list with a manager-picker on every row.
  const agentsByManagerId = new Map<string, typeof agents>();
  const unassignedAgents: typeof agents = [];
  for (const agent of agents) {
    if (!agent.managerId) {
      unassignedAgents.push(agent);
      continue;
    }
    const forManager = agentsByManagerId.get(agent.managerId) ?? [];
    forManager.push(agent);
    agentsByManagerId.set(agent.managerId, forManager);
  }
  const editingAgent = editAgentId ? (agents.find((a) => a.id === editAgentId) ?? null) : null;

  function renderReassignPanel(agent: (typeof agents)[number]) {
    return (
      <div className="mt-2 rounded-md border border-gray-300 bg-gray-50 p-4">
        <h4 className="text-sm font-medium text-gray-700">Reassign &quot;{agent.name}&quot;</h4>
        <form action={reassignManagerAction} className="mt-2 flex items-center gap-2">
          <input type="hidden" name="agentUserId" value={agent.id} />
          <select
            name="managerId"
            defaultValue={agent.managerId ?? ""}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
          >
            <option value="">— unassigned —</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.name}
              </option>
            ))}
          </select>
          <button type="submit" className="inline-block min-w-[110px] rounded-md btn-primary px-2.5 py-1 text-center text-xs font-medium">
            Save
          </button>
          <Link href="/agency/settings?tab=users" className="text-xs text-gray-500 underline hover:text-gray-800">
            Cancel
          </Link>
        </form>
      </div>
    );
  }

  function renderAgentRow(agent: (typeof agents)[number]) {
    return (
      <li key={agent.id} className="flex items-center justify-between gap-4 py-2 text-sm text-gray-700">
        <span>
          {agent.name}
          <span className="ml-2 text-gray-400">{agent.email}</span>
          <span
            className={
              agent.isActive
                ? "ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700"
                : "ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500"
            }
          >
            {agent.isActive ? "active" : "deactivated"}
          </span>
        </span>
        <div className="flex items-center gap-2">
          <Link
            href={`/agency/settings?tab=users&editAgentId=${agent.id}`}
            className="inline-block min-w-[110px] rounded-md btn-primary px-2.5 py-1 text-center text-xs font-medium"
          >
            Reassign
          </Link>
          <ResetPasswordButton userId={agent.id} />
          <form action={toggleActiveAction}>
            <input type="hidden" name="targetUserId" value={agent.id} />
            <input type="hidden" name="nextActive" value={(!agent.isActive).toString()} />
            <button
              type="submit"
              className={
                agent.isActive
                  ? "inline-block min-w-[110px] rounded-md bg-red-600 px-2.5 py-1 text-center text-xs font-medium text-white hover:bg-red-700"
                  : "inline-block min-w-[110px] rounded-md btn-primary px-2.5 py-1 text-center text-xs font-medium"
              }
            >
              {agent.isActive ? "Deactivate" : "Reactivate"}
            </button>
          </form>
        </div>
      </li>
    );
  }
  // Tabbed by category (Life / Auto / ...) rather than every line in one
  // long list — CATEGORIES order keeps tab order stable, and only
  // categories the agency actually has a line in get a tab, so a line of
  // any category (not just Life/Auto) is never hidden.
  const categoryTabs = CATEGORIES.filter((category) => linesByCategory.has(category)).map((category) => ({
    key: category,
    label: CATEGORY_LABELS[category] ?? category,
    content: (
      <div className="space-y-6">
        {editingLine && editingLine.category === category && (
          <div className="rounded-md border border-gray-300 bg-gray-50 p-4">
            <h3 className="text-sm font-medium text-gray-700">Rename &quot;{editingLine.name}&quot;</h3>
            <form action={renameLineAction} className="mt-2 flex flex-wrap items-center gap-2">
              <input type="hidden" name="lineId" value={editingLine.id} />
              <input
                name="name"
                type="text"
                required
                defaultValue={editingLine.name}
                className="min-w-[8rem] flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
              />
              <button type="submit" className="shrink-0 inline-block min-w-[110px] rounded-md btn-primary px-2.5 py-1 text-center text-xs font-medium">
                Save
              </button>
              <Link href="/agency/settings?tab=lines" className="text-xs text-gray-500 underline hover:text-gray-800">
                Cancel
              </Link>
            </form>
            <p className="mt-1 text-xs text-gray-400">
              Category ({editingLine.category}) can&apos;t be changed here — it drives which forms and rules
              apply to every product already under this line. Create a new line instead if it was mis-picked.
            </p>
          </div>
        )}
        {(linesByCategory.get(category) ?? []).map((line) => (
          <div key={line.id} className="rounded-md border border-gray-200 p-4">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-base font-semibold text-gray-900">{line.name}</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{line.category}</span>
                <Link
                  href={`/agency/settings?tab=lines&editLineId=${line.id}`}
                  className="inline-block min-w-[110px] rounded-md btn-primary px-2.5 py-1 text-center text-xs font-medium"
                >
                  Rename
                </Link>
                <form action={deleteLineAction}>
                  <input type="hidden" name="lineId" value={line.id} />
                  <button
                    type="submit"
                    className="inline-block min-w-[110px] rounded-md bg-red-600 px-2.5 py-1 text-center text-xs font-medium text-white hover:bg-red-700"
                  >
                    Delete
                  </button>
                </form>
              </div>
            </div>

            {/* Indented and left-bordered so the products visibly nest
                under their line instead of reading as the same level. */}
            <div className="mt-3 border-l-2 border-gray-100 pl-4">
              <h3 className="text-xs font-medium tracking-wide text-gray-400 uppercase">Products</h3>

              {editingProduct && editingProduct.line.id === line.id && (
                <div className="mt-2 rounded-md border border-gray-300 bg-gray-50 p-4">
                  <h4 className="text-sm font-medium text-gray-700">Edit &quot;{editingProduct.name}&quot;</h4>
                  <form action={updateProductAction} className="mt-2 space-y-2">
                    <input type="hidden" name="productId" value={editingProduct.id} />
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        name="name"
                        type="text"
                        required
                        defaultValue={editingProduct.name}
                        className="min-w-[8rem] flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
                      />
                      <input
                        name="description"
                        type="text"
                        placeholder="Description (optional)"
                        defaultValue={editingProduct.description ?? ""}
                        className="min-w-[8rem] flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
                      />
                      {line.category === "life" && (
                        <select
                          name="lifePolicyType"
                          defaultValue={editingProduct.lifePolicyType ?? ""}
                          className="min-w-[8rem] flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
                        >
                          <option value="">— life policy type —</option>
                          {LIFE_POLICY_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="submit" className="inline-block min-w-[110px] rounded-md btn-primary px-2.5 py-1 text-center text-xs font-medium">
                        Save
                      </button>
                      <Link
                        href="/agency/settings?tab=lines"
                        className="text-xs text-gray-500 underline hover:text-gray-800"
                      >
                        Cancel
                      </Link>
                    </div>
                  </form>
                </div>
              )}

              <ul className="mt-2 divide-y divide-gray-100">
                {line.products.map((product) => (
                  <li key={product.id} className="flex items-center justify-between gap-4 py-2 text-sm text-gray-700">
                    <span>
                      {product.name}
                      {product.lifePolicyType && (
                        <span className="ml-2 text-xs text-gray-400">({product.lifePolicyType})</span>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/agency/settings?tab=lines&editProductId=${product.id}`}
                        className="inline-block min-w-[110px] rounded-md btn-primary px-2.5 py-1 text-center text-xs font-medium"
                      >
                        Edit
                      </Link>
                      <form action={deleteProductAction}>
                        <input type="hidden" name="productId" value={product.id} />
                        <button
                          type="submit"
                          className="inline-block min-w-[110px] rounded-md bg-red-600 px-2.5 py-1 text-center text-xs font-medium text-white hover:bg-red-700"
                        >
                          Delete
                        </button>
                      </form>
                    </div>
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
                <div className="mt-3 rounded-md border border-gray-200 p-4">
                  <form action={createProductAction} className="space-y-3">
                    <input type="hidden" name="lineId" value={line.id} />
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="min-w-[10rem] flex-1">
                        <label className="block text-xs font-medium text-gray-700">Product name</label>
                        <input
                          name="name"
                          type="text"
                          required
                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
                        />
                      </div>
                      <div className="min-w-[10rem] flex-1">
                        <label className="block text-xs font-medium text-gray-700">Description (optional)</label>
                        <input
                          name="description"
                          type="text"
                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
                        />
                      </div>
                      {line.category === "life" && (
                        <div className="min-w-[10rem] flex-1">
                          <label className="block text-xs font-medium text-gray-700">Life policy type</label>
                          <select
                            name="lifePolicyType"
                            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
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
                    </div>
                    {line.category === "life" && (
                      <p className="text-xs text-gray-400">Life policy type drives the renewal/lapsing rule (Section 5).</p>
                    )}
                    <button type="submit" className="inline-block min-w-[110px] rounded-md btn-primary px-2.5 py-1 text-center text-xs font-medium">
                      Add product
                    </button>
                  </form>
                </div>
              </details>
            </div>
          </div>
        ))}
      </div>
    ),
  }));

  const tabs = [
    {
      key: "lines",
      label: "Insurance Lines & Products",
      content: (
        <>
          {categoryTabs.length > 0 ? (
            <Tabs tabs={categoryTabs} initialKey={editingCategory} />
          ) : (
            <p className="text-sm text-gray-400">No insurance lines yet — add one below.</p>
          )}

          <div className="mt-8">
            <h3 className="text-sm font-medium text-gray-700">Add a new insurance line</h3>
            <div className="mt-3 rounded-md border border-gray-200 p-4">
              <form action={createLineAction} className="space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[10rem] flex-1">
                    <label className="block text-sm font-medium text-gray-700">Name</label>
                    <input
                      name="name"
                      type="text"
                      required
                      placeholder='e.g. "Life" or "Family Protection Plan"'
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
                    />
                  </div>
                  <div className="min-w-[10rem] flex-1">
                    <label className="block text-sm font-medium text-gray-700">Category</label>
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
                </div>
                <p className="text-xs text-gray-400">
                  Category is the fixed set the app&apos;s logic keys off of — forms, required documents, and
                  renewal rules are wired to this, not to the name above (Section 4).
                </p>
                <button
                  type="submit"
                  className="inline-block min-w-[170px] rounded-md btn-primary px-4 py-2 text-center text-sm font-medium"
                >
                  Add line
                </button>
              </form>
            </div>
          </div>
        </>
      ),
    },
    {
      key: "users",
      label: "Managers & Agents",
      content: (
        <div className="space-y-6">
          {managers.map((manager) => (
            <div key={manager.id} className="rounded-md border border-gray-200 p-4">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-base font-semibold text-gray-900">{manager.name}</h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{manager.email}</span>
                  <span
                    className={
                      manager.isActive
                        ? "rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700"
                        : "rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500"
                    }
                  >
                    {manager.isActive ? "active" : "deactivated"}
                  </span>
                  <ResetPasswordButton userId={manager.id} />
                  <form action={toggleActiveAction}>
                    <input type="hidden" name="targetUserId" value={manager.id} />
                    <input type="hidden" name="nextActive" value={(!manager.isActive).toString()} />
                    <button
                      type="submit"
                      className={
                        manager.isActive
                          ? "inline-block min-w-[110px] rounded-md bg-red-600 px-2.5 py-1 text-center text-xs font-medium text-white hover:bg-red-700"
                          : "inline-block min-w-[110px] rounded-md btn-primary px-2.5 py-1 text-center text-xs font-medium"
                      }
                    >
                      {manager.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </form>
                </div>
              </div>

              {/* Indented and left-bordered so agents visibly nest under
                  their manager, same presentation as products under their
                  insurance line. */}
              <div className="mt-3 border-l-2 border-gray-100 pl-4">
                <h3 className="text-xs font-medium tracking-wide text-gray-400 uppercase">Agents</h3>

                {editingAgent && editingAgent.managerId === manager.id && renderReassignPanel(editingAgent)}

                <ul className="mt-2 divide-y divide-gray-100">
                  {(agentsByManagerId.get(manager.id) ?? []).map((agent) => renderAgentRow(agent))}
                  {(agentsByManagerId.get(manager.id) ?? []).length === 0 && (
                    <li className="py-2 text-sm text-gray-400">No agents yet.</li>
                  )}
                </ul>

                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-800">
                    Add an agent to {manager.name}
                  </summary>
                  <div className="mt-3 rounded-md border border-gray-200 p-4">
                    <CreateAgentForm managerId={manager.id} />
                  </div>
                </details>
              </div>
            </div>
          ))}
          {managers.length === 0 && <p className="text-sm text-gray-400">No managers yet.</p>}

          <div className="rounded-md border border-gray-200 p-4">
            <h2 className="text-base font-semibold text-gray-900">Unassigned</h2>
            <div className="mt-3 border-l-2 border-gray-100 pl-4">
              <h3 className="text-xs font-medium tracking-wide text-gray-400 uppercase">Agents</h3>

              {editingAgent && !editingAgent.managerId && renderReassignPanel(editingAgent)}

              <ul className="mt-2 divide-y divide-gray-100">
                {unassignedAgents.map((agent) => renderAgentRow(agent))}
                {unassignedAgents.length === 0 && (
                  <li className="py-2 text-sm text-gray-400">No unassigned agents.</li>
                )}
              </ul>

              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-800">
                  Add an unassigned agent
                </summary>
                <div className="mt-3 rounded-md border border-gray-200 p-4">
                  <CreateAgentForm managerId={null} />
                </div>
              </details>
            </div>
          </div>

          <div className="mt-8">
            <h3 className="text-sm font-medium text-gray-700">Add a manager</h3>
            <div className="mt-3 rounded-md border border-gray-200 p-4">
              <CreateManagerForm />
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "email-intake",
      label: "Website Inquiry Intake",
      content: (
        <>
          <p className="text-sm text-gray-500">
            The CRM polls this inbox every 5 minutes over IMAP and turns structured inquiry emails into
            unassigned Leads (Section 5). An email that doesn&apos;t match the expected format still becomes
            a Lead, flagged for review, so nothing from the public site is ever silently dropped.
          </p>

          {emailIntakeAlert && (
            <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              Can&apos;t check this inbox for new inquiries — connection failed since{" "}
              {emailIntakeAlert.createdAt.toLocaleString()}. It will keep retrying on the normal schedule;
              emails aren&apos;t lost, they just wait until it&apos;s reachable again.
            </p>
          )}

          {emailIntakeConfig && (
            <div className="mt-4 rounded-md border border-gray-200 p-4 text-sm">
              <h3 className="text-sm font-medium text-gray-700">Current status</h3>
              <dl className="mt-2 space-y-1 text-gray-600">
                <div className="flex justify-between">
                  <dt>Enabled</dt>
                  <dd>{emailIntakeConfig.isEnabled ? "Yes" : "No"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Last polled</dt>
                  <dd>{emailIntakeConfig.lastPolledAt ? emailIntakeConfig.lastPolledAt.toLocaleString() : "Never"}</dd>
                </div>
                {emailIntakeConfig.lastErrorMessage && (
                  <div className="flex justify-between gap-4">
                    <dt>Last error</dt>
                    <dd className="text-right text-red-600">{emailIntakeConfig.lastErrorMessage}</dd>
                  </div>
                )}
              </dl>
              <form action={pollNowAction} className="mt-3">
                <button type="submit" className="inline-block min-w-[110px] rounded-md btn-primary px-2.5 py-1 text-center text-xs font-medium">
                  Poll now
                </button>
              </form>
            </div>
          )}

          <form action={saveEmailIntakeConfigAction} className="mt-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">IMAP host</label>
              <input
                name="imapHost"
                type="text"
                required
                defaultValue={emailIntakeConfig?.imapHost ?? "imap.gmail.com"}
                className="mt-1 block w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Port</label>
              <input
                name="imapPort"
                type="number"
                required
                defaultValue={emailIntakeConfig?.imapPort ?? 993}
                className="mt-1 block w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Username</label>
              <input
                name="username"
                type="text"
                required
                defaultValue={emailIntakeConfig?.username ?? ""}
                placeholder="inquiries@youragency.com"
                className="mt-1 block w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                {emailIntakeConfig ? "Password (leave blank to keep the current one)" : "Password"}
              </label>
              <p className="text-xs text-gray-400">
                For Gmail, this is an App Password generated with 2-Step Verification on, not the normal
                account password. Stored encrypted; never shown again after entry.
              </p>
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                className="mt-1 block w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Folder</label>
              <input
                name="folder"
                type="text"
                defaultValue={emailIntakeConfig?.folder ?? "INBOX"}
                className="mt-1 block w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="useSsl"
                name="useSsl"
                type="checkbox"
                defaultChecked={emailIntakeConfig?.useSsl ?? true}
                className="h-4 w-4 rounded border-gray-300"
              />
              <label htmlFor="useSsl" className="text-sm text-gray-700">
                Use SSL/TLS
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="isEnabled"
                name="isEnabled"
                type="checkbox"
                defaultChecked={emailIntakeConfig?.isEnabled ?? true}
                className="h-4 w-4 rounded border-gray-300"
              />
              <label htmlFor="isEnabled" className="text-sm text-gray-700">
                Enabled — poll this mailbox on the regular schedule
              </label>
            </div>
            <button
              type="submit"
              className="inline-block min-w-[170px] rounded-md btn-primary px-4 py-2 text-center text-sm font-medium"
            >
              {emailIntakeConfig ? "Save changes" : "Set up mailbox intake"}
            </button>
          </form>
        </>
      ),
    },
    {
      key: "activity",
      label: "Activity Log",
      content: (
        <>
          <p className="text-sm text-gray-500">
            Every create/update/delete on a Lead, Policy, or Document, every user-management action, and
            every login for this agency.
          </p>

          <form className="mt-4 flex flex-wrap items-end gap-4" method="get">
            <input type="hidden" name="tab" value="activity" />
            <div>
              <label className="block text-xs font-medium text-gray-700">User</label>
              <select
                name="userId"
                defaultValue={userId ?? ""}
                className="mt-1 rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
              >
                <option value="">Everyone</option>
                {activityFilterUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.role})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">From</label>
              <input
                name="startDate"
                type="date"
                defaultValue={startDate ?? ""}
                className="mt-1 rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">To</label>
              <input
                name="endDate"
                type="date"
                defaultValue={endDate ?? ""}
                className="mt-1 rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-gray-500 focus:outline-none"
              />
            </div>
            <button type="submit" className="inline-block min-w-[110px] rounded-md btn-primary px-2.5 py-1 text-center text-xs font-medium">
              Filter
            </button>
            {(userId || startDate || endDate || recordId) && (
              <Link href="/agency/settings?tab=activity" className="text-xs text-gray-500 underline hover:text-gray-800">
                Clear filters
              </Link>
            )}
          </form>

          {recordId && (
            <p className="mt-4 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Showing history for this {recordType} only.{" "}
              <Link href="/agency/settings?tab=activity" className="underline hover:text-gray-900">
                Show everything
              </Link>
            </p>
          )}

          <ul className="mt-4 divide-y divide-gray-200 rounded-md border border-gray-200">
            {activityEntries.map((entry) => (
              <li key={entry.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-800">
                    {ACTIVITY_ACTION_LABELS[entry.action] ?? entry.action}
                  </span>
                  <span className="text-xs text-gray-400">{entry.timestamp.toLocaleString()}</span>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {entry.user.name}
                  {entry.lead && (
                    <>
                      {" · "}
                      <Link href={`/leads/${entry.lead.id}`} className="underline hover:text-gray-800">
                        {entry.lead.name}
                      </Link>
                    </>
                  )}
                  {entry.policy && (
                    <>
                      {" · "}
                      <Link href={`/policies/${entry.policy.id}`} className="underline hover:text-gray-800">
                        policy
                      </Link>
                    </>
                  )}
                  {entry.note && <> · {entry.note}</>}
                </div>
              </li>
            ))}
            {activityEntries.length === 0 && (
              <li className="px-4 py-3 text-sm text-gray-400">No matching activity.</li>
            )}
          </ul>
        </>
      ),
    },
    {
      key: "theme",
      label: "Theme",
      content: (
        <>
          <p className="text-sm text-gray-500">
            Branding for this agency&apos;s whole install — every Agent, Manager, and Head signed in
            here sees the same theme.
          </p>
          <form action={updateThemeAction} className="mt-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {THEME_LIST.map((theme) => (
                <label
                  key={theme.id}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-gray-200 p-3 text-sm has-checked:border-gray-500 has-checked:bg-gray-50"
                >
                  <input
                    type="radio"
                    name="theme"
                    value={theme.id}
                    defaultChecked={agency.theme === theme.id}
                    className="mt-1"
                  />
                  <span>
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-4 w-4 shrink-0 rounded-full border border-gray-300"
                        style={{ background: theme.swatch }}
                      />
                      <span className="font-medium text-gray-800">{theme.label}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-400">{theme.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <button
              type="submit"
              className="mt-6 inline-block min-w-[170px] rounded-md btn-primary px-4 py-2 text-center text-sm font-medium"
            >
              Save theme
            </button>
          </form>
        </>
      ),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Agency Settings</h1>
        <Link href="/dashboard" className="text-sm text-gray-500 underline hover:text-gray-800">
          Back to dashboard
        </Link>
      </div>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {success && <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}
      {warning && <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{warning}</p>}

      <Tabs tabs={tabs} initialKey={tab} />
    </div>
  );
}
