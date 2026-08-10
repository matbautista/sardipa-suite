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
}
