import { getScopedPrisma } from "@/lib/tenant-db";

// Agency Head configures their agency's insurance lines/products (Section
// 10 phase 6 / Section 4). category is the fixed set the app's logic keys
// off of; name is the agency's own free-text label for it.
const VALID_CATEGORIES = ["life", "auto", "property", "health", "travel", "other"] as const;
const VALID_LIFE_POLICY_TYPES = ["term", "non_term_traditional", "vul"] as const;

type ActionResult = { ok: true } | { ok: false; error: string };

export async function listInsuranceLines(agencyId: string) {
  return getScopedPrisma(agencyId).insuranceLine.findMany({
    orderBy: { createdAt: "asc" },
    include: { products: { orderBy: { createdAt: "asc" } } },
  });
}

export async function createInsuranceLine(agencyId: string, name: string, category: string): Promise<ActionResult> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { ok: false, error: "Line name is required." };
  }
  if (!VALID_CATEGORIES.includes(category as (typeof VALID_CATEGORIES)[number])) {
    return { ok: false, error: "Choose a valid category." };
  }

  await getScopedPrisma(agencyId).insuranceLine.create({
    // agencyId here is redundant at runtime (the scoping extension always
    // overwrites it with this same value regardless of what's passed —
    // see tenant-db.ts) but Prisma's generated CreateInput type doesn't
    // know that and requires it, so it's included to satisfy the type.
    data: { agencyId, name: trimmedName, category },
  });

  return { ok: true };
}

// Found in a full-app review: there was previously no in-app way to fix a
// typo'd line/product name at all — only "add", never "edit". Deliberately
// rename-only, not category-editable: category drives which detail tables,
// forms, and lapsing rules apply (Section 4/6), so changing it out from
// under a line that may already have products/policies attached risks
// silently orphaning that existing data's category-specific tables. A
// mis-picked category is meant to be fixed by creating a fresh line, not
// edited in place — this only covers the always-safe free-text rename.
export async function renameInsuranceLine(agencyId: string, lineId: string, name: string): Promise<ActionResult> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { ok: false, error: "Line name is required." };
  }
  const scoped = getScopedPrisma(agencyId);
  const line = await scoped.insuranceLine.findUnique({ where: { id: lineId } });
  if (!line) {
    return { ok: false, error: "That insurance line doesn't exist." };
  }
  await scoped.insuranceLine.update({ where: { id: lineId }, data: { name: trimmedName } });
  return { ok: true };
}

// Deletion is blocked rather than cascaded — a line/product that already
// has leads or policies pointing at it is real sales data, not something
// safe to silently orphan or wipe out from an "Insurance Lines" screen.
// Same "surface it, don't cascade" call as setAgencyUserActive's
// open-leads/policies warning in agency-users.ts, except here it's a hard
// block rather than a warning, since there's no reassignment target for a
// deleted line/product the way there is for a deactivated user.
export async function deleteInsuranceLine(agencyId: string, actorId: string, lineId: string): Promise<ActionResult> {
  const scoped = getScopedPrisma(agencyId);
  const line = await scoped.insuranceLine.findUnique({ where: { id: lineId } });
  if (!line) {
    return { ok: false, error: "That insurance line doesn't exist." };
  }

  const [productCount, leadCount, policyCount] = await Promise.all([
    scoped.product.count({ where: { lineId } }),
    scoped.lead.count({ where: { lineId } }),
    scoped.policy.count({ where: { lineId } }),
  ]);
  if (productCount > 0) {
    return {
      ok: false,
      error: `Can't delete "${line.name}" — delete its ${productCount} product${productCount === 1 ? "" : "s"} first.`,
    };
  }
  if (leadCount > 0 || policyCount > 0) {
    const parts = [];
    if (leadCount > 0) parts.push(`${leadCount} lead${leadCount === 1 ? "" : "s"}`);
    if (policyCount > 0) parts.push(`${policyCount} polic${policyCount === 1 ? "y" : "ies"}`);
    return { ok: false, error: `Can't delete "${line.name}" — ${parts.join(" and ")} still reference it.` };
  }

  // Logged before the delete, same reasoning as leads.ts's deleteLead —
  // ActivityLog has no lineId column to safely reference afterward, and the
  // delete itself needs to be in the audit trail.
  await scoped.activityLog.create({
    data: { userId: actorId, action: "insurance_line_deleted", note: `"${line.name}" (${line.category}) deleted` },
  });
  await scoped.insuranceLine.delete({ where: { id: lineId } });
  return { ok: true };
}

