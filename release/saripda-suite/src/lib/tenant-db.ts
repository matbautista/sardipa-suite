import { prisma } from "@/lib/prisma";

/**
 * Tenant-scoping data-access layer (Section 2 of the plan): "every query
 * scoped by the logged-in user's agency_id, ideally centralized in one
 * data-access layer so it can't be forgotten on a new query."
 *
 * getScopedPrisma(agencyId) returns a Prisma Client where every operation
 * on a tenant-scoped model is automatically confined to that one agency:
 *   - reads/bulk writes (findMany, findFirst, count, updateMany, ...):
 *     agencyId is merged into `where`
 *   - create/createMany: agencyId is force-set on `data`, overriding
 *     anything a caller passed in
 *   - single-record ops keyed by a unique field (findUnique, update,
 *     delete, upsert): agencyId can't be merged into `where` for these
 *     (Prisma requires `where` to be exactly a unique selector), so
 *     ownership is verified against the *base* client before the real
 *     operation runs. A cross-tenant id is treated as not found — it is
 *     never fetched, updated, or deleted.
 *
 * Caveat: this only intercepts top-level `prisma.<model>.*` calls. Nested
 * relation writes (e.g. `prisma.policy.create({ data: { documents: {
 * create: [...] } } })`) do NOT go through this layer for the nested
 * model — always pass agencyId explicitly in nested writes, or make them
 * as separate top-level calls through the scoped client instead.
 *
 * Super Admin has no single agencyId, so it never uses this — it uses the
 * plain `prisma` singleton directly for cross-agency admin work.
 */

const TENANT_SCOPED_MODELS = new Set([
  "User",
  "InsuranceLine",
  "Product",
  "EmailIntakeConfig",
  "Lead",
  "Policy",
  "Document",
  "RecordLock",
  "ActivityLog",
]);

const MANY_OPS_WITH_WHERE = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
]);

const CREATE_OPS = new Set(["create"]);
const CREATE_MANY_OPS = new Set(["createMany", "createManyAndReturn"]);

const SINGLE_RECORD_OPS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"]);

export function getScopedPrisma(agencyId: string) {
  return prisma.$extends({
    name: "tenant-scoping",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          if (MANY_OPS_WITH_WHERE.has(operation)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const a = args as any;
            a.where = { AND: [a.where ?? {}, { agencyId }] };
            return query(a);
          }

          if (CREATE_OPS.has(operation)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const a = args as any;
            a.data = { ...a.data, agencyId };
            return query(a);
          }

          if (CREATE_MANY_OPS.has(operation)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const a = args as any;
            a.data = Array.isArray(a.data)
              ? a.data.map((row: Record<string, unknown>) => ({ ...row, agencyId }))
              : a.data;
            return query(a);
          }

          if (SINGLE_RECORD_OPS.has(operation)) {
            return guardSingleRecordOp(model, operation, args, query, agencyId);
          }

          return query(args);
        },
      },
    },
  });
}

async function guardSingleRecordOp(
  model: string,
  operation: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (args: any) => Promise<any>,
  agencyId: string
) {
  if (operation === "upsert") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (prisma as any)[uncapitalize(model)].findUnique({ where: args.where });
    if (existing && existing.agencyId !== agencyId) {
      throw new Error(`${model} not found`);
    }
    if (!existing) {
      args.create = { ...args.create, agencyId };
    }
    return query(args);
  }

  // findUnique / findUniqueOrThrow / update / delete: verify ownership
  // against the base (unscoped) client BEFORE letting the real operation
  // run, so a cross-tenant update/delete never executes at all.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (prisma as any)[uncapitalize(model)].findUnique({ where: args.where });

  if (!existing || existing.agencyId !== agencyId) {
    if (operation === "findUnique") return null;
    throw new Error(`${model} not found`);
  }

  return query(args);
}

function uncapitalize(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}
