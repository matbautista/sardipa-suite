import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { isSetupComplete } from "@/lib/setup";
import { isUserActive } from "@/lib/login";

// NextAuth v5's default session cookie name (verified against
// node_modules/@auth/core/lib/utils/cookie.js) — "authjs.session-token"
// normally, "__Secure-" prefixed only when useSecureCookies is on (HTTPS).
// This app runs plain HTTP by default (Section 8), but both are cleared
// below so a later move behind a reverse-proxy/TLS (Section 8's "Future
// path") doesn't quietly bring this check's cookie-clearing back to
// half-working.
const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"];

// Named "proxy", not "middleware" — Next.js 16 renamed the convention (the
// old middleware.ts export is deprecated and silently ignored at build
// time).
//
// `auth` isn't directly callable as `auth(request)` — it's a higher-order
// function that wraps a middleware callback (`auth((req) => ...)`), giving
// that callback `req.auth` (the decoded session). Wrapping a custom
// function like this bypasses authConfig's `authorized` callback entirely,
// so all the routing logic below — both gates — lives here instead:
//
//  1. Setup gate (Section 10 phase 3): until a Super Admin exists and a
//     StorageLocation is configured, every route redirects to /setup.
//     This is why proxy.ts now reaches the database (via lib/setup),
//     unlike before — Next.js 16 runs Proxy on the Node.js runtime by
//     default (it was Edge-only pre-v16), so that's no longer the
//     blocker it used to be. isSetupComplete() caches its result in
//     memory once true, so this is a real DB query only until the first
//     time setup ever finishes, not on every request forever.
//  2. Auth gate: redirect to /login unless signed in (preserving the
//     original URL as callbackUrl), and bounce an already-signed-in user
//     away from /login instead of looping.
//  2b. Deactivation gate: a User.isActive flip previously had no effect
//     on an already-issued JWT session (found in a full-app review — the
//     session carries no live link back to the User row, so a deactivated
//     user's login just kept working for the rest of the session's
//     lifetime). Checked on every authenticated request, before the
//     isLoginPage bounce-away above would otherwise send a
//     still-cookied-but-deactivated user straight back to /dashboard —
//     the session cookie is explicitly cleared here too, not just
//     redirected past, so this doesn't loop.
//  3. Change-password gate (Section 5/10 phase 5): a temporary-password
//     account (mustChangePassword) is forced to /change-password before
//     anything else, same "block everything until this one thing is
//     done" shape as the setup gate above.
//  4. Role gate: /admin/* is Super Admin only, /agency/* is Agency Head
//     only, /leads, /policies, /reminders, and /search are agency-scoped
//     users only (a Super Admin has no agencyId, so the page-level
//     requireAgencySession() call would otherwise throw an unhandled error
//     instead of redirecting — caught live during a full-app review, Super
//     Admin manually visiting one of these routes crashed instead of
//     bouncing to /dashboard like every other unauthorized case here).
//     /team/* is Manager and Head only (Section 10 phase 12) — unlike the
//     routes above, an Agent has no business here at all, not just a
//     missing agencyId.
const { auth } = NextAuth(authConfig);

export const proxy = auth(async (req) => {
  const { pathname } = req.nextUrl;

  const setupDone = await isSetupComplete();
  if (!setupDone) {
    if (pathname === "/setup") return NextResponse.next();
    return NextResponse.redirect(new URL("/setup", req.nextUrl));
  }
  if (pathname === "/setup") {
    // Setup already finished — don't let it be re-run.
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  const isLoggedIn = !!req.auth?.user;
  const isLoginPage = pathname === "/login";

  if (isLoggedIn && !(await isUserActive(req.auth!.user.id))) {
    const response = NextResponse.redirect(new URL("/login?error=deactivated", req.nextUrl));
    for (const name of SESSION_COOKIE_NAMES) {
      response.cookies.delete(name);
    }
    return response;
  }

  if (isLoginPage) {
    return isLoggedIn ? NextResponse.redirect(new URL("/dashboard", req.nextUrl)) : NextResponse.next();
  }
  if (!isLoggedIn) {
    const loginUrl = new URL("/login", req.nextUrl);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.href);
    return NextResponse.redirect(loginUrl);
  }

  const user = req.auth!.user;

  if (user.mustChangePassword && pathname !== "/change-password") {
    return NextResponse.redirect(new URL("/change-password", req.nextUrl));
  }

  if (pathname.startsWith("/admin") && user.role !== "super_admin") {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  if (pathname.startsWith("/agency") && user.role !== "head") {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  if (
    (pathname.startsWith("/leads") ||
      pathname.startsWith("/policies") ||
      pathname.startsWith("/reminders") ||
      pathname.startsWith("/search")) &&
    !user.agencyId
  ) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  if (pathname.startsWith("/team") && user.role !== "manager" && user.role !== "head") {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  // Everything except NextAuth's own API routes, the health check (Section
  // 9 — the process supervisor has no session), and static assets goes
  // through the gates above.
  matcher: ["/((?!api/auth|api/health|_next/static|_next/image|favicon.ico).*)"],
};
