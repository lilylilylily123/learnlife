import { pb } from "../pb";
import * as pbClient from "@/lib/pb-client";
import type { AttendanceRecord } from "@/lib/pb-client";

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
  let pr: string;

  switch (program) {
    case "Changemaker":
      pr = "chmk";
      break;
    case "Creator":
      pr = "cre";
      break;
    case "Explorer":
      pr = "exp";
      break;
    default:
      pr = "chmk";
  }

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

// Retry helper for 429 rate limit errors
async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 800): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (retries > 0 && err?.status === 429) {
      console.log(`[withRetry] 429 rate limited, retrying in ${delay}ms (${retries} left)...`);
      await new Promise(r => setTimeout(r, delay));
      return withRetry(fn, retries - 1, delay * 1.5);
    }
    throw err;
  }
}

export async function checkLearnerIn(NFC_ID: string, options?: CheckInOptions) {
  // Use pre-fetched learner if available, otherwise look up
  const learner = options?.learnerData || await getLearnerByNfc(NFC_ID);

  if (!learner) {
    console.log("Learner not found");
    return;
  }

  const now = options?.testTime || new Date();
  const hour = now.getHours();
  const dateStr = options?.testDate || now.toISOString().split("T")[0];

  console.log(
    `[checkLearnerIn] ${learner.name} - time: ${now.toLocaleTimeString()}, date: ${dateStr}`,
  );

  // Single call: get-or-create attendance record AND read existing state (1-2 requests)
  // No separate getAttendanceForDate needed — batchUpdateAttendance returns existing values
  const { existing } = await withRetry(() => pbClient.batchUpdateAttendance({
    learnerId: learner.id,
    date: dateStr,
  }));

  const time_in = (existing as any).time_in;
  const time_out = (existing as any).time_out;
  const lunch_events = ((existing as any).lunch_events || []) as Array<{type: 'out' | 'in', time: string}>;

  // Step 1: Morning check-in — batch time_in + status in ONE update (1 request)
  if (!time_in) {
    try {
      const lateTime = new Date(
        now.getFullYear(), now.getMonth(), now.getDate(), 10, 1, 0, 0,
      );
      const status = now.getTime() >= lateTime.getTime() ? "late" : "present";

      await withRetry(() => pb.collection("attendance").update(
        existing.id,
        { time_in: now.toISOString(), status },
      ));
      console.log(`[checkLearnerIn] ${learner.name} checked in (${status})`);
    } catch (err) {
      console.error(`[checkLearnerIn] Failed to check in ${learner.name}:`, err);
    }
    return;
  }

  // Step 2 & 3: Multiple lunch out/in (1pm-2pm window)
  if (hour >= 13 && hour < 14) {
    const lastEvent = lunch_events.length > 0 ? lunch_events[lunch_events.length - 1] : null;
    const nextEventType: 'out' | 'in' = !lastEvent || lastEvent.type === 'in' ? 'out' : 'in';

    const updatedEvents = [...lunch_events, { type: nextEventType, time: now.toISOString() }];

    try {
      const fields: Record<string, string> = {
        lunch_events: JSON.stringify(updatedEvents),
      };

      if (nextEventType === 'in') {
        const lunchLateTime = new Date(
          now.getFullYear(), now.getMonth(), now.getDate(), 14, 1, 0, 0,
        );
        fields.lunch_status = now.getTime() >= lunchLateTime.getTime() ? "late" : "present";
        console.log(`[checkLearnerIn] ${learner.name} back from lunch #${Math.ceil(updatedEvents.length / 2)} (${fields.lunch_status})`);
      } else {
        console.log(`[checkLearnerIn] ${learner.name} out for lunch #${Math.ceil(updatedEvents.length / 2)}`);
      }

      await withRetry(() => pb.collection("attendance").update(
        existing.id,
        fields,
      ));
    } catch (err) {
      console.error(`[checkLearnerIn] Failed to update lunch for ${learner.name}:`, err);
    }
    return;
  }

  // Step 4: After 2pm, late lunch return
  if (hour >= 14) {
    const currentlyAtLunch = lunch_events.length > 0 && lunch_events[lunch_events.length - 1].type === 'out';
    const lunch_out_legacy = (existing as any).lunch_out;
    const lunch_in_legacy = (existing as any).lunch_in;
    const currentlyAtLunchLegacy = lunch_out_legacy && !lunch_in_legacy;

    if (currentlyAtLunch || currentlyAtLunchLegacy) {
      const updatedEvents = [...lunch_events, { type: 'in' as const, time: now.toISOString() }];

      try {
        await withRetry(() => pb.collection("attendance").update(
          existing.id,
          {
            lunch_events: JSON.stringify(updatedEvents),
            lunch_status: "late",
          },
        ));
        console.log(`[checkLearnerIn] ${learner.name} back from lunch (late - after 2pm)`);
      } catch (err) {
        console.error(`[checkLearnerIn] Failed to update lunch_in for ${learner.name}:`, err);
      }
      return;
    }
  }

  // Step 5: Day checkout (4:59pm+, if not already checked out)
  const minute = now.getMinutes();
  if ((hour > 16 || (hour === 16 && minute >= 59)) && !time_out) {
    try {
      await withRetry(() => pb.collection("attendance").update(
        existing.id,
        { time_out: now.toISOString() },
      ));
      console.log(`[checkLearnerIn] ${learner.name} checked out for the day`);
    } catch (err) {
      console.error(`[checkLearnerIn] Failed to check out ${learner.name}:`, err);
    }
    return;
  }

  console.log(`[checkLearnerIn] ${learner.name} already completed all check-ins for today`);
}
