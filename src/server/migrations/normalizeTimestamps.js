#!/usr/bin/env node
const PocketBase = require("pocketbase").default || require("pocketbase");

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || args.includes("-n");

  const PB_URL = process.env.PB_URL || process.env.NEXT_PUBLIC_PB_URL || "";
  const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
  const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

  if (!PB_URL) {
    console.error("PB_URL is required");
    process.exit(1);
  }

  const pb = new PocketBase(PB_URL);

  if (PB_ADMIN_EMAIL && PB_ADMIN_PASSWORD) {
    try {
      await pb.admins.authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
      console.log("Authenticated as admin");
    } catch (err) {
      console.error("Admin auth failed:", err);
      process.exit(1);
    }
  } else {
    console.warn("No admin credentials provided — ensure collection write permissions allow updates.");
  }

  console.log("Fetching learners...");
  const learners = await pb.collection("learners").getFullList();
  console.log(`Found ${learners.length} learners`);

  let updated = 0;
  for (const l of learners) {
    const updates = {};
    const timeIn = l.time_in;
    const timeOut = l.time_out;

    if (timeIn) {
      const d = new Date(timeIn);
      if (!Number.isNaN(d.getTime())) {
        const iso = d.toISOString();
        if (iso !== timeIn) updates.time_in = iso;
      }
    }

    if (timeOut) {
      const d = new Date(timeOut);
      if (!Number.isNaN(d.getTime())) {
        const iso = d.toISOString();
        if (iso !== timeOut) updates.time_out = iso;
      }
    }

    if (Object.keys(updates).length > 0) {
      if (dryRun) {
        console.log(`[dry-run] Would update ${l.id}:`, updates);
      } else {
        try {
          await pb.collection("learners").update(l.id, updates);
          updated += 1;
          console.log(`Updated ${l.id}:`, updates);
          await new Promise((r) => setTimeout(r, 100));
        } catch (err) {
          console.error(`Failed to update ${l.id}:`, err);
        }
      }
    }
  }

  if (dryRun) {
    console.log(`Dry-run complete — ${updated} records would have been updated (no writes performed).`);
  } else {
    console.log(`Migration complete — updated ${updated} records.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
