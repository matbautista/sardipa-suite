import { getScopedPrisma } from "@/lib/tenant-db";

// Record Locking (Section 10 phase 8 / Section 5's Record Locking
// feature). Prevents two different people editing the same Lead/Policy at
// once. checkOut()/checkIn() are called only when a caller explicitly
// enters edit mode (the pages gate this behind a "?edit=1" state, added in
// a full-app review after finding that every page unconditionally checked
// a record out just to render it — even a Manager/Head merely opening a
// teammate's record to look, silently locking the actual owner out of
// their own record for up to 15 minutes. That contradicted Section 5's
// "viewing a record never requires a lock — only entering edit mode does."

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
  if (!lock) {
    return { locked: false };
  }
  if (isStale(lock.lastActivityAt)) {
    // Found in a full-app review: a stale lock was only ever treated as
    // unlocked, never actually removed — it sat in the table until the
    // next checkOut() happened to overwrite it. Now that plain viewing no
    // longer calls checkOut() at all, nothing was guaranteed to ever
    // overwrite it again, so a stale row could linger indefinitely.
    // Deleting it here (a plain read call) is safe: the row is provably
    // inert already (that's what "stale" means), so removing it changes
    // nothing about who's actually allowed to check the record out next.
    await scoped.recordLock.deleteMany({ where: { id: lock.id } });
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

// Server-side write guard (found missing in a full-app review): every
// mutating server action was disabling its own form in the UI whenever
// lockedByOther, but none of them re-checked that on the server before
// writing — so the lock had no actual enforcement effect against a direct
// POST (a stale tab, a replay, or the "inert" attribute simply not
// applying, e.g. a non-browser client). Every save/delete/activate/upload
// action below calls this first and bails out if someone else genuinely
// holds the lock. Deliberately keyed on "locked by a different, non-stale
// holder" rather than "locked by me" — a caller whose own lock expired
// mid-edit with nobody else claiming it should still be able to save; only
// a real conflict with someone else blocks the write.
export async function isLockedByOther(
  agencyId: string,
  callerId: string,
  recordType: string,
  recordId: string
): Promise<boolean> {
  const status = await getLockStatus(agencyId, callerId, recordType, recordId);
  return status.locked && !status.heldBySelf;
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
