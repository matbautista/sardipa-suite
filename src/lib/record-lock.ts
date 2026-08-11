import { getScopedPrisma } from "@/lib/tenant-db";

// Record Locking (Section 10 phase 8 / Section 5's Record Locking
// feature). Prevents two different people editing the same Lead/Policy at
// once. Opening a record's edit page immediately checks it out — there's
// no separate "view only" mode yet, since today only a lead's owner can
// even reach its edit page (phase 7's ownership scoping), so there's no
// uninvolved viewer to spare from taking a lock. That distinction becomes
// meaningful once Manager/Head can open a teammate's record without
// editing it (phase 12) — which is exactly what forceRelease() below is
// for. It was originally deferred with the reasoning "there's no page
// where a Manager/Head can reach another agent's lock yet," but phase 12
// shipped that reachability and this function was never actually added —
// caught in a full-app review as a stale deferral, not a still-current one.

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

// Manager/Head force-release override (Section 5: "a Manager can
// force-release a stuck lock on their own team's records; Agency Head can
// do it for any record in the agency — in case the timeout hasn't hit yet
// and someone genuinely needs in"). Unlike checkIn, this releases
// regardless of who holds it — deliberately no `lockedBy` filter. Trusts
// the caller already verified the record itself is within the actor's
// team scope (same "resolve once, trust downstream" shape as everywhere
// else — the page calling this already had to resolve that to render the
// record at all), so it takes no role/ownership arguments of its own.
export async function forceRelease(
  agencyId: string,
  actorId: string,
  recordType: string,
  recordId: string
): Promise<void> {
  const scoped = getScopedPrisma(agencyId);
  await scoped.recordLock.deleteMany({ where: { recordType, recordId } });
  await scoped.activityLog.create({
    data: {
      userId: actorId,
      leadId: recordType === "lead" ? recordId : null,
      policyId: recordType === "policy" ? recordId : null,
      action: "lock_force_released",
      note: null,
    },
  });
}
