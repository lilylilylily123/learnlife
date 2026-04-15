import { pb } from "../pb";
import * as pbClient from "@/lib/pb-client";
import type { AttendanceRecord } from "@/lib/pb-client";
import { withRetry, PROGRAM_CODES } from "@learnlife/pb-client";
import { computeCheckInAction } from "@learnlife/shared";

// Combined lookup - single DB query for NFC scan
export async function getLearnerByNfc(uid: string) {
  try {
    return await pb
      .collection("learners")
      .getFirstListItem(`NFC_ID = '${uid}'`);
  } catch {
    return null;
  }
}

export async function createLearner(
  name: string,
  email: string,
  program: string,
  dob: string,
  NFC_ID: string,
) {
  const pr = PROGRAM_CODES[program as keyof typeof PROGRAM_CODES] || "chmk";

  pb.collection("learners").create({
    name,
    email,
    program: pr,
    dob,
    NFC_ID,
  });
  console.log("Learner Creating");
}

// Get attendance record for a learner on a specific date
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

// Options for check-in (supports test mode with date/time override)
interface CheckInOptions {
  testTime?: Date | null; // Simulated time
  testDate?: string | null; // Simulated date (YYYY-MM-DD)
  learnerData?: any; // Pre-fetched learner record to avoid redundant DB query
}

export async function checkLearnerIn(NFC_ID: string, options?: CheckInOptions) {
  // Use pre-fetched learner if available, otherwise look up
  const learner = options?.learnerData || await getLearnerByNfc(NFC_ID);

  if (!learner) {
    console.log("Learner not found");
    return;
  }

  const now = options?.testTime || new Date();
  const dateStr = options?.testDate || now.toISOString().split("T")[0];

  console.log(
    `[checkLearnerIn] ${learner.name} - time: ${now.toLocaleTimeString()}, date: ${dateStr}`,
  );

  // Single call: get-or-create attendance record AND read existing state (1-2 requests)
  const { existing } = await withRetry(() => pbClient.batchUpdateAttendance({
    learnerId: learner.id,
    date: dateStr,
  }));

  // Use the shared state machine to determine what action to take
  const action = computeCheckInAction(existing, now);

  if (action.type === "no_action") {
    console.log(`[checkLearnerIn] ${learner.name} ${action.reason}`);
    return;
  }

  try {
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
  } catch (err) {
    console.error(`[checkLearnerIn] Failed to update ${learner.name}:`, err);
  }
}
