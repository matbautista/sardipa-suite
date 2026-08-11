import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { verifyCredentials, type LoginResult } from "@/lib/login";

// Found in a full-app review: authorize() previously always returned null
// on failure, so signIn() always threw the same generic CredentialsSignin
// error regardless of *why* — a user who just got locked out saw the exact
// same message as a plain typo, with no indication they now need to wait
// 15 minutes. Throwing one of these (rather than returning null) preserves
// verifyCredentials's specific reason: per @auth/core/errors.d.ts,
// throwing a CredentialsSignin subclass from authorize() in a framework
// that handles form actions server-side (this app's loginAction) makes
// signIn() throw that exact error back out, instead of just redirecting —
// so loginAction's catch below can read `.code` and pass the real reason
// through to the login page.
class InvalidCredentialsSignin extends CredentialsSignin {
  code = "invalid_credentials";
}
class AccountInactiveSignin extends CredentialsSignin {
  code = "account_inactive";
}
class AccountLockedSignin extends CredentialsSignin {
  code = "account_locked";
}

function throwForReason(reason: Extract<LoginResult, { ok: false }>["reason"]): never {
  if (reason === "account_inactive") throw new AccountInactiveSignin();
  if (reason === "account_locked") throw new AccountLockedSignin();
  throw new InvalidCredentialsSignin();
}

// Full config — Node-only, uses Prisma/bcrypt via verifyCredentials. Used in
// server components, route handlers, and server actions. proxy.ts uses
// authConfig directly instead, without the Credentials provider.
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
          throwForReason("invalid_credentials");
        }

        const result = await verifyCredentials(email, password);
        if (!result.ok) {
          throwForReason(result.reason);
        }
        return result.user;
      },
    }),
  ],
});
