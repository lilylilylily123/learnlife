import { pb } from "../pb";

// Combined lookup - single DB query for NFC scan
export async function getLearnerByNfc(uid: string) {
  try {
    return await pb.collection("learners").getFirstListItem(`NFC_ID = '${uid}'`);
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
    return await pb.collection("learners").getFirstListItem(`NFC_ID = '${uid}'`);
  } catch {
    console.log("No learner found");
    return null;
  }
}
export async function createLearner(
  name: string,
  email: string,
  dob: string,
  NFC_ID: string,
) {
  pb.collection("learners").create({
    name,
    email,
    dob,
    NFC_ID,
  });
  console.log("learner CReating");
}

// Helper to update attendance field via server API
// Supports testDate for historical testing
async function updateAttendanceViaApi(
  learnerId: string, 
  field: string, 
  options?: { 
    value?: string; // For status fields
    timestamp?: string; // For timestamp fields
    date?: string; // ISO date (YYYY-MM-DD) for testing different days
  }
): Promise<{ wrote: boolean; value?: string; attendance?: any }> {
  try {
    const res = await fetch(`/api/attendance/${learnerId}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        field, 
        value: options?.value,
        timestamp: options?.timestamp,
        date: options?.date,
      }),
    });
    const data = await res.json();
    
    if (res.status === 409) {
      // Field already set
      return { wrote: false, value: data.existingValue, attendance: data.attendance };
    }
    
    if (!res.ok) {
      console.error(`[updateAttendanceViaApi] Error:`, data);
      throw new Error(data.error || "Failed to update");
    }
    
    return { wrote: true, value: data.value, attendance: data.attendance };
  } catch (err) {
    console.error(`[updateAttendanceViaApi] Request failed:`, err);
    throw err;
  }
}

// Get attendance record for a learner on a specific date
export async function getAttendanceForDate(learnerId: string, date?: string): Promise<any | null> {
  try {
    const params = date ? `?date=${date}` : "";
    const res = await fetch(`/api/attendance/${learnerId}${params}`);
    const data = await res.json();
    return data.attendance || null;
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
  
  console.log(`[checkLearnerIn] Using time: ${now.toLocaleTimeString()}, date: ${dateStr} (test mode: ${!!(options?.testTime || options?.testDate)})`);

  // Get current attendance state for this date
  const attendance = await getAttendanceForDate(learner.id, dateStr);
  const time_in = attendance?.time_in;
  const time_out = attendance?.time_out;
  const lunch_out = attendance?.lunch_out;
  const lunch_in = attendance?.lunch_in;

  // Step 1: Morning check-in (if not checked in yet)
  if (!time_in) {
    try {
      const result = await updateAttendanceViaApi(learner.id, "time_in", {
        timestamp: now.toISOString(),
        date: dateStr,
      });
      if (result.wrote) {
        const tenAM = new Date(now);
        tenAM.setHours(10, 0, 0, 0);
        const status = now <= tenAM ? "present" : "late";
        await updateAttendanceViaApi(learner.id, "status", { value: status, date: dateStr });
        console.log(`Learner checked in (${status})`);
      }
    } catch (err) {
      console.error("Failed to check in:", err);
    }
    return;
  }

  // Step 2: Lunch out (1pm+, if not already out)
  if (hour >= 13 && !lunch_out) {
    try {
      await updateAttendanceViaApi(learner.id, "lunch_out", {
        timestamp: now.toISOString(),
        date: dateStr,
      });
      console.log("Learner checked out for lunch");
    } catch (err) {
      console.error("Failed to update lunch_out:", err);
    }
    return;
  }

  // Step 3: Lunch in (if went to lunch but not back yet)
  if (lunch_out && !lunch_in) {
    try {
      const result = await updateAttendanceViaApi(learner.id, "lunch_in", {
        timestamp: now.toISOString(),
        date: dateStr,
      });
      if (result.wrote) {
        const twoPM = new Date(now);
        twoPM.setHours(14, 0, 0, 0);
        const lunchStatus = now > twoPM ? "late" : "present";
        await updateAttendanceViaApi(learner.id, "lunch_status", { value: lunchStatus, date: dateStr });
        console.log(`Learner back from lunch (${lunchStatus})`);
      }
    } catch (err) {
      console.error("Failed to update lunch_in:", err);
    }
    return;
  }

  // Step 4: Day checkout (5pm+, if not already checked out)
  if (hour >= 17 && !time_out) {
    try {
      await updateAttendanceViaApi(learner.id, "time_out", {
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
