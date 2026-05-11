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

// ── Bound query wrappers ──────────────────────────────────────────────────────
// Pre-inject the singleton `pb` instance so existing call sites can use
// `pbClient.listLearners({...})` without threading `pb` through every caller.

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

export function listAllAttendance(params: attendanceQ.ListAttendanceParams = {}) {
  return attendanceQ.listAllAttendance(pb, params);
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

// ── App-specific single-field update ─────────────────────────────────────────
// Used by the UI's inline time/status editors. Validates field names and values
// before writing to PocketBase to prevent accidental corruption.

const TIMESTAMP_FIELDS = ["time_in", "time_out", "lunch_out", "lunch_in"] as const;
const STATUS_FIELDS = ["status", "lunch_status"] as const;
const JSON_FIELDS = ["lunch_events"] as const;
const ALLOWED_STATUSES = ["present", "late", "absent", "jLate", "jAbsent"] as const;

export interface UpdateAttendanceParams {
  learnerId: string;
  field: string;
  date?: string;       // Defaults to today
  value?: string;      // For status / JSON fields
  timestamp?: string;  // For timestamp fields — defaults to now if omitted
  force?: boolean;     // Overwrite even if the field is already set
}

export interface UpdateAttendanceResult {
  status: "updated" | "already_set";
  field: string;
  value?: string;
  existingValue?: string;
  attendance: import("@learnlife/pb-client").AttendanceRecord;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function updateAttendance(params: UpdateAttendanceParams): Promise<UpdateAttendanceResult> {
  const { learnerId, field, value, timestamp, force } = params;
  const date = params.date || new Date().toISOString().split("T")[0];
  if (!DATE_RE.test(date)) {
    throw new Error("date must be YYYY-MM-DD");
  }

  // Validate that the requested field is one we allow editing via this path.
  const isTimestampField = TIMESTAMP_FIELDS.includes(field as any);
  const isStatusField = STATUS_FIELDS.includes(field as any);
  const isJsonField = JSON_FIELDS.includes(field as any);

  if (!isTimestampField && !isStatusField && !isJsonField) {
    throw new Error(`Invalid field. Allowed: ${[...TIMESTAMP_FIELDS, ...STATUS_FIELDS, ...JSON_FIELDS].join(", ")}`);
  }

  // Validate status values to prevent unknown strings entering the DB.
  if (isStatusField && value && value !== "" && !ALLOWED_STATUSES.includes(value as any)) {
    throw new Error(`Invalid status value. Allowed: ${ALLOWED_STATUSES.join(", ")}`);
  }

  // Get-or-create the attendance record for this learner/date.
  let attendance: import("@learnlife/pb-client").AttendanceRecord;
  try {
    const existing = await pb.collection("attendance").getFirstListItem(
      pb.filter("learner = {:learnerId} && date ~ {:date}", { learnerId, date }),
    );
    attendance = existing as unknown as import("@learnlife/pb-client").AttendanceRecord;
  } catch {
    const created = await pb.collection("attendance").create({
      learner: learnerId,
      date: date,
    });
    attendance = created as unknown as import("@learnlife/pb-client").AttendanceRecord;
  }

  // Guard: don't overwrite an existing timestamp unless `force` is set.
  if (isTimestampField && (attendance as any)[field] && !force) {
    return {
      status: "already_set",
      field,
      existingValue: (attendance as any)[field],
      attendance,
    };
  }

  // Resolve the value to write: use the provided timestamp or default to now.
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
