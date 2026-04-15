import type PocketBase from "pocketbase";
import type { AttendanceRecord } from "../types";

export interface ListAttendanceParams {
  date?: string;
  learnerId?: string;
  page?: number;
  perPage?: number;
}

export interface ListAttendanceResult {
  items: AttendanceRecord[];
  totalItems: number;
  totalPages: number;
  date: string;
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

export async function listAttendance(
  pb: PocketBase,
  params: ListAttendanceParams = {},
): Promise<ListAttendanceResult> {
  const { learnerId, page = 1, perPage = 50 } = params;
  const date = params.date || todayStr();

  const filterParts: string[] = [`date ~ "${date}"`];
  if (learnerId) {
    filterParts.push(`learner = "${learnerId}"`);
  }

  const response = await pb.collection("attendance").getList(page, perPage, {
    filter: filterParts.join(" && "),
    expand: "learner",
    sort: "-created",
  });

  return {
    items: response.items as unknown as AttendanceRecord[],
    totalItems: response.totalItems,
    totalPages: response.totalPages,
    date,
  };
}

export async function getAttendance(
  pb: PocketBase,
  learnerId: string,
  date?: string,
): Promise<{ attendance: AttendanceRecord | null; exists: boolean }> {
  const targetDate = date || todayStr();
  try {
    const record = await pb
      .collection("attendance")
      .getFirstListItem(`learner = "${learnerId}" && date ~ "${targetDate}"`, {
        expand: "learner",
      });
    return { attendance: record as unknown as AttendanceRecord, exists: true };
  } catch {
    return { attendance: null, exists: false };
  }
}

export async function batchUpdateAttendance(
  pb: PocketBase,
  params: { learnerId: string; date?: string; fields?: Record<string, string> },
): Promise<{ attendance: AttendanceRecord; existing: AttendanceRecord; created: boolean }> {
  const { learnerId, fields } = params;
  const date = params.date || todayStr();

  let attendance: AttendanceRecord;
  let created = false;
  try {
    const existing = await pb
      .collection("attendance")
      .getFirstListItem(`learner = "${learnerId}" && date ~ "${date}"`);
    attendance = existing as unknown as AttendanceRecord;
  } catch {
    const record = await pb.collection("attendance").create({ learner: learnerId, date });
    attendance = record as unknown as AttendanceRecord;
    created = true;
  }

  const existing = { ...attendance };

  if (fields && Object.keys(fields).length > 0) {
    const updated = await pb.collection("attendance").update(attendance.id, fields);
    attendance = updated as unknown as AttendanceRecord;
  }

  return { attendance, existing, created };
}

export async function resetAttendance(
  pb: PocketBase,
  learnerId: string,
  date?: string,
): Promise<{ status: "reset" | "no_record"; attendance?: AttendanceRecord }> {
  const targetDate = date || todayStr();
  try {
    const record = await pb
      .collection("attendance")
      .getFirstListItem(`learner = "${learnerId}" && date ~ "${targetDate}"`);

    const updated = await pb.collection("attendance").update(record.id, {
      time_in: null,
      time_out: null,
      lunch_out: null,
      lunch_in: null,
      lunch_events: null,
      status: null,
      lunch_status: null,
    }, { expand: "learner" });

    return { status: "reset", attendance: updated as unknown as AttendanceRecord };
  } catch {
    return { status: "no_record" };
  }
}
