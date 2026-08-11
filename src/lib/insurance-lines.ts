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

export async function updateProduct(
  agencyId: string,
  productId: string,
  name: string,
  description: string
): Promise<ActionResult> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { ok: false, error: "Product name is required." };
  }
  const scoped = getScopedPrisma(agencyId);
  const product = await scoped.product.findUnique({ where: { id: productId } });
  if (!product) {
    return { ok: false, error: "That product doesn't exist." };
  }
  await scoped.product.update({
    where: { id: productId },
    data: { name: trimmedName, description: description.trim() || null },
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