export async function deleteProduct(agencyId: string, actorId: string, productId: string): Promise<ActionResult> {
  const scoped = getScopedPrisma(agencyId);
  const product = await scoped.product.findUnique({ where: { id: productId } });
  if (!product) {
    return { ok: false, error: "That product doesn't exist." };
  }

  const [leadCount, policyCount] = await Promise.all([
    scoped.lead.count({ where: { productId } }),
    scoped.policy.count({ where: { productId } }),
  ]);
  if (leadCount > 0 || policyCount > 0) {
    const parts = [];
    if (leadCount > 0) parts.push(`${leadCount} lead${leadCount === 1 ? "" : "s"}`);
    if (policyCount > 0) parts.push(`${policyCount} polic${policyCount === 1 ? "y" : "ies"}`);
    return { ok: false, error: `Can't delete "${product.name}" — ${parts.join(" and ")} still reference it.` };
  }

  await scoped.activityLog.create({
    data: { userId: actorId, action: "product_deleted", note: `"${product.name}" deleted` },
  });
  await scoped.product.delete({ where: { id: productId } });
  return { ok: true };
}

export async function updateProduct(
  agencyId: string,
  productId: string,
  name: string,
  description: string,
  lifePolicyType: string
): Promise<ActionResult> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { ok: false, error: "Product name is required." };
  }
  const scoped = getScopedPrisma(agencyId);
  // findUnique here is safe even though it's normally the "unverified"
  // single-record op tenant-db.ts warns about — getScopedPrisma still
  // verifies ownership on it, and `include: { line: true }` is needed to
  // know the same category rule createProduct applies (life-only field).
  const product = await scoped.product.findUnique({ where: { id: productId }, include: { line: true } });
  if (!product) {
    return { ok: false, error: "That product doesn't exist." };
  }

  const trimmedLifePolicyType = lifePolicyType.trim();
  if (trimmedLifePolicyType && !VALID_LIFE_POLICY_TYPES.includes(trimmedLifePolicyType as (typeof VALID_LIFE_POLICY_TYPES)[number])) {
    return { ok: false, error: "Choose a valid life policy type." };
  }
  const lifePolicyTypeToStore = product.line.category === "life" && trimmedLifePolicyType ? trimmedLifePolicyType : null;

  await scoped.product.update({
    where: { id: productId },
    data: { name: trimmedName, description: description.trim() || null, lifePolicyType: lifePolicyTypeToStore },
  });
  return { ok: true };
}

export async function createProduct(
  agencyId: string,
  lineId: string,
  name: string,
  description: string,
  lifePolicyType: string
): Promise<ActionResult> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { ok: false, error: "Product name is required." };
  }

  const scoped = getScopedPrisma(agencyId);
  // findUnique here is safe even though it's normally the "unverified"
  // single-record op tenant-db.ts warns about — getScopedPrisma still
  // verifies ownership on it (see that file's own comment), so a lineId
  // from another agency correctly comes back null, not another agency's row.
  const line = await scoped.insuranceLine.findUnique({ where: { id: lineId } });
  if (!line) {
    return { ok: false, error: "That insurance line doesn't exist." };
  }

  const trimmedLifePolicyType = lifePolicyType.trim();
  if (trimmedLifePolicyType && !VALID_LIFE_POLICY_TYPES.includes(trimmedLifePolicyType as (typeof VALID_LIFE_POLICY_TYPES)[number])) {
    return { ok: false, error: "Choose a valid life policy type." };
  }
  // Only meaningful for category = "life" (Section 6) — silently drop it
  // for any other category rather than erroring, since the form doesn't
  // even show the field for non-life lines.
  const lifePolicyTypeToStore = line.category === "life" && trimmedLifePolicyType ? trimmedLifePolicyType : null;

  await scoped.product.create({
    // agencyId redundant at runtime, same reasoning as createInsuranceLine.
    data: {
      agencyId,
      lineId,
      name: trimmedName,
      description: description.trim() || null,
      lifePolicyType: lifePolicyTypeToStore,
    },
  });

  return { ok: true };
}
