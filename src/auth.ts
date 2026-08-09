import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { verifyCredentials } from "@/lib/login";

// Full config — Node-only, uses Prisma/bcrypt via verifyCredentials. Used in
// server components, route handlers, and server actions. middleware.ts uses
// authConfig directly instead, since it must stay Edge-compatible.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const result = await verifyCredentials(email, password);
        if (!result.ok) {
          return null;
        }
        return result.user;
      },
    }),
  ],
});
