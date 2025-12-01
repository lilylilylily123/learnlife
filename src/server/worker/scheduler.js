#!/usr/bin/env node
const { markAbsent, markLunchLate } = require("../jobs/scheduledAttendance");

function minutesUntilNext(hour, minute) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return Math.round((target - now) / (1000 * 60));
}

function scheduleDaily(fn, hour, minute, name) {
  const minutes = minutesUntilNext(hour, minute);
  console.log(`[scheduler] next run for ${name} in ${minutes} minutes`);
  setTimeout(async () => {
    try {
      console.log(`[scheduler] running ${name} at ${new Date().toISOString()}`);
      await fn({ dryRun: process.env.DRY_RUN === "true" });
    } catch (err) {
      console.error(`[scheduler] ${name} failed:`, err.message || err);
    } finally {
      // schedule next day
      scheduleDaily(fn, hour, minute, name);
    }
  }, minutes * 60 * 1000);
}

async function main() {
  const testMode = process.env.TEST_MODE === "true" || process.argv.includes("--test");
  const dryRun = process.env.DRY_RUN === "true" || process.argv.includes("--dry-run");

  if (testMode) {
    console.log("[scheduler] TEST_MODE enabled — running jobs immediately (dryRun=%s)", dryRun);
    await markAbsent({ dryRun });
    await markLunchLate({ dryRun });
    if (process.argv.includes("--exit-after-test")) {
      console.log("[scheduler] exiting after test run");
      process.exit(0);
    }
  }

  // Morning absent check at 10:05 local time
  scheduleDaily(markAbsent, 10, 5, "markAbsent");

  // Lunch late check at 14:05 local time
  scheduleDaily(markLunchLate, 14, 5, "markLunchLate");

  console.log("[scheduler] scheduler started — waiting for scheduled times");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
