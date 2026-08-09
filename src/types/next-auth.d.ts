import type { DefaultSession } from "next-auth";

// Session carries agencyId and role (Section 7 of the plan) so every server
// component/route handler can scope its own queries without a fresh DB
// lookup on every request.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      agencyId: string | null;
      role: string;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    agencyId: string | null;
    role: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    agencyId: string | null;
    role: string;
  }
}
