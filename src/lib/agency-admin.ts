import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { generateTemporaryPassword } from "@/lib/password-policy";
import { DEFAULT_THEME_ID } from "@/lib/themes";

// Super Admin's Agency Onboarding (Section 5 / Section 10 phase 5): "you
// manually create each new agency and its initial Agency Head account."
// Under the current one-install-per-agency deployment (Section 2) this
// typically happens once, but isn't hard-restricted to one agency.

export async function listAgenciesWithHeads() {
  return prisma.agency.findMany({
    orderBy: { name: "asc" },
    include: { users: { where: { role: "head" }, orderBy: { createdAt: "asc" } } },
  });
}

type CreateAgencyResult =
  | { ok: true; agencyName: string; headEmail: string; temporaryPassword: string }
  | { ok: false; error: string };

export async function createAgencyWithHead(
  actorUserId: string,
  agencyName: string,
  headName: string,
  headEmail: string
): Promise<CreateAgencyResult> {
  const trimmedAgencyName = agencyName.trim();
  const trimmedHeadName = headName.trim();
  const normalizedEmail = headEmail.trim().toLowerCase();

  if (!trimmedAgencyName) {
    return { ok: false, error: "Agency name is required." };
  }
  if (!trimmedHeadName) {
    return { ok: false, error: "The Agency Head's name is required." };
  }
  if (!normalizedEmail.includes("@")) {
    return { ok: false, error: "Enter a valid email address for the Agency Head." };
  }

  const existingEmail = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existingEmail) {
    return { ok: false, error: "That email is already in use." };
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);

  // Atomic: an Agency with no Head at all is a state nothing else expects
  // (Section 5's Agency Onboarding treats "agency + head" as one action) —
  // if the User insert fails (e.g. a duplicate-email race), the Agency
  // insert must not be left behind either.
  const { agency, head } = await prisma.$transaction(async (tx) => {
    // Explicit, not relying on the schema column's own default — src/lib/themes.ts
    // is the one place "the default theme" is decided.
    const agency = await tx.agency.create({ data: { name: trimmedAgencyName, theme: DEFAULT_THEME_ID } });
    const head = await tx.user.create({
      data: {
        agencyId: agency.id,
        name: trimmedHeadName,
        email: normalizedEmail,
        passwordHash,
        role: "head",
        mustChangePassword: true,
      },
    });
    return { agency, head };
  });

  // agencyId: null, not agency.id — found in a full-app review: logging
  // this against the new agency meant it only ever showed up on *that*
  // agency's own Head-facing log (/agency/activity), attributed to a
  // Super Admin who isn't even a member of it, and never on the Super
  // Admin's own Host Activity Log (/admin/activity), which is
  // deliberately scoped to agencyId-null entries — see
  // src/app/admin/activity/page.tsx and src/lib/activity-log.ts's
  // listHostActivityLog. This is the Super Admin's own action (onboarding
  // a new agency), the same shape as storage-locations.ts's equivalent
  // Super-Admin action, which already logs it this way.
  await prisma.activityLog.create({
    data: {
      userId: actorUserId,
      agencyId: null,
      action: "agency_and_head_created",
      note: `Agency "${agency.name}" and its first Agency Head account (${head.email}) created`,
    },
  });

  return { ok: true, agencyName: agency.name, headEmail: head.email, temporaryPassword };
}
