"use client";
import { pb } from "@/app/pb";
import {
  learners as learnersQ,
  attendance as attendanceQ,
} from "@learnlife/pb-client";

// Re-export types from shared package
export type {
  Learner,
  LunchEvent,
  AttendanceRecord,
  AttendanceStatus,
} from "@learnlife/pb-client";

export type LearnersListParams = learnersQ.ListLearnersParams;

// Re-export result types that callers use
export type ListLearnersResult = Awaited<ReturnType<typeof listLearners>>;

export interface AttendanceListResult {
  items: import("@learnlife/pb-client").AttendanceRecord[];
  totalItems: number;
  totalPages: number;
  date: string;
}

// Bound query functions — pre-inject the singleton pb instance
// so existing call sites (pbClient.listLearners({...})) keep working

export function listLearners(params: learnersQ.ListLearnersParams = {}) {
  return learnersQ.listLearners(pb, params);
}

export function getLearnerByNfc(nfcId: string) {
  return learnersQ.getLearnerByNfc(pb, nfcId);
}

export function updateLearnerComment(learnerId: string, comment: string) {
  return learnersQ.updateLearnerComment(pb, learnerId, comment);
}

export function listAttendance(params: attendanceQ.ListAttendanceParams = {}) {
  return attendanceQ.listAttendance(pb, params);
}

export function getAttendance(learnerId: string, date?: string) {
  return attendanceQ.getAttendance(pb, learnerId, date);
}

export function batchUpdateAttendance(params: {
  learnerId: string;
  date?: string;
  fields?: Record<string, string>;
}) {
  return attendanceQ.batchUpdateAttendance(pb, params);
}

export function resetAttendance(learnerId: string, date?: string) {
  return attendanceQ.resetAttendance(pb, learnerId, date);
}

// App-specific: single-field update with validation (used by UI inline editing + tests)
const TIMESTAMP_FIELDS = ["time_in", "time_out", "lunch_out", "lunch_in"] as const;
const STATUS_FIELDS = ["status", "lunch_status"] as const;
const JSON_FIELDS = ["lunch_events"] as const;
const ALLOWED_STATUSES = ["present", "late", "absent", "jLate", "jAbsent"] as const;

export interface UpdateAttendanceParams {
  learnerId: string;
  field: string;
  date?: string;
  value?: string;
  timestamp?: string;
  force?: boolean;
}

export interface UpdateAttendanceResult {
  status: "updated" | "already_set";
  field: string;
  value?: string;
  existingValue?: string;
  attendance: import("@learnlife/pb-client").AttendanceRecord;
}

export async function updateAttendance(params: UpdateAttendanceParams): Promise<UpdateAttendanceResult> {
  const { learnerId, field, value, timestamp, force } = params;
  const date = params.date || new Date().toISOString().split("T")[0];

  const isTimestampField = TIMESTAMP_FIELDS.includes(field as any);
  const isStatusField = STATUS_FIELDS.includes(field as any);
  const isJsonField = JSON_FIELDS.includes(field as any);

  if (!isTimestampField && !isStatusField && !isJsonField) {
    throw new Error(`Invalid field. Allowed: ${[...TIMESTAMP_FIELDS, ...STATUS_FIELDS, ...JSON_FIELDS].join(", ")}`);
  }

  if (isStatusField && value && value !== "" && !ALLOWED_STATUSES.includes(value as any)) {
    throw new Error(`Invalid status value. Allowed: ${ALLOWED_STATUSES.join(", ")}`);
  }

  let attendance: import("@learnlife/pb-client").AttendanceRecord;
  try {
    const existing = await pb.collection("attendance").getFirstListItem(
      `learner = "${learnerId}" && date ~ "${date}"`
    );
    attendance = existing as unknown as import("@learnlife/pb-client").AttendanceRecord;
  } catch {
    const created = await pb.collection("attendance").create({
      learner: learnerId,
      date: date,
    });
    attendance = created as unknown as import("@learnlife/pb-client").AttendanceRecord;
  }

  if (isTimestampField && (attendance as any)[field] && !force) {
    return {
      status: "already_set",
      field,
      existingValue: (attendance as any)[field],
      attendance,
    };
  }

  let updateValue: string;
  if (isTimestampField) {
    updateValue = timestamp || new Date().toISOString();
  } else {
    updateValue = value!;
  }

  const updated = await pb.collection("attendance").update(
    attendance.id,
    { [field]: updateValue },
    { expand: "learner" }
  );

  return {
    status: "updated",
    field,
    value: updateValue,
    attendance: updated as unknown as import("@learnlife/pb-client").AttendanceRecord,
  };
}
