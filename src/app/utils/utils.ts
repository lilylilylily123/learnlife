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

export async function uidTF(uid: string): Promise<boolean> {
  try {
    await pb.collection("learners").getFirstListItem(`NFC_ID = '${uid}'`);
    return true;
  } catch {
    return false;
  }
}

export async function checkIfLearnerExist(uid: string) {
  try {
    return await pb
      .collection("learners")
      .getFirstListItem(`NFC_ID = '${uid}'`);
  } catch {
    console.log("No learner found");
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
}

export async function checkLearnerIn(NFC_ID: string, options?: CheckInOptions) {
  // First, get the learner
  const learner = await getLearnerByNfc(NFC_ID);

  if (!learner) {
    console.log("Learner not found");
    return;
  }

  // Use testTime if provided, otherwise use real time
  const now = options?.testTime || new Date();
  const hour = now.getHours();

  // Use testDate if provided, otherwise use the date from now
  const dateStr = options?.testDate || now.toISOString().split("T")[0];

  console.log(
    `[checkLearnerIn] Using time: ${now.toLocaleTimeString()}, date: ${dateStr} (test mode: ${!!(options?.testTime || options?.testDate)})`,
  );

  // Get current attendance state for this date
  const attendance = await getAttendanceForDate(learner.id, dateStr);
  const time_in = attendance?.time_in;
  const time_out = attendance?.time_out;
  const lunch_events = (attendance?.lunch_events || []) as Array<{type: 'out' | 'in', time: string}>;

  // Step 1: Morning check-in (if not checked in yet)
  if (!time_in) {
    try {
      const result = await pbClient.updateAttendance({
        learnerId: learner.id,
        field: "time_in",
        timestamp: now.toISOString(),
        date: dateStr,
      });
      if (result.status === "updated") {
        // Before 10:01 AM = present, 10:01 AM+ = late
        const lateTime = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          10,
          1,
          0,
          0,
        );
        const isLate = now.getTime() >= lateTime.getTime();
        const status = isLate ? "late" : "present";
        await pbClient.updateAttendance({
          learnerId: learner.id,
          field: "status",
          value: status,
          date: dateStr,
        });
        console.log(`Learner checked in (${status})`);
      }
    } catch (err) {
      console.error("Failed to check in:", err);
    }
    return;
  }

  // Step 2 & 3: Multiple lunch out/in (1pm-2pm window)
  if (hour >= 13 && hour < 14) {
    // Determine if we should check out or check in
    const lastEvent = lunch_events.length > 0 ? lunch_events[lunch_events.length - 1] : null;
    
    // If no events or last event was 'in', next action is 'out'
    // If last event was 'out', next action is 'in'
    const nextEventType: 'out' | 'in' = !lastEvent || lastEvent.type === 'in' ? 'out' : 'in';
    
    const newEvent = {
      type: nextEventType,
      time: now.toISOString()
    };
    
    const updatedEvents = [...lunch_events, newEvent];
    
    try {
      await pbClient.updateAttendance({
        learnerId: learner.id,
        field: "lunch_events",
        value: JSON.stringify(updatedEvents),
        date: dateStr,
        force: true,
      });
      
      // If checking in from lunch and it's after 2:01pm, mark as late
      if (nextEventType === 'in') {
        const lunchLateTime = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          14,
          1,
          0,
          0,
        );
        const isLunchLate = now.getTime() >= lunchLateTime.getTime();
        const lunchStatus = isLunchLate ? "late" : "present";
        await pbClient.updateAttendance({
          learnerId: learner.id,
          field: "lunch_status",
          value: lunchStatus,
          date: dateStr,
        });
        console.log(`Learner back from lunch #${Math.ceil(updatedEvents.length / 2)} (${lunchStatus})`);
      } else {
        console.log(`Learner checked out for lunch #${Math.ceil(updatedEvents.length / 2)}`);
      }
    } catch (err) {
      console.error("Failed to update lunch event:", err);
    }
    return;
  }

  // Step 4: After 2pm, use traditional lunch_in/lunch_out for late returns
  const lunch_out_legacy = attendance?.lunch_out;
  const lunch_in_legacy = attendance?.lunch_in;
  
  // If still at lunch after 2pm, allow checking back in
  if (hour >= 14) {
    // Check if currently at lunch (last event was 'out' OR using legacy lunch_out without lunch_in)
    const currentlyAtLunch = lunch_events.length > 0 && lunch_events[lunch_events.length - 1].type === 'out';
    const currentlyAtLunchLegacy = lunch_out_legacy && !lunch_in_legacy;
    
    if (currentlyAtLunch || currentlyAtLunchLegacy) {
      // Allow check in
      const newEvent = {
        type: 'in' as const,
        time: now.toISOString()
      };
      
      const updatedEvents = [...lunch_events, newEvent];
      
      try {
        await pbClient.updateAttendance({
          learnerId: learner.id,
          field: "lunch_events",
          value: JSON.stringify(updatedEvents),
          date: dateStr,
          force: true,
        });
        
        // Mark as late for returning after 2pm
        await pbClient.updateAttendance({
          learnerId: learner.id,
          field: "lunch_status",
          value: "late",
          date: dateStr,
        });
        console.log(`Learner back from lunch (late - after 2pm)`);
      } catch (err) {
        console.error("Failed to update lunch_in:", err);
      }
      return;
    }
  }

  // Step 5: Day checkout (4:59pm+, if not already checked out)
  const minute = now.getMinutes();
  if ((hour > 16 || (hour === 16 && minute >= 59)) && !time_out) {
    try {
      await pbClient.updateAttendance({
        learnerId: learner.id,
        field: "time_out",
        timestamp: now.toISOString(),
        date: dateStr,
      });
      console.log("Learner checked out for the day");
    } catch (err) {
      console.error("Failed to check out:", err);
    }
    return;
  }

  // Already fully checked in/out for the day
  console.log("Learner already completed all check-ins for today");
}
