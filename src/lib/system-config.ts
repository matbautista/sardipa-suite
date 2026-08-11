import { prisma } from "@/lib/prisma";

// System Configuration (Super Admin) — Section 5: "a settings page where
// you can specify/update the host PC or laptop's IP address (and port, if
// needed) ... the app uses this stored value to display the LAN URL ...
// rather than it being hardcoded ... Changing it here doesn't reconfigure
// the network itself (that's still done at the OS/router level per
// Section 8) — it just tells the app what address to advertise to users."
//
// The first-run wizard (phase 3) already guarantees exactly one
// SystemConfig row exists by the time this page is reachable (setup can't
// complete without it) — see src/lib/setup.ts.

type ActionResult = { ok: true } | { ok: false; error: string };

export async function getHostAddress(): Promise<{ hostIp: string | null; hostPort: number | null }> {
  const config = await prisma.systemConfig.findFirst();
  return { hostIp: config?.hostIp ?? null, hostPort: config?.hostPort ?? null };
}

export function buildLanUrl(hostIp: string | null, hostPort: number | null): string | null {
  if (!hostIp) return null;
  return `http://${hostIp}:${hostPort ?? 3000}`;
}

export async function updateHostAddress(hostIp: string, hostPort: string): Promise<ActionResult> {
  const trimmedIp = hostIp.trim();
  if (!trimmedIp) {
    return { ok: false, error: "Host IP address is required." };
  }

  let port: number | null = null;
  if (hostPort.trim()) {
    port = Number(hostPort.trim());
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: "Enter a valid port number, or leave it blank for the default (3000)." };
    }
  }

  const existing = await prisma.systemConfig.findFirst();
  if (existing) {
    await prisma.systemConfig.update({ where: { id: existing.id }, data: { hostIp: trimmedIp, hostPort: port } });
  } else {
    // Defensive only — the first-run wizard always creates this row before
    // this page is reachable (isSetupComplete() gates every other route).
    await prisma.systemConfig.create({ data: { hostIp: trimmedIp, hostPort: port } });
  }

  return { ok: true };
}
