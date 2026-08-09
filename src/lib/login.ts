import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// Login security baseline (Section 5 of the plan): 10-character minimum is
// enforced wherever passwords are *set*, not here; lockout after 5
// consecutive failed attempts, for 15 minutes, is enforced here.
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

export type LoginResult =
  | {
      ok: true;
      user: {
        id: string;
        agencyId: string | null;
        role: string;
        name: string;
        email: string;
        mustChangePassword: boolean;
      };
    }
  | { ok: false; reason: "invalid_credentials" | "account_inactive" | "account_locked" };

/**
 * Verifies email/password against the User table, applying the account
 * lockout rule and writing every attempt (success or failure) to
 * ActivityLog — this is the one place login is actually checked, so
 * NextAuth's Credentials provider is a thin wrapper around it.
 */
export async function verifyCredentials(email: string, password: string): Promise<LoginResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (!user) {
    // No account to log against — nothing to record.
    return { ok: false, reason: "invalid_credentials" };
  }

  if (!user.isActive) {
    return { ok: false, reason: "account_inactive" };
  }

  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    await logAttempt(user.id, user.agencyId, "login_locked_out", "Login attempted while account is locked");
    return { ok: false, reason: "account_locked" };
  }

  const passwordValid = await bcrypt.compare(password, user.passwordHash);

  if (!passwordValid) {
    const attempts = user.failedLoginAttempts + 1;
    const isNowLocked = attempts >= LOCKOUT_THRESHOLD;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: isNowLocked ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) : user.lockedUntil,
      },
    });
    await logAttempt(
      user.id,
      user.agencyId,
      isNowLocked ? "login_failed_lockout_triggered" : "login_failed",
      `Failed login attempt ${attempts}/${LOCKOUT_THRESHOLD}`
    );
    return { ok: false, reason: "invalid_credentials" };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
  await logAttempt(user.id, user.agencyId, "login_success", null);

  return {
    ok: true,
    user: {
      id: user.id,
      agencyId: user.agencyId,
      role: user.role,
      name: user.name,
      email: user.email,
      mustChangePassword: user.mustChangePassword,
    },
  };
}

function logAttempt(userId: string, agencyId: string | null, action: string, note: string | null) {
  return prisma.activityLog.create({
    data: { userId, agencyId, action, note },
  });
}
