import type { NextAuthConfig, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";

// Deliberately has no providers and no Prisma/bcrypt imports — this config
// is also loaded by proxy.ts. Next.js 16 runs Proxy on the Node.js runtime
// by default (it was Edge-only pre-v16), so this split isn't strictly
// required anymore for driver-adapter compatibility, but it's kept anyway:
// proxy.ts should stay dependency-light regardless of which runtime it
// happens to run on. The Credentials provider (Prisma + bcrypt) lives only
// in auth.ts, which extends this config.
export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    // Carries agencyId + role from the initial sign-in's User object into
    // the JWT itself, so later requests never need a DB round-trip just to
    // know who's asking (Section 7 of the plan).
    jwt({ token, user }) {
      if (user) {
        token.agencyId = user.agencyId;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }: { session: Session; token: JWT }) {
      session.user.id = token.sub!;
      session.user.agencyId = token.agencyId;
      session.user.role = token.role;
      return session;
    },
    // Gates every route except /login. NextAuth redirects to pages.signIn
    // (preserving the original URL as callbackUrl) whenever this returns
    // false, so route-level protection lives in one place.
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isLoginPage = nextUrl.pathname === "/login";

      if (isLoginPage) {
        // Already signed in and hitting /login: bounce to the dashboard
        // instead of returning false, which would redirect back to /login
        // and loop forever.
        return isLoggedIn ? Response.redirect(new URL("/dashboard", nextUrl)) : true;
      }
      return isLoggedIn;
    },
  },
} satisfies NextAuthConfig;
