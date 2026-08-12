import fs from "node:fs";
import path from "node:path";

/**
 * "Different disk" check for the first-run storage location (Section 5):
 * resolves a value that's equal for two paths if and only if they're on
 * the same physical disk/volume.
 *
 * - Windows: compare drive letters (a network/UNC path never shares one,
 *   so it passes automatically without needing its own check).
 * - POSIX: compare the filesystem device id (st_dev) — network mounts
 *   (NFS/SMB) naturally get their own device id too.
 */
function getVolumeId(targetPath: string): string {
  if (process.platform === "win32") {
    if (/^\\\\/.test(targetPath)) {
      return `unc:${targetPath.toLowerCase()}`;
    }
    const driveMatch = /^([a-zA-Z]):/.exec(path.resolve(targetPath));
    if (driveMatch) {
      return `drive:${driveMatch[1].toUpperCase()}`;
    }
  }
  return `dev:${fs.statSync(nearestExistingAncestor(targetPath)).dev}`;
}

/** Walks up from targetPath until it finds a directory that actually exists. */
function nearestExistingAncestor(targetPath: string): string {
  let current = path.resolve(targetPath);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`No existing ancestor directory found for "${targetPath}"`);
    }
    current = parent;
  }
  return current;
}

export function isDifferentDisk(appPath: string, candidatePath: string): boolean {
  return getVolumeId(appPath) !== getVolumeId(candidatePath);
}

/** Human-readable label for the app's own volume, for the setup wizard's hint text. */
export function describeVolume(targetPath: string): string {
  if (process.platform === "win32") {
    const driveMatch = /^([a-zA-Z]):/.exec(path.resolve(targetPath));
    if (driveMatch) return `drive ${driveMatch[1].toUpperCase()}:`;
  }
  return path.resolve(targetPath);
}

/** Creates the directory if needed and confirms it's actually writable. */
export function ensureWritableDirectory(targetPath: string): void {
  fs.mkdirSync(targetPath, { recursive: true });
  const testFile = path.join(targetPath, `.write-test-${Date.now()}`);
  fs.writeFileSync(testFile, "");
  fs.unlinkSync(testFile);
}
