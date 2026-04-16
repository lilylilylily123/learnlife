import { pb } from "../pb";
import * as pbClient from "@/lib/pb-client";
import type { AttendanceRecord } from "@/lib/pb-client";
import { withRetry, PROGRAM_CODES } from "@learnlife/pb-client";
import { computeCheckInAction } from "@learnlife/shared";

/**
 * Look up a learner by their NFC card UID.
 * Returns null if no learner is registered for this card.
 *
 * NOTE: This is a local duplicate of `pbClient.getLearnerByNfc`. The two
 * exist because this module was written before the shared query was extracted.
 * Prefer using `pbClient.getLearnerByNfc` in new code.
 */
export async function getLearnerByNfc(uid: string) {
  try {
    return await pb
      .collection("learners")
      .getFirstListItem(`NFC_ID = '${uid}'`);
  } catch {
    return null;
  }
}

/**
 * Create a new learner record.
 *
 * ⚠️  Bug: the `pb.collection("learners").create(...)` call is not awaited,
 * so errors are silently swallowed and the function returns before the record
 * is actually created. Add `await` to fix.
 *
 * Also note: the `program` parameter is ignored — "chmk" is always used as
 * the fallback when the program key is not found in PROGRAM_CODES.
 */
export async function createLearner(
  name: string,
  email: string,
  program: string,
  dob: string,
  NFC_ID: string,
) {
  const pr = PROGRAM_CODES[program as keyof typeof PROGRAM_CODES] || "chmk";

  // TODO: add `await` here so errors surface and the caller can react.
  pb.collection("learners").create({
    name,
    email,
    program: pr,
    dob,
    NFC_ID,
  });
  console.log("Learner Creating");
}

/**
 * Fetch the attendance record for a learner on the given date (defaults to today).
 * Returns null if no record exists yet.
 */
export async function getAttendanceForDate(
  learnerId: string,
  date?: string,
): Promise<AttendanceRecord | null> {
  try {
    const result = await pbClient.getAttendance(learnerId, date);
    return result.attendance;
  } catch {
    return null;
  }
}

/** Options for check-in; supports test mode with date/time override. */
interface CheckInOptions {
  testTime?: Date | null;   // Simulated time for testing
  testDate?: string | null; // Simulated date (YYYY-MM-DD) for testing
  learnerData?: any;        // Pre-fetched learner record to avoid a redundant DB query
}

export interface CheckInResult {
  type: "check_in" | "lunch_event" | "late_lunch_return" | "check_out" | "no_action";
  learnerName: string;
  program: string;
  status?: string; // e.g. "present", "late" — only set for check_in actions
}

/**
 * Core NFC check-in handler. Given an NFC card UID and optional time overrides,
 * determines the appropriate attendance action (check-in, lunch, checkout, etc.)
 * using the shared state machine, then writes the result to PocketBase.
 *
 * Flow:
 *   1. Resolve the learner (from cache or DB)
 *   2. Get-or-create the attendance record for today
 *   3. Run computeCheckInAction() to decide what to write
 *   4. Persist the fields returned by the state machine
 */
export async function checkLearnerIn(NFC_ID: string, options?: CheckInOptions): Promise<CheckInResult | null> {
  // Use pre-fetched learner data if available (avoids a second DB round-trip).
  const learner = options?.learnerData || await getLearnerByNfc(NFC_ID);

  if (!learner) {
    console.log("Learner not found");
    return null;
  }

  const now = options?.testTime || new Date();
  const dateStr = options?.testDate || now.toISOString().split("T")[0];

  console.log(
    `[checkLearnerIn] ${learner.name} - time: ${now.toLocaleTimeString()}, date: ${dateStr}`,
  );

  // Upsert the attendance record and capture the state *before* any update.
  // `existing` is the snapshot fed into the state machine; `attendance` has the
  // latest PB ID needed for the subsequent update call.
  const { existing } = await withRetry(() => pbClient.batchUpdateAttendance({
    learnerId: learner.id,
    date: dateStr,
  }));

  // Determine what action to take based on the current state and the time.
  const action = computeCheckInAction(existing, now);

  if (action.type === "no_action") {
    console.log(`[checkLearnerIn] ${learner.name} ${action.reason}`);
    return { type: "no_action", learnerName: learner.name, program: learner.program || "" };
  }

  try {
    // Write the fields returned by the state machine.
    await withRetry(() => pb.collection("attendance").update(
      existing.id,
      action.fields,
    ));

    switch (action.type) {
      case "check_in":
        console.log(`[checkLearnerIn] ${learner.name} checked in (${action.fields.status})`);
        break;
      case "lunch_event":
        console.log(`[checkLearnerIn] ${learner.name} lunch event recorded`);
        break;
      case "late_lunch_return":
        console.log(`[checkLearnerIn] ${learner.name} back from lunch (late - after 2pm)`);
        break;
      case "check_out":
        console.log(`[checkLearnerIn] ${learner.name} checked out for the day`);
        break;
    }

    return {
      type: action.type,
      learnerName: learner.name,
      program: learner.program || "",
      // `status` is only present on check_in actions; other action types won't have it.
      ...(action.type === "check_in" && { status: action.fields.status }),
    };
  } catch (err) {
    console.error(`[checkLearnerIn] Failed to update ${learner.name}:`, err);
    return null;
  }
}
