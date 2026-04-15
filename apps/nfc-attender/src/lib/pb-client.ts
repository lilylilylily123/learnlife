"use client";
import PocketBase from "pocketbase";

const PB_URL = process.env.NEXT_PUBLIC_PB_URL || "https://learnlife.pockethost.io/";

// Extend Window interface for global pb instance
declare global {
  interface Window {
    __pb?: PocketBase;
  }
}

// Singleton PocketBase client for client-side operations
// This must be the same instance used for authentication
let pbInstance: PocketBase | null = null;

export function getPb(): PocketBase {
  if (typeof window !== "undefined") {
    // On client side, try to get the existing pb instance from the app
    if (window.__pb) {
      return window.__pb;
    }
  }
  
  if (!pbInstance) {
    pbInstance = new PocketBase(PB_URL);
    pbInstance.autoCancellation(false);
    
    // Store globally so other modules can access the same instance
    if (typeof window !== "undefined") {
      window.__pb = pbInstance;
    }
  }
  return pbInstance;
}

// Re-export for convenience
export const pb = getPb();

// ============================================
// Learners API
// ============================================

export interface Learner {
  id: string;
  name: string;
  email: string;
  dob: string;
  NFC_ID: string | null;
  program?: string;
  comments?: string; // Add comments field
  collectionId: string;
  collectionName: string;
  created: string;
  updated: string;
}

export interface LearnersListParams {
  page?: number;
  perPage?: number;
  search?: string;
  program?: string;
}

export interface LearnersListResult {
  items: Learner[];
  totalItems: number;
  totalPages: number;
  page: number;
}

export async function listLearners(params: LearnersListParams = {}): Promise<LearnersListResult> {
  const { page = 1, perPage = 50, search, program } = params;
  const pb = getPb();

  const filterParts: string[] = [];
  if (search) {
    filterParts.push(`(name ~ "${search}" || email ~ "${search}")`);
  }
  if (program) {
    filterParts.push(`program = "${program}"`);
  }

  const response = await pb.collection("learners").getList(page, perPage, {
    filter: filterParts.length > 0 ? filterParts.join(" && ") : undefined,
    sort: "name",
  });

  return {
    items: response.items as unknown as Learner[],
    totalItems: response.totalItems,
    totalPages: response.totalPages,
    page: response.page,
  };
}

// ============================================
// Attendance API
// ============================================

export interface LunchEvent {
  type: 'out' | 'in';
  time: string;
}

export interface AttendanceRecord {
  id: string;
  learner: string;
  date: string;
  time_in: string | null;
  time_out: string | null;
  lunch_out: string | null;
  lunch_in: string | null;
  lunch_events: LunchEvent[] | null;
  status: string | null;
  lunch_status: string | null;
  collectionId: string;
  collectionName: string;
  created: string;
  updated: string;
  expand?: {
    learner?: Learner;
  };
}

export interface AttendanceListParams {
  date?: string;
  learnerId?: string;
  page?: number;
  perPage?: number;
}

export interface AttendanceListResult {
  items: AttendanceRecord[];
  totalItems: number;
  totalPages: number;
  date: string;
}

export async function listAttendance(params: AttendanceListParams = {}): Promise<AttendanceListResult> {
  const { learnerId, page = 1, perPage = 50 } = params;
  const date = params.date || new Date().toISOString().split("T")[0];
  const pb = getPb();

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

export async function getAttendance(learnerId: string, date?: string): Promise<{ attendance: AttendanceRecord | null; exists: boolean }> {
  const targetDate = date || new Date().toISOString().split("T")[0];
  const pb = getPb();

  try {
    const record = await pb.collection("attendance").getFirstListItem(
      `learner = "${learnerId}" && date ~ "${targetDate}"`,
      { expand: "learner" }
    );
    return { attendance: record as unknown as AttendanceRecord, exists: true };
  } catch {
    return { attendance: null, exists: false };
  }
}

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
  attendance: AttendanceRecord;
}

