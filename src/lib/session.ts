import { redirect } from "next/navigation";
import { auth } from "@/auth";

/**
 * For use in server components/route handlers that are already behind
 * proxy.ts's auth gate — this just gives a conveniently typed, non-null
 * session, with a redirect as a defense-in-depth fallback rather than the
 * only line of protection.
 */
export async function requireSession() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session;
}

/** Throws if called from a Super Admin session — use for agency-only pages. */
export async function requireAgencySession() {
  const session = await requireSession();
  if (!session.user.agencyId) {
    throw new Error("This page requires an agency-scoped user, not a Super Admin");
  }
  return session as typeof session & { user: { agencyId: string } };
}

/**
 * Throws if called from a non-Super-Admin session — use for /admin pages.
 * proxy.ts already redirects non-Super-Admins away from /admin/*, so this
 * is defense-in-depth, not the only line of protection.
 */
export async function requireSuperAdminSession() {
  const session = await requireSession();
  if (session.user.role !== "super_admin") {
    throw new Error("This page requires a Super Admin session");
  }
  return session;
}
