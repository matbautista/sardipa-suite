import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Edge-safe: built from authConfig alone (no Credentials provider, no
// Prisma), so it can decode/verify the JWT without any Node-only deps.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Everything except NextAuth's own API routes and static assets goes
  // through the `authorized` callback in auth.config.ts.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
