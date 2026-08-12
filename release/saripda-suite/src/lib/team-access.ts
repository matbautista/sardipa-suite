import { getScopedPrisma } from "@/lib/tenant-db";

// Manager/Head cross-agent visibility (Section 10 phase 12 / Section 3's
// permissions table + sub-team scoping). A Manager's scope is themselves
// plus every agent with managerId pointing at them; a Head's scope is the
// whole agency. Agents never reach any /team/* page — proxy.ts gates that.
//
// Design choice: rather than teaching every existing lib function (leads.ts,
// policies.ts, documents.ts, the five *-details.ts files) a second
// "caller vs. record owner" check, detail pages resolve *which owner's
// records the caller may touch* once, up front, then call the existing
// "my own records" functions with that resolved owner id instead of the
// caller's own id. Every one of those functions' `ownerId !== callerId`
// check still does real work — it just receives the record's actual owner
// (already verified accessible) rather than always being the caller.
// Record-lock calls are the one exception: those must keep using the real
// caller's id, since a lock has to say who is actually editing, not whose
// records they're allowed to touch.

export async function getTeamMemberIds(agencyId: string, callerId: string, role: string): Promise<string[]> {
  if (role === "head") {
    const scoped = getScopedPrisma(agencyId);
    const users = await scoped.user.findMany({ where: { role: { in: ["manager", "agent", "head"] } }, select: { id: true } });
    return users.map((u) => u.id);
  }
  if (role === "manager") {
    const scoped = getScopedPrisma(agencyId);
    const agents = await scoped.user.findMany({ where: { managerId: callerId }, select: { id: true } });
    return [callerId, ...agents.map((a) => a.id)];
  }
  return [callerId];
}

/**
 * Same scope as getTeamMemberIds, but returns {id, name, role} for building
 * filter dropdowns and the leaderboard — those need names, not just ids.
 */
export async function listTeamMembers(agencyId: string, callerId: string, role: string) {
  const ids = await getTeamMemberIds(agencyId, callerId, role);
  const scoped = getScopedPrisma(agencyId);
  const users = await scoped.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  return users;
}

/** Returns the record's ownerId if `callerId`/`role` may access it, else null. */
export async function resolveAccessibleOwner(
  agencyId: string,
  callerId: string,
  role: string,
  recordOwnerId: string | null
): Promise<string | null> {
  if (!recordOwnerId) return null;
  if (recordOwnerId === callerId) return recordOwnerId;
  if (role === "head") return recordOwnerId;
  if (role === "manager") {
    const scoped = getScopedPrisma(agencyId);
    const owner = await scoped.user.findUnique({ where: { id: recordOwnerId } });
    if (owner && owner.managerId === callerId) return recordOwnerId;
  }
  return null;
}
