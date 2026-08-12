import { headers } from "next/headers";
import { AuthError, CredentialsSignin } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";

// Found in a full-app review: this previously wasn't read at all (always
// hardcoded to "/dashboard", silently dropping proxy.ts's own callbackUrl
// and ignoring where the user was actually headed). proxy.ts hands this
// function the *full* URL it built (req.nextUrl.href — e.g.
// "http://192.168.1.50:3000/agency/lines"), not a bare path, so this has
// to parse it rather than just checking a leading "/". Resolved against
// the current request's own Host header (not trusted from the callbackUrl
// value itself) and only the path/search/hash kept — an absolute URL
// pointing at a *different* host (a crafted login link to
// "https://evil.example.com", or even a same-app scheme-relative
// "//evil.example.com") is rejected outright rather than followed, which
// is what would otherwise make this an open redirect.
async function safeRedirectTarget(callbackUrl: FormDataEntryValue | null): Promise<string> {
  if (typeof callbackUrl !== "string" || !callbackUrl) {
    return "/dashboard";
  }
  const host = (await headers()).get("host");
  if (!host) {
    return "/dashboard";
  }
  try {
    const url = new URL(callbackUrl, `http://${host}`);
    if (url.host !== host) {
      return "/dashboard";
    }
    return `${url.pathname}${url.search}${url.hash}` || "/dashboard";
  } catch {
    return "/dashboard";
  }
}

async function loginAction(formData: FormData) {
  "use server";

  const redirectTo = await safeRedirectTarget(formData.get("callbackUrl"));

  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo,
    });
  } catch (error) {
    // Found in a full-app review: this previously collapsed every failure
    // to the same "?error=1", discarding the specific reason
    // verifyCredentials/auth.ts already worked out (wrong password vs.
    // locked-out vs. deactivated) — see auth.ts's CredentialsSignin
    // subclasses, whose `.code` survives being thrown back out here.
    if (error instanceof CredentialsSignin) {
      redirect(`/login?error=${error.code}`);
    }
    if (error instanceof AuthError) {
      redirect("/login?error=invalid_credentials");
    }
    // signIn's own successful redirect is implemented by throwing a
    // special Next.js redirect error — it must propagate, not be caught.
    throw error;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; passwordChanged?: string; callbackUrl?: string }>;
}) {
  const { error, passwordChanged, callbackUrl } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">Saripda Suite</h1>
        <p className="mt-1 text-sm text-gray-500">Sign in to continue</p>

        {passwordChanged && !error && (
          <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            Password changed — sign in with your new password.
          </p>
        )}
        {(error === "deactivated" || error === "account_inactive") && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Your account has been deactivated. Contact your Agency Head or Super Admin.
          </p>
        )}
        {error === "account_locked" && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Too many failed attempts — this account is locked for up to 15 minutes. Try again shortly.
          </p>
        )}
        {error && error !== "deactivated" && error !== "account_inactive" && error !== "account_locked" && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Incorrect email or password.
          </p>
        )}

        <form action={loginAction} className="mt-6 space-y-4">
          <input type="hidden" name="callbackUrl" value={callbackUrl ?? ""} />
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md btn-primary px-3 py-2 text-sm font-medium"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
