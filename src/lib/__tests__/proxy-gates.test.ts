import { test, mock, before } from "node:test";
import assert from "node:assert/strict";
import type { NextResponse } from "next/server";

// proxy.ts is the primary enforcement point for auth/role gating (see
// session.ts's requireXSession() helpers, tested separately in
// session-gates.test.ts, which are explicit defense-in-depth *behind* this
// file's gates, not the main line of protection).
//
// proxy.ts wraps its routing callback in NextAuth's `auth()` higher-order
// function, which normally decodes a session from cookies on the real
// request. Mocking `next-auth` here replaces that HOF with an identity
// function, so `proxy` becomes exactly proxy.ts's own callback — letting
// tests set `req.auth` directly instead of needing a real signed session
// cookie. `@/lib/setup` and `@/lib/login` are mocked too since they'd
// otherwise hit a real (nonexistent, in this file) database.
//
// Requires --experimental-test-module-mocks (wired into the "test" npm
// script).

const state = { setupComplete: true, userActive: true };

mock.module("next-auth", {
  defaultExport: () => ({
    auth: (callback: (req: unknown) => unknown) => callback,
  }),
});
mock.module("@/lib/setup", { namedExports: { isSetupComplete: async () => state.setupComplete } });
mock.module("@/lib/login", { namedExports: { isUserActive: async () => state.userActive } });

type FakeUser = {
  id: string;
  role: string;
  agencyId: string | null;
  mustChangePassword: boolean;
};

let proxy: (req: { nextUrl: URL; auth: { user: FakeUser } | null }) => Promise<NextResponse>;

before(async () => {
  // proxy.ts's real static type expects a full NextRequest via NextAuth's
  // AppRouteHandlerFn signature — but next-auth is mocked above so `auth()`
  // is an identity function, meaning `proxy` really is just proxy.ts's own
  // single-argument callback at runtime. Asserting that here rather than
  // matching the (irrelevant, mocked-away) real signature.
  const mod = (await import("@/proxy")) as unknown as { proxy: typeof proxy };
  proxy = mod.proxy;
});

function req(pathname: string, user: FakeUser | null = null) {
  return { nextUrl: new URL(`http://localhost${pathname}`), auth: user ? { user } : null };
}

function location(res: NextResponse): string | null {
  return res.headers.get("location");
}

const agent: FakeUser = { id: "u1", role: "agent", agencyId: "a1", mustChangePassword: false };
const manager: FakeUser = { id: "u2", role: "manager", agencyId: "a1", mustChangePassword: false };
const head: FakeUser = { id: "u3", role: "head", agencyId: "a1", mustChangePassword: false };
const superAdmin: FakeUser = { id: "u4", role: "super_admin", agencyId: null, mustChangePassword: false };

test.beforeEach(() => {
  state.setupComplete = true;
  state.userActive = true;
});

test("redirects everything to /setup while setup is incomplete", async () => {
  state.setupComplete = false;
  const res = await proxy(req("/dashboard"));
  assert.match(location(res) ?? "", /\/setup$/);
});

test("lets /setup itself through while setup is incomplete", async () => {
  state.setupComplete = false;
  const res = await proxy(req("/setup"));
  assert.equal(location(res), null);
});

test("redirects /setup to /login once setup is already complete", async () => {
  const res = await proxy(req("/setup"));
  assert.match(location(res) ?? "", /\/login$/);
});

test("an unauthenticated visit to a protected route redirects to /login with a callbackUrl", async () => {
  const res = await proxy(req("/leads"));
  assert.match(location(res) ?? "", /^http:\/\/localhost\/login\?callbackUrl=/);
});

test("the login page passes through for a signed-out visitor", async () => {
  const res = await proxy(req("/login"));
  assert.equal(location(res), null);
});

test("an already-signed-in visitor to /login is bounced to /dashboard", async () => {
  const res = await proxy(req("/login", agent));
  assert.match(location(res) ?? "", /\/dashboard$/);
});

test("a temp-password user visiting /login goes straight to /change-password, not /dashboard", async () => {
  const res = await proxy(req("/login", { ...agent, mustChangePassword: true }));
  assert.match(location(res) ?? "", /\/change-password$/);
});

test("a deactivated user is bounced to /login?error=deactivated and the session cookie is cleared", async () => {
  state.userActive = false;
  const res = await proxy(req("/dashboard", agent));
  assert.match(location(res) ?? "", /\/login\?error=deactivated$/);
  assert.equal(res.cookies.get("authjs.session-token")?.value, "");
});

test("a temp-password user is forced to /change-password for any other route", async () => {
  const res = await proxy(req("/dashboard", { ...agent, mustChangePassword: true }));
  assert.match(location(res) ?? "", /\/change-password$/);
});

test("a non-Super-Admin visiting /admin is redirected to /dashboard", async () => {
  const res = await proxy(req("/admin/agencies", head));
  assert.match(location(res) ?? "", /\/dashboard$/);
});

test("a Super Admin can reach /admin", async () => {
  const res = await proxy(req("/admin/agencies", superAdmin));
  assert.equal(location(res), null);
});

test("a non-Head visiting /agency is redirected to /dashboard", async () => {
  const res = await proxy(req("/agency/users", manager));
  assert.match(location(res) ?? "", /\/dashboard$/);
});

test("a Head can reach /agency", async () => {
  const res = await proxy(req("/agency/users", head));
  assert.equal(location(res), null);
});

test("a Super Admin visiting an agency-scoped route (/leads) is redirected instead of crashing", async () => {
  const res = await proxy(req("/leads", superAdmin));
  assert.match(location(res) ?? "", /\/dashboard$/);
});

test("an agency-scoped user (Agent) can reach /leads", async () => {
  const res = await proxy(req("/leads", agent));
  assert.equal(location(res), null);
});

test("an Agent is blocked from /team", async () => {
  const res = await proxy(req("/team/dashboard", agent));
  assert.match(location(res) ?? "", /\/dashboard$/);
});

test("a Manager can reach /team", async () => {
  const res = await proxy(req("/team/dashboard", manager));
  assert.equal(location(res), null);
});

test("a Head can reach /team", async () => {
  const res = await proxy(req("/team/dashboard", head));
  assert.equal(location(res), null);
});
