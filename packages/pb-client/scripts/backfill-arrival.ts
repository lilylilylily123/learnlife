/**
 * One-off migration: derive `arrival` + `justified` from the legacy `status`
 * enum on every attendance record. Idempotent — re-running it never overwrites
 * a record that already has `arrival` populated.
 *
 * Usage:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... pnpm tsx packages/pb-client/scripts/backfill-arrival.ts
 *
 * Flags:
 *   --dry-run   Show what would change, write nothing.
 *
 * Status → split mapping:
 *   present  → { arrival: present, justified: false }
 *   late     → { arrival: late,    justified: false }
 *   absent   → { arrival: absent,  justified: false }
 *   jLate    → { arrival: late,    justified: true  }
 *   jAbsent  → { arrival: absent,  justified: true  }
 *   null     → { arrival: null,    justified: false }
 */
import PocketBase from "pocketbase";
import { PB_URL } from "../src/constants";
import type { AttendanceRecord } from "../src/types";

interface Split {
  arrival: "present" | "late" | "absent" | null;
  justified: boolean;
}

function splitStatus(status: string | null | undefined): Split {
  switch (status) {
    case "present": return { arrival: "present", justified: false };
    case "late":    return { arrival: "late",    justified: false };
    case "absent":  return { arrival: "absent",  justified: false };
    case "jLate":   return { arrival: "late",    justified: true };
    case "jAbsent": return { arrival: "absent",  justified: true };
    default:        return { arrival: null,      justified: false };
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const email = process.env.PB_ADMIN_EMAIL;
  const password = process.env.PB_ADMIN_PASSWORD;
  if (!email || !password) {
    console.error("PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD env vars are required.");
    process.exit(1);
  }

  const pb = new PocketBase(PB_URL);
  await pb.collection("_superusers").authWithPassword(email, password);

  console.log(`[backfill] ${dryRun ? "DRY RUN" : "WRITING"} — fetching attendance records from ${PB_URL}`);

  // Page through all records — perPage 200 keeps each request small.
  let page = 1;
  const perPage = 200;
  let totalScanned = 0;
  let totalNeedsUpdate = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  while (true) {
    const result = await pb.collection("attendance").getList(page, perPage, { sort: "-date" });
    const items = result.items as unknown as AttendanceRecord[];
    if (items.length === 0) break;

    for (const rec of items) {
      totalScanned++;

      // Skip if already migrated. `arrival` being set is the canonical marker.
      if (rec.arrival !== null && rec.arrival !== undefined) {
        totalSkipped++;
        continue;
      }

      const split = splitStatus(rec.status);

      // If the legacy status was null too, this record has nothing to migrate.
      if (split.arrival === null) {
        totalSkipped++;
        continue;
      }

      totalNeedsUpdate++;

      if (dryRun) {
        console.log(
          `[backfill] would update ${rec.id}: status="${rec.status}" → arrival="${split.arrival}", justified=${split.justified}`,
        );
        continue;
      }

      try {
        await pb.collection("attendance").update(rec.id, {
          arrival: split.arrival,
          justified: split.justified,
        });
        totalUpdated++;
      } catch (err) {
        console.error(`[backfill] failed to update ${rec.id}:`, err);
      }
    }

    if (page >= result.totalPages) break;
    page++;
  }

  console.log(`[backfill] scanned ${totalScanned} records`);
  console.log(`[backfill] skipped ${totalSkipped} (already migrated or null status)`);
  console.log(`[backfill] would-update ${totalNeedsUpdate}`);
  if (!dryRun) console.log(`[backfill] updated ${totalUpdated}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
