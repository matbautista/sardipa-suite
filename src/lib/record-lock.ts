import { getScopedPrisma } from "@/lib/tenant-db";

// Record Locking (Section 10 phase 8 / Section 5's Record Locking
// feature). Prevents two different people editing the same Lead/Policy at
// once. Opening a record's edit page immediately checks it out — there's
// no separate "view only" mode yet, since today only a lead's owner can
// even reach its edit page (phase 7's ownership scoping), so there's no
// uninvolved viewer to spare from taking a lock. That distinction becomes
// meaningful once Manager/Head can open a teammate's record without
// editing it (phase 12) — the Manager/Head force-release override from
// Section 5 is deliberately not built here yet for the same reason: there
// is no page where a Manager/Head can reach another agent's lock to
// force-release it until that phase lands.

const LOCK_TIMEOUT_MINUTES = 15;

export type LockStatus =
  | { locked: false }
  | { locked: true; holderId: string; holderName: string; lockedAt: Date; heldBySelf: boolean };

function isStale(lastActivityAt: Date): boolean {
  return Date.now() - lastActivityAt.getTime() > LOCK_TIMEOUT_MINUTES * 60 * 1000;
}

export async function getLockStatus(
  agencyId: string,
  callerId: string,
  recordType: string,
  recordId: string
): Promise<LockStatus> {
  const scoped = getScopedPrisma(agencyId);
  const lock = await scoped.recordLock.findFirst({
    where: { recordType, recordId },
    include: { holder: true },
  });
  if (!lock || isStale(lock.lastActivityAt)) {
    return { locked: false };
  }
  return {
    locked: true,
    holderId: lock.lockedBy,
    holderName: lock.holder.name,
    lockedAt: lock.lockedAt,
    heldBySelf: lock.lockedBy === callerId,
  };
}

// Acquires or refreshes the lock for callerId. Only call this once the
// caller is confirmed allowed to edit the record and getLockStatus has
// confirmed it isn't held (not-stale) by someone else — this function
// trusts that check rather than repeating it, so a genuine conflict is
// never silently overridden here.
export async function checkOut(agencyId: string, callerId: string, recordType: string, recordId: string): Promise<void> {
  const scoped = getScopedPrisma(agencyId);
  const existing = await scoped.recordLock.findFirst({ where: { recordType, recordId } });

  if (existing) {
    if (existing.lockedBy === callerId) {
      await scoped.recordLock.update({ where: { id: existing.id }, data: { lastActivityAt: new Date() } });
    } else if (isStale(existing.lastActivityAt)) {
      await scoped.recordLock.update({
        where: { id: existing.id },
        data: { lockedBy: callerId, lockedAt: new Date(), lastActivityAt: new Date() },
      });
    }
    return;
  }

  try {
    await scoped.recordLock.create({ data: { agencyId, recordType, recordId, lockedBy: callerId } });
  } catch {
    // Unique constraint race: someone else's checkOut landed first between
    // this function's own findFirst and create. Leave their lock alone —
    // the caller sees the conflict next time it re-reads lock status.
  }
}

export async function checkIn(agencyId: string, callerId: string, recordType: string, recordId: string): Promise<void> {
  const scoped = getScopedPrisma(agencyId);
  await scoped.recordLock.deleteMany({ where: { recordType, recordId, lockedBy: callerId } });
}
