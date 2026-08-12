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
  // NextAuth rejects requests whose Host header isn't "trusted" unless
  // told otherwise — normally satisfied by a platform like Vercel that
  // supplies verified host headers. This app is always self-hosted
  // (Section 8: LAN-only, reached via the host's own IP, never behind a
  // platform like that), so there's no other source of trust to rely on.
  // Found this the hard way: without it, every login fails outright with
  // a 500 in production mode (`next start`) — dev mode didn't surface it.
  trustHost: true,
  callbacks: {
    // Carries agencyId + role + mustChangePassword from the initial
    // sign-in's User object into the JWT itself, so later requests never
    // need a DB round-trip just to know who's asking (Section 7 of the
    // plan). Note this means mustChangePassword is a snapshot from
    // login time — after a successful password change, the user is
    // signed out and must log in again for a fresh JWT to pick up the
    // new value, rather than the app trying to patch an already-issued
    // token in place.
    jwt({ token, user }) {
      if (user) {
        token.agencyId = user.agencyId;
        token.role = user.role;
        token.mustChangePassword = user.mustChangePassword;
      }
      return token;
    },
    session({ session, token }: { session: Session; token: JWT }) {
      session.user.id = token.sub!;
      session.user.agencyId = token.agencyId;
      session.user.role = token.role;
      session.user.mustChangePassword = token.mustChangePassword;
      return session;
    },
    // No `authorized` callback here — that pattern only fires when `auth`
    // is exported directly as the proxy function. Once proxy.ts needed to
    // run its own setup-gate logic first (Section 10 phase 3), it switched
    // to wrapping a custom middleware function instead (`auth((req) =>
    // ...)`), which bypasses `authorized` entirely — so the equivalent
    // "redirect to /login unless authenticated" logic now lives directly
    // in proxy.ts instead of here.
  },
} satisfies NextAuthConfig;