export async function updateAttendance(params: UpdateAttendanceParams): Promise<UpdateAttendanceResult> {
  const { learnerId, field, value, timestamp, force } = params;
  const date = params.date || new Date().toISOString().split("T")[0];
  const pb = getPb();

  const isTimestampField = TIMESTAMP_FIELDS.includes(field as any);
  const isStatusField = STATUS_FIELDS.includes(field as any);
  const isJsonField = JSON_FIELDS.includes(field as any);

  if (!isTimestampField && !isStatusField && !isJsonField) {
    throw new Error(`Invalid field. Allowed: ${[...TIMESTAMP_FIELDS, ...STATUS_FIELDS, ...JSON_FIELDS].join(", ")}`);
  }

  if (isStatusField && value && value !== "" && !ALLOWED_STATUSES.includes(value as any)) {
    throw new Error(`Invalid status value. Allowed: ${ALLOWED_STATUSES.join(", ")}`);
  }

  // Get or create attendance record for this specific date
  let attendance: AttendanceRecord;
  try {
    const existing = await pb.collection("attendance").getFirstListItem(
      `learner = "${learnerId}" && date ~ "${date}"`
    );
    attendance = existing as unknown as AttendanceRecord;
  } catch {
    // No record for this date — create one
    const created = await pb.collection("attendance").create({
      learner: learnerId,
      date: date,
    });
    attendance = created as unknown as AttendanceRecord;
  }

  // Check if timestamp field already has a value (no overwrites unless force)
  if (isTimestampField && (attendance as any)[field] && !force) {
    return {
      status: "already_set",
      field,
      existingValue: (attendance as any)[field],
      attendance,
    };
  }

  // Determine value to set
  let updateValue: string;
  if (isTimestampField) {
    updateValue = timestamp || new Date().toISOString();
  } else if (isJsonField) {
    // For JSON fields, value should already be a JSON string
    updateValue = value!;
  } else {
    updateValue = value!;
  }

  // Update the record
  const updated = await pb.collection("attendance").update(
    attendance.id,
    { [field]: updateValue },
    { expand: "learner" }
  );

  return {
    status: "updated",
    field,
    value: updateValue,
    attendance: updated as unknown as AttendanceRecord,
  };
}

// Batch update: get-or-create attendance record once, then set multiple fields in one update.
// Returns the record state BEFORE the update (for callers that need to check existing values)
// plus the updated record. If fields is empty, just returns the existing/created record.
export async function batchUpdateAttendance(params: {
  learnerId: string;
  date?: string;
  fields?: Record<string, string>;
}): Promise<{ attendance: AttendanceRecord; existing: AttendanceRecord; created: boolean }> {
  const { learnerId, fields } = params;
  const date = params.date || new Date().toISOString().split("T")[0];
  const pb = getPb();

  // Step 1: Get or create attendance record (1-2 requests)
  let attendance: AttendanceRecord;
  let created = false;
  try {
    const existing = await pb.collection("attendance").getFirstListItem(
      `learner = "${learnerId}" && date ~ "${date}"`
    );
    attendance = existing as unknown as AttendanceRecord;
  } catch {
    const record = await pb.collection("attendance").create({
      learner: learnerId,
      date: date,
    });
    attendance = record as unknown as AttendanceRecord;
    created = true;
  }

  // Snapshot the state before update so callers can check existing values
  const existing = { ...attendance };

  // Step 2: Single update with all fields (1 request)
  if (fields && Object.keys(fields).length > 0) {
    const updated = await pb.collection("attendance").update(
      attendance.id,
      fields
    );
    attendance = updated as unknown as AttendanceRecord;
  }

  return { attendance, existing, created };
}

export interface ResetAttendanceResult {
  status: "reset" | "no_record";
  attendance?: AttendanceRecord;
  message?: string;
}

export async function resetAttendance(learnerId: string, date?: string): Promise<ResetAttendanceResult> {
  const targetDate = date || new Date().toISOString().split("T")[0];
  const pb = getPb();

  try {
    const record = await pb.collection("attendance").getFirstListItem(
      `learner = "${learnerId}" && date ~ "${targetDate}"`
    );

    const updated = await pb.collection("attendance").update(
      record.id,
      {
        time_in: null,
        time_out: null,
        lunch_out: null,
        lunch_in: null,
        lunch_events: null,
        status: null,
        lunch_status: null,
      },
      { expand: "learner" }
    );

    return { status: "reset", attendance: updated as unknown as AttendanceRecord };
  } catch {
    return { status: "no_record", message: "No attendance record found for this date" };
  }
}

// ============================================
// Learner Comments API
// ============================================

export async function updateLearnerComment(learnerId: string, comment: string): Promise<Learner> {
  const pb = getPb();
  
  // Update the learner's comments field
  const updated = await pb.collection("learners").update(learnerId, {
    comments: comment,
  });
  
  return updated as unknown as Learner;
}
