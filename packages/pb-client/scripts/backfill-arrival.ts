/**
 * One-off migration: derive `arrival` + `justified` from the legacy `status`
 * enum on every attendance record. Idempotent — re-running it never overwrites
 * a record that already has `arrival` populated.
 *
 * Usage:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... pnpm tsx packages/pb-client/scripts/backfill-arrival.ts
 *
 * Flags:
 *   --dry-run         Show what would change, write nothing.
 *   --per-page=N      Records per page (default 50).
 *   --no-sort         Skip the -date sort (faster on free-tier PB instances).
 *   --request-timeout=ms   Per-request timeout (default 30000).
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

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

// Wrap any promise with a hard timeout — PB hangs silently if the request
// stalls (free-tier cold boots, dropped connections), so we surface that as
// an explicit error instead of letting the script wait forever.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const noSort = process.argv.includes("--no-sort");
  const perPage = parseInt(parseFlag("per-page", "50"), 10);
  const requestTimeout = parseInt(parseFlag("request-timeout", "30000"), 10);
  const email = process.env.PB_ADMIN_EMAIL;
  const password = process.env.PB_ADMIN_PASSWORD;
  if (!email || !password) {
    console.error("PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD env vars are required.");
    process.exit(1);
  }

  const pb = new PocketBase(PB_URL);
  // Sequential script — disable PB's auto-cancellation of duplicate requests
  // so identical-URL retries don't accidentally cancel each other.
  pb.autoCancellation(false);

  console.log(`[backfill] config: dryRun=${dryRun}, perPage=${perPage}, noSort=${noSort}, timeout=${requestTimeout}ms`);
  console.log(`[backfill] authenticating as ${email}...`);
  await withTimeout(
    pb.collection("_superusers").authWithPassword(email, password),
    requestTimeout,
    "auth",
  );
  console.log(`[backfill] authenticated ✓`);

  console.log(`[backfill] ${dryRun ? "DRY RUN" : "WRITING"} — fetching attendance records from ${PB_URL}`);

  let page = 1;
  let totalScanned = 0;
  let totalNeedsUpdate = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  const listOpts = noSort ? {} : { sort: "-date" };

  while (true) {
    console.log(`[backfill] fetching page ${page} (perPage=${perPage})...`);
    const result = await withTimeout(
      pb.collection("attendance").getList(page, perPage, listOpts),
      requestTimeout,
      `getList page ${page}`,
    );
    console.log(`[backfill] page ${page}: ${result.items.length} records (totalPages=${result.totalPages})`);
    const items = result.items as unknown as AttendanceRecord[];
    if (items.length === 0) break;

    for (const rec of items) {
      totalScanned++;

      // Skip if already migrated. PB defaults a newly-added select field to
      // "" (empty string) for existing rows, so treat null/undefined/"" as
      // "not yet migrated" — the canonical marker is one of the three valid
      // arrival enum values.
      const isMigrated =
        rec.arrival === "present" ||
        rec.arrival === "late" ||
        rec.arrival === "absent";
      if (isMigrated) {
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
        await withTimeout(
          pb.collection("attendance").update(rec.id, {
            arrival: split.arrival,
            justified: split.justified,
          }),
          requestTimeout,
          `update ${rec.id}`,
        );
        totalUpdated++;
        if (totalUpdated % 25 === 0) {
          console.log(`[backfill] ...${totalUpdated} records updated so far`);
        }
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
