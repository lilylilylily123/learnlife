import type PocketBase from "pocketbase";
import type { AttendanceRecord } from "../types";

/** Parameters accepted by listAttendance. All are optional — defaults to today's records. */
export interface ListAttendanceParams {
  date?: string;       // YYYY-MM-DD — single-day filter. Ignored when dateFrom/dateTo is set.
  dateFrom?: string;   // YYYY-MM-DD — inclusive range start
  dateTo?: string;     // YYYY-MM-DD — inclusive range end
  learnerId?: string;  // Filter to a single learner
  page?: number;
  perPage?: number;
}

export interface ListAttendanceResult {
  items: AttendanceRecord[];
  totalItems: number;
  totalPages: number;
  date: string; // The resolved date (single-day queries) or a "from..to" label for ranges.
}

/** Returns today as a YYYY-MM-DD string in the local timezone. */
function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function assertDate(value: string, label: string): string {
  if (!DATE_RE.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
  return value;
}

/**
 * Build the PocketBase filter clause for a single-day or date-range query.
 * Ranges use `>=` / `<=` against the date column with explicit time bounds so
 * PB's timestamp comparison matches the full day on both ends.
 *
 * Date inputs are validated against YYYY-MM-DD before interpolation so the
 * resulting filter cannot include user-controlled quote characters.
 */
function buildDateFilter(
  pb: PocketBase,
  params: ListAttendanceParams,
): { clause: string; label: string } {
  if (params.dateFrom || params.dateTo) {
    const from = assertDate(params.dateFrom || params.dateTo!, "dateFrom");
    const to = assertDate(params.dateTo || params.dateFrom!, "dateTo");
    return {
      clause: pb.filter("date >= {:from} && date <= {:to}", {
        from: `${from} 00:00:00`,
        to: `${to} 23:59:59`,
      }),
      label: from === to ? from : `${from}..${to}`,
    };
  }
  const date = assertDate(params.date || todayStr(), "date");
  return { clause: pb.filter("date ~ {:date}", { date }), label: date };
}

/**
 * Paginated list of attendance records, optionally filtered by date (or date
 * range) and learner. Always expands the `learner` relation so UI can display
 * names without a second query.
 */
export async function listAttendance(
  pb: PocketBase,
  params: ListAttendanceParams = {},
): Promise<ListAttendanceResult> {
  const { learnerId, page = 1, perPage = 50 } = params;
  const { clause, label } = buildDateFilter(pb, params);

  const filterParts: string[] = [clause];
  if (learnerId) {
    filterParts.push(pb.filter("learner = {:learnerId}", { learnerId }));
  }

  const response = await pb.collection("attendance").getList(page, perPage, {
    filter: filterParts.join(" && "),
    expand: "learner",
    sort: "-date,-created",
  });

  return {
    items: response.items as unknown as AttendanceRecord[],
    totalItems: response.totalItems,
    totalPages: response.totalPages,
    date: label,
  };
}

/**
 * Fetch every attendance record matching the given filters, paging through
 * results until exhausted. For multi-week ranges this can return thousands of
 * records — callers should prefer `listAttendance` with a page when possible.
 */
export async function listAllAttendance(
  pb: PocketBase,
  params: ListAttendanceParams = {},
): Promise<AttendanceRecord[]> {
  const perPage = params.perPage ?? 200;
  const first = await listAttendance(pb, { ...params, page: 1, perPage });
  const all: AttendanceRecord[] = [...first.items];
  for (let p = 2; p <= first.totalPages; p++) {
    const next = await listAttendance(pb, { ...params, page: p, perPage });
    all.push(...next.items);
  }
  return all;
}

/**
 * Fetch a single attendance record for a learner on a given date.
 * Returns `{ attendance: null, exists: false }` when no record exists rather
 * than throwing, so callers can handle the "first scan of the day" case cleanly.
 */
export async function getAttendance(
  pb: PocketBase,
  learnerId: string,
  date?: string,
): Promise<{ attendance: AttendanceRecord | null; exists: boolean }> {
  const targetDate = assertDate(date || todayStr(), "date");
  try {
    const record = await pb
      .collection("attendance")
      .getFirstListItem(
        pb.filter("learner = {:learnerId} && date ~ {:date}", {
          learnerId,
          date: targetDate,
        }),
        { expand: "learner" },
      );
    return { attendance: record as unknown as AttendanceRecord, exists: true };
  } catch {
    // PocketBase throws when no record is found — treat that as "does not exist".
    return { attendance: null, exists: false };
  }
}

/**
 * Get-or-create an attendance record, then optionally patch specific fields.
 *
 * NOTE: Despite the "batch" name, this upserts a single record. The name
 * reflects the pattern of combining a fetch + optional update in one call.
 *
 * Returns both the final state (`attendance`) and the pre-update snapshot
 * (`existing`) so callers can feed `existing` into the state machine before
 * deciding what to write.
 */
export async function batchUpdateAttendance(
  pb: PocketBase,
  params: { learnerId: string; date?: string; fields?: Record<string, string> },
): Promise<{ attendance: AttendanceRecord; existing: AttendanceRecord; created: boolean }> {
  const { learnerId, fields } = params;
  const date = assertDate(params.date || todayStr(), "date");

  let attendance: AttendanceRecord;
  let created = false;
  try {
    // Try to find an existing record for this learner/date.
    const existing = await pb
      .collection("attendance")
      .getFirstListItem(
        pb.filter("learner = {:learnerId} && date ~ {:date}", {
          learnerId,
          date,
        }),
      );
    attendance = existing as unknown as AttendanceRecord;
  } catch {
    // No record yet — create a blank one so subsequent field updates have an ID to target.
    const record = await pb.collection("attendance").create({ learner: learnerId, date });
    attendance = record as unknown as AttendanceRecord;
    created = true;
  }

  // Snapshot the record before any mutations so the caller can compare old vs new.
  const existing = { ...attendance };

  if (fields && Object.keys(fields).length > 0) {
    const updated = await pb.collection("attendance").update(attendance.id, fields);
    attendance = updated as unknown as AttendanceRecord;
  }

  return { attendance, existing, created };
}

/**
 * Reset all time/status fields on an attendance record back to null.
 * Used by guides to undo a mistaken check-in without deleting the record.
 */
export async function resetAttendance(
  pb: PocketBase,
  learnerId: string,
  date?: string,
): Promise<{ status: "reset" | "no_record"; attendance?: AttendanceRecord }> {
  const targetDate = assertDate(date || todayStr(), "date");
  try {
    const record = await pb
      .collection("attendance")
      .getFirstListItem(
        pb.filter("learner = {:learnerId} && date ~ {:date}", {
          learnerId,
          date: targetDate,
        }),
      );

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
    // Nothing to reset — the record may have been deleted or never created.
    return { status: "no_record" };
  }
}
