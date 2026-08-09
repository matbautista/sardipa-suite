import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { isSetupComplete } from "@/lib/setup";

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
//  3. Change-password gate (Section 5/10 phase 5): a temporary-password
//     account (mustChangePassword) is forced to /change-password before
//     anything else, same "block everything until this one thing is
//     done" shape as the setup gate above.
//  4. Role gate: /admin/* is Super Admin only, /agency/* is Agency Head only.
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

  return NextResponse.next();
});

export const config = {
  // Everything except NextAuth's own API routes, the health check (Section
  // 9 — the process supervisor has no session), and static assets goes
  // through the gates above.
  matcher: ["/((?!api/auth|api/health|_next/static|_next/image|favicon.ico).*)"],
};
