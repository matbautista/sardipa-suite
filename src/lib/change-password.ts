import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

type ChangePasswordResult = { ok: true } | { ok: false; error: string };

/**
 * Used both for the forced first-login change (Section 5: a temporary
 * password "shown once on screen... the new user is prompted to change it
 * on first login") and for a voluntary change by an already-logged-in
 * user. Requires the current password even though the caller is already
 * authenticated — a session alone shouldn't be enough to lock the real
 * owner out via a hijacked session.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  confirmNewPassword: string
): Promise<ChangePasswordResult> {
  if (newPassword !== confirmNewPassword) {
    return { ok: false, error: "New passwords don't match." };
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { ok: false, error: "Account not found." };
  }

  const currentValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!currentValid) {
    return { ok: false, error: "Current password is incorrect." };
  }

  const newPasswordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newPasswordHash, mustChangePassword: false },
  });

  await prisma.activityLog.create({
    data: { userId, agencyId: user.agencyId, action: "password_changed", note: null },
  });

  return { ok: true };
}
