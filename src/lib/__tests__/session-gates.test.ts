import { test, mock, before } from "node:test";
import assert from "node:assert/strict";

// session.ts's requireXSession() helpers are explicitly documented as
// defense-in-depth behind proxy.ts's own gates (see proxy-gates.test.ts) —
// this file tests that second layer in isolation, by mocking its two
// dependencies (@/auth's `auth()` and next/navigation's `redirect()`)
// rather than going through a real request/session. Requires
// --experimental-test-module-mocks (wired into the "test" npm script).

const state: { session: { user: { role: string; agencyId: string | null } } | null } = {
  session: null,
};

mock.module("@/auth", { namedExports: { auth: async () => state.session } });
mock.module("next/navigation", {
  namedExports: {
    redirect: (url: string) => {
      throw new Error(`REDIRECT:${url}`);
    },
  },
});

let requireSession: typeof import("@/lib/session").requireSession;
let requireAgencySession: typeof import("@/lib/session").requireAgencySession;
let requireSuperAdminSession: typeof import("@/lib/session").requireSuperAdminSession;
let requireHeadSession: typeof import("@/lib/session").requireHeadSession;
let requireManagerOrHeadSession: typeof import("@/lib/session").requireManagerOrHeadSession;

before(async () => {
  ({
    requireSession,
    requireAgencySession,
    requireSuperAdminSession,
    requireHeadSession,
    requireManagerOrHeadSession,
  } = await import("@/lib/session"));
});

test("requireSession redirects to /login when there is no session", async () => {
  state.session = null;
  await assert.rejects(() => requireSession(), /REDIRECT:\/login/);
});

test("requireAgencySession throws for a Super Admin (no agencyId)", async () => {
  state.session = { user: { role: "super_admin", agencyId: null } };
  await assert.rejects(() => requireAgencySession(), /agency-scoped user/i);
});

test("requireAgencySession returns the session for an agency-scoped user", async () => {
  state.session = { user: { role: "agent", agencyId: "agency-1" } };
  const session = await requireAgencySession();
  assert.equal(session.user.agencyId, "agency-1");
});

test("requireSuperAdminSession throws for a non-Super-Admin", async () => {
  state.session = { user: { role: "head", agencyId: "agency-1" } };
  await assert.rejects(() => requireSuperAdminSession(), /Super Admin session/i);
});

test("requireSuperAdminSession returns the session for a Super Admin", async () => {
  state.session = { user: { role: "super_admin", agencyId: null } };
  const session = await requireSuperAdminSession();
  assert.equal(session.user.role, "super_admin");
});

test("requireHeadSession throws for a Manager", async () => {
  state.session = { user: { role: "manager", agencyId: "agency-1" } };
  await assert.rejects(() => requireHeadSession(), /Agency Head session/i);
});

test("requireHeadSession throws for a Super Admin (fails the agency check first)", async () => {
  state.session = { user: { role: "super_admin", agencyId: null } };
  await assert.rejects(() => requireHeadSession(), /agency-scoped user/i);
});

test("requireHeadSession returns the session for a Head", async () => {
  state.session = { user: { role: "head", agencyId: "agency-1" } };
  const session = await requireHeadSession();
  assert.equal(session.user.role, "head");
});

test("requireManagerOrHeadSession throws for an Agent", async () => {
  state.session = { user: { role: "agent", agencyId: "agency-1" } };
  await assert.rejects(() => requireManagerOrHeadSession(), /Manager or Agency Head session/i);
});

test("requireManagerOrHeadSession allows a Manager", async () => {
  state.session = { user: { role: "manager", agencyId: "agency-1" } };
  const session = await requireManagerOrHeadSession();
  assert.equal(session.user.role, "manager");
});

test("requireManagerOrHeadSession allows a Head", async () => {
  state.session = { user: { role: "head", agencyId: "agency-1" } };
  const session = await requireManagerOrHeadSession();
  assert.equal(session.user.role, "head");
});
