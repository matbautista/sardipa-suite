import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setupTestDatabase, teardownTestDatabase, type TestDatabase } from "./test-db";

// tenant-db.ts is a Prisma Client extension — the only faithful way to test
// it is against a real Prisma Client and a real (temp, throwaway) database,
// not a mocked one. DATABASE_URL must be set before @/lib/prisma is ever
// imported (it reads the env var once, at module-eval time), so the app
// modules below are imported dynamically, after the env var is set, rather
// than via a static import at the top of this file.

const testDb: TestDatabase = setupTestDatabase();
process.env.DATABASE_URL = testDb.url;

let prisma: typeof import("@/lib/prisma").prisma;
let getScopedPrisma: typeof import("@/lib/tenant-db").getScopedPrisma;
let agencyA: string;
let agencyB: string;

before(async () => {
  ({ prisma } = await import("@/lib/prisma"));
  ({ getScopedPrisma } = await import("@/lib/tenant-db"));

  const [a, b] = await Promise.all([
    prisma.agency.create({ data: { name: "Agency A" } }),
    prisma.agency.create({ data: { name: "Agency B" } }),
  ]);
  agencyA = a.id;
  agencyB = b.id;
});

after(async () => {
  await prisma.$disconnect();
  teardownTestDatabase(testDb);
});

function userData(overrides: Record<string, unknown> = {}) {
  return {
    name: "Test User",
    email: `${randomUUID()}@example.com`,
    passwordHash: "hash",
    role: "agent",
    ...overrides,
  };
}

test("create forces the caller's agencyId, overriding any spoofed value", async () => {
  const scopedA = getScopedPrisma(agencyA);
  const user = await scopedA.user.create({ data: userData({ agencyId: agencyB }) });
  assert.equal(user.agencyId, agencyA);
});

test("createMany forces agencyId on every row, overriding any spoofed value", async () => {
  const scopedA = getScopedPrisma(agencyA);
  const e1 = `${randomUUID()}@example.com`;
  const e2 = `${randomUUID()}@example.com`;
  await scopedA.user.createMany({
    data: [userData({ email: e1, agencyId: agencyB }), userData({ email: e2 })],
  });
  const rows = await prisma.user.findMany({ where: { email: { in: [e1, e2] } } });
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(row.agencyId, agencyA);
});

test("findMany is confined to the caller's agency even when the where clause tries an OR across tenants", async () => {
  const scopedA = getScopedPrisma(agencyA);
  const scopedB = getScopedPrisma(agencyB);
  const emailA = `${randomUUID()}@example.com`;
  const emailB = `${randomUUID()}@example.com`;
  await scopedA.user.create({ data: userData({ email: emailA }) });
  await scopedB.user.create({ data: userData({ email: emailB }) });

  const results = await scopedA.user.findMany({ where: { OR: [{ email: emailA }, { email: emailB }] } });
  assert.deepEqual(
    results.map((u) => u.email),
    [emailA]
  );
});

test("findUnique treats a cross-tenant id as not found", async () => {
  const scopedA = getScopedPrisma(agencyA);
  const scopedB = getScopedPrisma(agencyB);
  const created = await scopedA.user.create({ data: userData() });

  const viaOwnAgency = await scopedA.user.findUnique({ where: { id: created.id } });
  assert.equal(viaOwnAgency?.id, created.id);

  const viaOtherAgency = await scopedB.user.findUnique({ where: { id: created.id } });
  assert.equal(viaOtherAgency, null);
});

test("update rejects a cross-tenant id without ever touching the row", async () => {
  const scopedA = getScopedPrisma(agencyA);
  const scopedB = getScopedPrisma(agencyB);
  const created = await scopedA.user.create({ data: userData({ name: "Original" }) });

  await assert.rejects(
    () => scopedB.user.update({ where: { id: created.id }, data: { name: "Hacked" } }),
    /not found/i
  );
  const untouched = await prisma.user.findUnique({ where: { id: created.id } });
  assert.equal(untouched?.name, "Original");

  const updated = await scopedA.user.update({ where: { id: created.id }, data: { name: "Renamed" } });
  assert.equal(updated.name, "Renamed");
});

test("delete rejects a cross-tenant id without ever touching the row", async () => {
  const scopedA = getScopedPrisma(agencyA);
  const scopedB = getScopedPrisma(agencyB);
  const created = await scopedA.user.create({ data: userData() });

  await assert.rejects(() => scopedB.user.delete({ where: { id: created.id } }), /not found/i);
  assert.ok(await prisma.user.findUnique({ where: { id: created.id } }));

  const deleted = await scopedA.user.delete({ where: { id: created.id } });
  assert.equal(deleted.id, created.id);
  assert.equal(await prisma.user.findUnique({ where: { id: created.id } }), null);
});

test("upsert creates under the caller's agency when the record doesn't exist yet", async () => {
  const scopedA = getScopedPrisma(agencyA);
  const email = `${randomUUID()}@example.com`;
  const result = await scopedA.user.upsert({
    where: { email },
    create: userData({ email, name: "New" }),
    update: { name: "Should not run" },
  });
  assert.equal(result.agencyId, agencyA);
  assert.equal(result.name, "New");
});

test("upsert updates an existing record that belongs to the caller's own agency", async () => {
  const scopedA = getScopedPrisma(agencyA);
  const email = `${randomUUID()}@example.com`;
  await scopedA.user.create({ data: userData({ email, name: "Original" }) });

  const result = await scopedA.user.upsert({
    where: { email },
    create: userData({ email, name: "Should not run" }),
    update: { name: "Updated Own" },
  });
  assert.equal(result.name, "Updated Own");
  assert.equal(result.agencyId, agencyA);
});

test("upsert rejects touching a record that belongs to a different agency", async () => {
  const scopedA = getScopedPrisma(agencyA);
  const scopedB = getScopedPrisma(agencyB);
  const email = `${randomUUID()}@example.com`;
  await scopedA.user.create({ data: userData({ email, name: "Owner's" }) });

  await assert.rejects(
    () =>
      scopedB.user.upsert({
        where: { email },
        create: userData({ email, name: "Should not run" }),
        update: { name: "Hacked" },
      }),
    /not found/i
  );
  const untouched = await prisma.user.findUnique({ where: { email } });
  assert.equal(untouched?.name, "Owner's");
});

test("a model outside TENANT_SCOPED_MODELS (StorageLocation) passes through unfiltered", async () => {
  await prisma.storageLocation.deleteMany({});
  await prisma.storageLocation.create({ data: { path: "/tmp/a", label: "A" } });

  const scopedA = getScopedPrisma(agencyA);
  const seenViaScopedClient = await scopedA.storageLocation.findMany({});
  assert.equal(seenViaScopedClient.length, 1);
});
