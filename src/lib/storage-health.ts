import fs from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import type { StorageLocation } from "@/generated/prisma/client";

// Proactive disk-space/reachability monitoring (Section 9's Self-Healing:
// "each storage location's free space is checked periodically ... rather
// than only discovered on write failure") plus the shared error
// classification used by an actual write failure when it does happen
// (documents.ts, src/app/api/documents/[id]/route.ts).

const BYTES_PER_GB = 1024 ** 3;

// "<500MB" (Section 9's failure-point table) and "e.g. at 90% used"
// (Section 9's Self-Healing section) are two separate thresholds mentioned
// in the plan — either one tripping counts as low space. Configurable via
// env vars, same "sensible defaults, adjustable" shape as watchdog.mjs's
// tunables (Section 9's "System Configuration additions"); no settings UI
// for these, consistent with how those are exposed today.
const LOW_SPACE_THRESHOLD_BYTES = Number(process.env.STORAGE_LOW_SPACE_THRESHOLD_BYTES ?? 500 * 1024 * 1024);
const LOW_SPACE_USED_FRACTION = Number(process.env.STORAGE_LOW_SPACE_USED_PERCENT ?? 90) / 100;

export type StorageSpaceInfo = { freeBytes: number; totalBytes: number; usedFraction: number };

export async function getStorageSpaceInfo(targetPath: string): Promise<StorageSpaceInfo> {
  const stat = await fs.statfs(targetPath);
  const freeBytes = stat.bavail * stat.bsize;
  const totalBytes = stat.blocks * stat.bsize;
  return { freeBytes, totalBytes, usedFraction: totalBytes > 0 ? 1 - stat.bavail / stat.blocks : 0 };
}

function isLowSpace(info: StorageSpaceInfo): boolean {
  return info.freeBytes < LOW_SPACE_THRESHOLD_BYTES || info.usedFraction >= LOW_SPACE_USED_FRACTION;
}

// SystemAlert has no storageLocationId column (Section 6) — the location
// is identified by embedding its id in the message as a parseable prefix
// instead, so raise/resolve can target one specific location's alert
// without conflating it with another location's. stripLocationMarker()
// below is what the System Health page uses to hide this from the human
// reading the message.
type StorageAlertType = "storage_full" | "storage_unreachable";

function locationMarker(locationId: string): string {
  return `[location:${locationId}]`;
}

export function stripLocationMarker(message: string): string {
  return message.replace(/^\[location:[^\]]+\]\s*/, "");
}

export async function raiseStorageAlert(
  location: Pick<StorageLocation, "id" | "label">,
  type: StorageAlertType,
  detail: string
): Promise<void> {
  const marker = locationMarker(location.id);
  const existing = await prisma.systemAlert.findFirst({
    where: { agencyId: null, type, resolvedAt: null, message: { startsWith: marker } },
  });
  if (existing) return;
  await prisma.systemAlert.create({ data: { agencyId: null, type, message: `${marker} ${detail}` } });
}

export async function resolveStorageAlerts(location: Pick<StorageLocation, "id">, type: StorageAlertType): Promise<void> {
  const marker = locationMarker(location.id);
  await prisma.systemAlert.updateMany({
    where: { agencyId: null, type, resolvedAt: null, message: { startsWith: marker } },
    data: { resolvedAt: new Date() },
  });
}

// Classifies a filesystem error the way Section 9's failure table splits
// them: ENOSPC is unambiguously "the disk is full"; everything else that
// looks like "couldn't reach the path at all" (missing drive, network
// drive dropped, I/O/timeout) is "unreachable" rather than "full" — an
// unreachable drive's actual free space is unknown, not zero.
export function classifyFsError(error: unknown): "full" | "unreachable" | "other" {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOSPC") return "full";
  if (code && ["ENOENT", "ENOTDIR", "EIO", "ETIMEDOUT", "ENETUNREACH", "EACCES", "EBUSY", "ECONNREFUSED", "ESTALE"].includes(code)) {
    return "unreachable";
  }
  return "other";
}

async function checkStorageLocation(location: StorageLocation): Promise<void> {
  try {
    const info = await getStorageSpaceInfo(location.path);
    await prisma.storageLocation.update({ where: { id: location.id }, data: { isReachable: true, lastCheckedAt: new Date() } });
    await resolveStorageAlerts(location, "storage_unreachable");

    if (isLowSpace(info)) {
      const freeGb = (info.freeBytes / BYTES_PER_GB).toFixed(1);
      const pctUsed = Math.round(info.usedFraction * 100);
      await raiseStorageAlert(
        location,
        "storage_full",
        `Storage location "${location.label}" is running low on space — ${freeGb} GB free (${pctUsed}% used). Add a new storage location before it fills completely (Section 5).`
      );
    } else {
      await resolveStorageAlerts(location, "storage_full");
    }
  } catch (error) {
    await prisma.storageLocation
      .update({ where: { id: location.id }, data: { isReachable: false, lastCheckedAt: new Date() } })
      .catch(() => {});
    // Reachability, not fullness, is the live problem now — an unreachable
    // drive can't be confirmed full or not, so don't leave a stale
    // storage_full alert open on top of the new storage_unreachable one.
    await resolveStorageAlerts(location, "storage_full");
    const message = error instanceof Error ? error.message : "Unknown error";
    await raiseStorageAlert(
      location,
      "storage_unreachable",
      `Storage location "${location.label}" is unreachable — the drive may be disconnected (${message}).`
    );
  }
}

export async function checkAllStorageLocations(): Promise<void> {
  const locations = await prisma.storageLocation.findMany();
  for (const location of locations) {
    await checkStorageLocation(location).catch((error) => {
      console.error(`[storage-health] check failed for "${location.label}":`, error);
    });
  }
}
