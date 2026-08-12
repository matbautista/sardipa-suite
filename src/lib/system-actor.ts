import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

// Shared by every automated code path (the daily renewal job, the email
// intake poller) that needs to write an ActivityLog entry with no real user
// behind it — Section 5's Audit/Activity Log requirement doesn't carve out
// an exception for automated changes: "every create/update/delete on a
// Lead ... Policy ... is written to ActivityLog" applies here exactly as
// much as to a human-triggered one. Originally lived only in
// renewal-job.ts; moved here once email-intake.ts needed the exact same
// reserved actor rather than duplicating the race-safe get-or-create logic.

const SYSTEM_ACTOR_EMAIL = "system@saripda.internal";

// Gets or lazily creates the reserved system-actor User row that automated
// jobs attribute their ActivityLog writes to. isActive: false makes it
// permanently unable to log in (verifyCredentials's isActive check runs
// before any password comparison) — this account exists purely as an
// ActivityLog.userId target, never as a real login. agencyId is left null,
// same as Super Admin: this actor sits outside every agency, since the jobs
// that use it run host-wide or across a poll that isn't itself a session.
export async function getSystemActorId(): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { email: SYSTEM_ACTOR_EMAIL } });
  if (existing) return existing.id;
  try {
    const created = await prisma.user.create({
      data: {
        name: "System (automated)",
        email: SYSTEM_ACTOR_EMAIL,
        // Random, not a real bcrypt hash — isActive: false already blocks
        // login before this would ever be compared against, but there's no
        // reason for it to even look like a usable credential.
        passwordHash: randomBytes(32).toString("hex"),
        role: "system",
        isActive: false,
      },
    });
    return created.id;
  } catch (error) {
    // Two overlapping calls (e.g. instrumentation.ts's register() firing
    // more than once — Next.js dev fast-refresh, or an overlapping
    // watchdog-triggered restart, or the renewal job and an email poll
    // racing each other) can both see `existing` as null above and race to
    // create this row; email is @unique, so the loser gets Prisma's P2002
    // instead of a duplicate row. Re-fetch the winner's row rather than
    // letting the whole caller fail on it.
    const isDuplicateEmail =
      typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
    if (isDuplicateEmail) {
      const winner = await prisma.user.findUnique({ where: { email: SYSTEM_ACTOR_EMAIL } });
      if (winner) return winner.id;
    }
    throw error;
  }
}
