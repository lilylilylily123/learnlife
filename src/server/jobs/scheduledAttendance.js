#!/usr/bin/env node
const PocketBase = require("pocketbase").default || require("pocketbase");

async function connectPB() {
  const PB_URL = process.env.PB_URL || process.env.NEXT_PUBLIC_PB_URL || "https://learnlife.pockethost.io/";
  const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
  const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;
  const pb = new PocketBase(PB_URL);
  if (PB_ADMIN_EMAIL && PB_ADMIN_PASSWORD) {
    try {
      await pb.admins.authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
      console.log("[scheduledAttendance] authenticated as admin");
    } catch (err) {
      console.warn("[scheduledAttendance] admin auth failed, continuing unauthenticated:", err.message || err);
    }
  }
  return pb;
}

async function markAbsent({ dryRun = false } = {}) {
  const pb = await connectPB();
  console.log("[markAbsent] fetching learners...");
  const learners = await pb.collection("learners").getFullList();
  const now = new Date();
  const results = { checked: 0, updated: 0, skipped: 0 };

  for (const l of learners) {
    results.checked += 1;
    const timeIn = l.time_in;
    const status = l.status;
    if (!timeIn || timeIn === "") {
      // mark absent if not already absent
      if (status !== "Absent") {
        console.log(`[markAbsent] would mark ${l.id} (${l.name}) as Absent`);
        if (!dryRun) {
          try {
            await pb.collection("learners").update(l.id, { status: "Absent" });
            results.updated += 1;
            console.log(`[markAbsent] updated ${l.id}`);
          } catch (err) {
            console.error(`[markAbsent] failed to update ${l.id}:`, err.message || err);
          }
        }
      } else {
        results.skipped += 1;
      }
    }
  }

  console.log(`[markAbsent] done — checked ${results.checked}, updated ${results.updated}, skipped ${results.skipped}`);
  return results;
}

async function markLunchLate({ dryRun = false } = {}) {
  const pb = await connectPB();
  console.log("[markLunchLate] fetching learners...");
  const learners = await pb.collection("learners").getFullList();
  const results = { checked: 0, updated: 0, skipped: 0 };

  for (const l of learners) {
    results.checked += 1;
    const lunchOut = l.lunch_out;
    const lunchIn = l.lunch_in;
    const status = l.status;
    if (lunchOut && (!lunchIn || lunchIn === "")) {
      // returned late — mark Late
      if (status !== "Late") {
        console.log(`[markLunchLate] would mark ${l.id} (${l.name}) as Late`);
        if (!dryRun) {
          try {
            await pb.collection("learners").update(l.id, { status: "Late" });
            results.updated += 1;
            console.log(`[markLunchLate] updated ${l.id}`);
          } catch (err) {
            console.error(`[markLunchLate] failed to update ${l.id}:`, err.message || err);
          }
        }
      } else {
        results.skipped += 1;
      }
    }
  }

  console.log(`[markLunchLate] done — checked ${results.checked}, updated ${results.updated}, skipped ${results.skipped}`);
  return results;
}

module.exports = {
  markAbsent,
  markLunchLate,
};

// allow CLI runs for quick tests
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run") || args.includes("-n");
    const job = args.find((a) => a === "mark-absent" || a === "mark-lunch-late");
    try {
      if (!job || job === "mark-absent") await markAbsent({ dryRun });
      if (!job || job === "mark-lunch-late") await markLunchLate({ dryRun });
    } catch (err) {
      console.error(err);
    }
  })();
}
