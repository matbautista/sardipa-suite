import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Named "proxy", not "middleware" — Next.js 16 renamed the convention (the
// old middleware.ts export is deprecated and silently ignored at build
// time). Still built from authConfig alone (no Credentials provider, no
// Prisma) even though Proxy now defaults to the Node.js runtime rather than
// Edge, since keeping it dependency-light here isn't a downside.
// A plain `export const proxy = ...` (not a destructured rename) — Next's
// build-time static analysis for this file needs a literal export, and
// `export const { auth: proxy } = NextAuth(...)` wasn't recognized even
// though it's a function at runtime.
const { auth } = NextAuth(authConfig);
export const proxy = auth;

export const config = {
  // Everything except NextAuth's own API routes, the health check (Section
  // 9 — the process supervisor has no session), and static assets goes
  // through the `authorized` callback in auth.config.ts.
  matcher: ["/((?!api/auth|api/health|_next/static|_next/image|favicon.ico).*)"],
};
