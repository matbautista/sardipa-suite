import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getScopedPrisma } from "@/lib/tenant-db";
import { generateTemporaryPassword } from "@/lib/password-policy";

// Agency Head's own account creation/reset/deactivation for Managers and
// Agents (Section 5's Users feature / Section 10 phase 6) — same
// temporary-password shape as Super Admin creating the Agency Head
// (Section 10 phase 5), reusing that exact mechanism rather than a
// second one, per the plan's "works exactly the same way."

type ActionResult = { ok: true } | { ok: false; error: string };
type CreateUserResult = { ok: true; email: string; temporaryPassword: string } | { ok: false; error: string };
type ResetPasswordResult = { ok: true; temporaryPassword: string } | { ok: false; error: string };

export async function listAgencyUsers(agencyId: string) {
  const scoped = getScopedPrisma(agencyId);
  const [managers, agents] = await Promise.all([
    scoped.user.findMany({ where: { role: "manager" }, orderBy: { name: "asc" } }),
    scoped.user.findMany({ where: { role: "agent" }, orderBy: { name: "asc" } }),
  ]);
  return { managers, agents };
}

async function createAgencyUser(
  agencyId: string,
  name: string,
  email: string,
  role: "manager" | "agent",
  managerId: string | null
): Promise<CreateUserResult> {
  const trimmedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();

  if (!trimmedName) {
    return { ok: false, error: "Name is required." };
  }
  if (!normalizedEmail.includes("@")) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const scoped = getScopedPrisma(agencyId);

  // Email uniqueness is global (Section 6: User.email @unique), not just
  // within this agency, so this has to check the whole table — but
  // everything else about this user is still created through the scoped
  // client below. Must use the raw `prisma` client, not `scoped`: found in
  // a full-app review that getScopedPrisma's findUnique guard treats any
  // cross-tenant match as "not found" (tenant-db.ts), so this check was
  // silently never detecting a collision with another agency's user —
  // agency-admin.ts's equivalent check already does this correctly.
  const existingEmail = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existingEmail) {
    return { ok: false, error: "That email is already in use." };
  }

  let verifiedManagerId: string | null = null;
  if (role === "agent" && managerId) {
    // findUnique through the scoped client returns null for a manager
    // belonging to another agency, same as it doesn't exist at all.
    const manager = await scoped.user.findUnique({ where: { id: managerId } });
    if (!manager || manager.role !== "manager") {
      return { ok: false, error: "Choose a valid manager for this agent." };
    }
    verifiedManagerId = manager.id;
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);

  const user = await scoped.user.create({
    data: {
      name: trimmedName,
      email: normalizedEmail,
      passwordHash,
      role,
      managerId: verifiedManagerId,
      mustChangePassword: true,
    },
  });

  await scoped.activityLog.create({
    data: { userId: user.id, action: `${role}_account_created`, note: `Account created by Agency Head` },
  });

  return { ok: true, email: user.email, temporaryPassword };
}

export function createAgencyManager(agencyId: string, name: string, email: string) {
  return createAgencyUser(agencyId, name, email, "manager", null);
}

export function createAgencyAgent(agencyId: string, name: string, email: string, managerId: string | null) {
  return createAgencyUser(agencyId, name, email, "agent", managerId);
}

export async function resetAgencyUserPassword(agencyId: string, targetUserId: string): Promise<ResetPasswordResult> {
  const scoped = getScopedPrisma(agencyId);
  const target = await scoped.user.findUnique({ where: { id: targetUserId } });
  if (!target || (target.role !== "manager" && target.role !== "agent")) {
    return { ok: false, error: "User not found." };
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);

  await scoped.user.update({
    where: { id: targetUserId },
    data: { passwordHash, mustChangePassword: true, failedLoginAttempts: 0, lockedUntil: null },
  });

  await scoped.activityLog.create({
    data: { userId: targetUserId, action: "password_reset_by_head", note: null },
  });

  return { ok: true, temporaryPassword };
}

type SetActiveResult = { ok: true; warning: string | null } | { ok: false; error: string };

export async function setAgencyUserActive(
  agencyId: string,
  targetUserId: string,
  isActive: boolean
): Promise<SetActiveResult> {
  const scoped = getScopedPrisma(agencyId);
  const target = await scoped.user.findUnique({ where: { id: targetUserId } });
  if (!target || (target.role !== "manager" && target.role !== "agent")) {
    return { ok: false, error: "User not found." };
  }

  await scoped.user.update({ where: { id: targetUserId }, data: { isActive } });
  await scoped.activityLog.create({
    data: { userId: targetUserId, action: isActive ? "user_reactivated" : "user_deactivated", note: null },
  });

  // Found in a full-app review: deactivation had no reassignment path or
  // even a warning for the person's open leads/policies, despite Section
  // 5's Deactivation bullet requiring it ("a Manager/Agency Head reassigns
  // their open leads/policies to someone active"). Reassigning is a
  // judgment call (who should get them?), not something safe to do
  // silently on the Head's behalf — this surfaces it as an explicit
  // prompt instead, pointing at the reassignment controls team/leads and
  // team/policies already have (the latter added in this same review).
  let warning: string | null = null;
  if (!isActive) {
    const [openLeadCount, openPolicyCount] = await Promise.all([
      scoped.lead.count({ where: { ownerId: targetUserId, status: { notIn: ["won", "lost"] } } }),
      scoped.policy.count({ where: { ownerId: targetUserId, status: { notIn: ["cancelled", "completed"] } } }),
    ]);
    if (openLeadCount > 0 || openPolicyCount > 0) {
      const parts = [];
      if (openLeadCount > 0) parts.push(`${openLeadCount} open lead${openLeadCount === 1 ? "" : "s"}`);
      if (openPolicyCount > 0) parts.push(`${openPolicyCount} open polic${openPolicyCount === 1 ? "y" : "ies"}`);
      warning = `${target.name} still has ${parts.join(" and ")} — reassign them from Team Leads / Team Policies so they stay with someone active.`;
    }
  }

  return { ok: true, warning };
}

export async function reassignAgentManager(
  agencyId: string,
  agentUserId: string,
  managerId: string | null
): Promise<ActionResult> {
  const scoped = getScopedPrisma(agencyId);
  const agent = await scoped.user.findUnique({ where: { id: agentUserId } });
  if (!agent || agent.role !== "agent") {
    return { ok: false, error: "Agent not found." };
  }

  if (managerId) {
    const manager = await scoped.user.findUnique({ where: { id: managerId } });
    if (!manager || manager.role !== "manager") {
      return { ok: false, error: "Choose a valid manager." };
    }
  }

  await scoped.user.update({ where: { id: agentUserId }, data: { managerId } });
  await scoped.activityLog.create({
    data: {
      userId: agentUserId,
      action: "manager_reassigned",
      note: managerId ? `Reassigned to manager ${managerId}` : "Unassigned from manager",
    },
  });

  return { ok: true };
}
