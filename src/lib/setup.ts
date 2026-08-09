import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { isDifferentDisk, ensureWritableDirectory } from "@/lib/storage-path";

// First-run setup wizard (Section 10 phase 3 / Section 5's System
// Configuration): the app blocks normal use until a Super Admin account
// exists and at least one active StorageLocation is configured — see
// SystemConfig.setupCompletedAt in prisma/schema.prisma.

// Same policy as login (Section 5's login security baseline) — this is
// the first real place a password actually gets set, so it's enforced here.
const MIN_PASSWORD_LENGTH = 10;

// Once true, setup can never become "not complete" again during normal
// operation — cache it so proxy.ts isn't hitting the DB on every request
// forever, just until the first time it's confirmed done.
let cachedSetupComplete = false;

export async function isSetupComplete(): Promise<boolean> {
  if (cachedSetupComplete) return true;
  const config = await prisma.systemConfig.findFirst();
  if (config?.setupCompletedAt) {
    cachedSetupComplete = true;
    return true;
  }
  return false;
}

export async function getSetupStatus() {
  const [config, superAdmin, activeStorage] = await Promise.all([
    prisma.systemConfig.findFirst(),
    prisma.user.findFirst({ where: { role: "super_admin" } }),
    prisma.storageLocation.findFirst({ where: { isActive: true } }),
  ]);
  return {
    isComplete: !!config?.setupCompletedAt,
    hasSuperAdmin: !!superAdmin,
    hasActiveStorageLocation: !!activeStorage,
  };
}

type ActionResult = { ok: true } | { ok: false; error: string };

export async function createSuperAdmin(name: string, email: string, password: string): Promise<ActionResult> {
  const status = await getSetupStatus();
  if (status.hasSuperAdmin) {
    return { ok: false, error: "A Super Admin account already exists." };
  }

  const trimmedName = name.trim();
  if (!trimmedName) {
    return { ok: false, error: "Name is required." };
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.includes("@")) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  const existingEmail = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existingEmail) {
    return { ok: false, error: "That email is already in use." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const superAdmin = await prisma.user.create({
    data: { name: trimmedName, email: normalizedEmail, passwordHash, role: "super_admin" },
  });

  // No one else to attribute this to — the Super Admin is both actor and
  // subject of their own bootstrap event.
  await prisma.activityLog.create({
    data: {
      userId: superAdmin.id,
      agencyId: null,
      action: "super_admin_created",
      note: "Created during first-run setup",
    },
  });

  return { ok: true };
}

export async function addInitialStorageLocation(storagePath: string, label: string): Promise<ActionResult> {
  const status = await getSetupStatus();
  if (!status.hasSuperAdmin) {
    return { ok: false, error: "Create the Super Admin account first." };
  }
  if (status.hasActiveStorageLocation) {
    return { ok: false, error: "A storage location has already been configured." };
  }

  const trimmedPath = storagePath.trim();
  if (!trimmedPath) {
    return { ok: false, error: "Storage path is required." };
  }

  if (!isDifferentDisk(process.cwd(), trimmedPath)) {
    return {
      ok: false,
      error:
        "This path is on the same disk as the app itself. Choose a path on a different physical disk (Section 5) — a second internal drive, an external drive, or a network path.",
    };
  }

  try {
    ensureWritableDirectory(trimmedPath);
  } catch (error) {
    return {
      ok: false,
      error: `Couldn't create or write to that path: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }

  let storageLocation;
  try {
    storageLocation = await prisma.storageLocation.create({
      data: { path: trimmedPath, label: label.trim() || trimmedPath, isActive: true, isReachable: true },
    });
  } catch (error) {
    // Backstop for the hasActiveStorageLocation check above, which reads
    // then writes with no transaction between the two — under genuine
    // concurrent submissions, both could pass that check before either
    // commits. A partial unique index on StorageLocation(isActive) WHERE
    // isActive = 1 (migration 20260809055955) makes the database itself
    // reject a second one; P2002 is Prisma's code for that constraint
    // violation, verified empirically against this exact index.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return { ok: false, error: "A storage location has already been configured." };
    }
    throw error;
  }

  const now = new Date();
  const existingConfig = await prisma.systemConfig.findFirst();
  if (existingConfig) {
    await prisma.systemConfig.update({ where: { id: existingConfig.id }, data: { setupCompletedAt: now } });
  } else {
    await prisma.systemConfig.create({ data: { setupCompletedAt: now } });
  }

  const superAdmin = await prisma.user.findFirst({ where: { role: "super_admin" } });
  if (superAdmin) {
    await prisma.activityLog.create({
      data: {
        userId: superAdmin.id,
        agencyId: null,
        action: "storage_location_added",
        note: `Initial storage location "${storageLocation.label}" added; setup completed`,
      },
    });
  }

  cachedSetupComplete = true;
  return { ok: true };
}
