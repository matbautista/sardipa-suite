import type { DefaultSession } from "next-auth";

// Session carries agencyId, role, and mustChangePassword (Section 5/7 of
// the plan) so every server component/route handler can scope its own
// queries — and proxy.ts can force the change-password redirect — without
// a fresh DB lookup on every request.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      agencyId: string | null;
      role: string;
      mustChangePassword: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    agencyId: string | null;
    role: string;
    mustChangePassword: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    agencyId: string | null;
    role: string;
    mustChangePassword: boolean;
  }
}
