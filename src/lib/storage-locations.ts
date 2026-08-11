import { prisma } from "@/lib/prisma";
import { isDifferentDisk, ensureWritableDirectory } from "@/lib/storage-path";

// Ongoing storage-location management (Section 10 phase 17 / Section 5's
// System Configuration: "Adding a location when storage fills up: rather
// than just repointing the one path (which would strand already-saved
// documents), the Super Admin can add a new storage location from this
// page ... and mark it as the active target for new uploads. Existing
// documents keep working from wherever they already are; only new
// uploads go to the newly added location.") Named for phase 3 in the
// plan's own build order but never actually built there — src/lib/setup.ts's
// addInitialStorageLocation() explicitly rejects a second location, since
// its whole job is the one-time first-run bootstrap. This is that missing
// "add another one later" flow, found while writing this phase's
// deployment guide and referencing a feature that turned out not to
// exist yet.

type ActionResult = { ok: true } | { ok: false; error: string };

export async function listStorageLocations() {
  return prisma.storageLocation.findMany({ orderBy: { addedAt: "asc" } });
}

export async function addStorageLocation(actorId: string, storagePath: string, label: string): Promise<ActionResult> {
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

  // "Exactly one is_active=true at a time" (Section 6) — deactivate the
  // current one(s) and create the new one as active inside a single
  // transaction, so the partial unique index on
  // StorageLocation(isActive) WHERE isActive = 1 (migration
  // 20260809055955) never sees two active rows even momentarily.
  const storageLocation = await prisma.$transaction(async (tx) => {
    await tx.storageLocation.updateMany({ where: { isActive: true }, data: { isActive: false } });
    return tx.storageLocation.create({
      data: { path: trimmedPath, label: label.trim() || trimmedPath, isActive: true, isReachable: true },
    });
  });

  await prisma.activityLog.create({
    data: {
      userId: actorId,
      agencyId: null,
      action: "storage_location_added",
      note: `Storage location "${storageLocation.label}" added and made active — existing documents on other locations are unaffected`,
    },
  });

  return { ok: true };
}
