// Next.js calls register() once per server instance, before it starts
// handling requests (Section 10 phase 9's "scheduled background job, runs
// daily, similar in spirit to the mailbox poller and disk-space check" —
// this app has no separate cron process, so the daily renewal/lapsing job
// is scheduled in-process here instead).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { runRenewalJob } = await import("@/lib/renewal-job");
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // Run once at boot too — a long-lived server only hits the interval
  // once every 24h, and restarts (deploys, the watchdog) shouldn't mean
  // waiting up to a full day before overdue policies get evaluated.
  runRenewalJob().catch((error) => {
    console.error("[renewal-job] initial run failed:", error);
  });

  setInterval(() => {
    runRenewalJob().catch((error) => {
      console.error("[renewal-job] scheduled run failed:", error);
    });
  }, ONE_DAY_MS);

  // Website Inquiry Intake (Section 10 phase 14 / Section 5 point 3): "the
  // CRM host polls each configured mailbox every 5 minutes over IMAP ...
  // a fixed interval for MVP." Same boot-plus-interval shape as the
  // renewal job above, for the same reason — a restart shouldn't mean
  // waiting a full cycle before the first poll happens.
  const { pollAllMailboxes } = await import("@/lib/email-intake");
  const FIVE_MINUTES_MS = 5 * 60 * 1000;

  pollAllMailboxes().catch((error) => {
    console.error("[email-intake] initial poll failed:", error);
  });

  setInterval(() => {
    pollAllMailboxes().catch((error) => {
      console.error("[email-intake] scheduled poll failed:", error);
    });
  }, FIVE_MINUTES_MS);

  // Proactive disk-space/reachability monitoring (Section 10 phase 15 /
  // Section 9's Self-Healing: "checked periodically ... rather than only
  // discovered on write failure"). Same boot-plus-interval shape as the
  // jobs above.
  const { checkAllStorageLocations } = await import("@/lib/storage-health");
  const STORAGE_CHECK_INTERVAL_MS = Number(process.env.STORAGE_HEALTH_CHECK_INTERVAL_MS ?? FIVE_MINUTES_MS);

  checkAllStorageLocations().catch((error) => {
    console.error("[storage-health] initial check failed:", error);
  });

  setInterval(() => {
    checkAllStorageLocations().catch((error) => {
      console.error("[storage-health] scheduled check failed:", error);
    });
  }, STORAGE_CHECK_INTERVAL_MS);
}
