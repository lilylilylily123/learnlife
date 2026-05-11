import { TIME_THRESHOLDS } from "@learnlife/pb-client";
import type {
  ArrivalStatus,
  AttendanceRecord,
  AttendanceStatus,
  Learner,
  LunchEvent,
} from "@learnlife/pb-client";
import { parsePBDate, todayDateStr } from "./date-utils";

/**
 * MUST STAY IN SYNC WITH packages/pb-client/src/queries/attendance.ts:deriveStatus
 *
 * Map the split (arrival, justified) representation back to the legacy
 * combined `status` enum that older queries and reports still read. There is
 * no "jPresent" concept — being on time is never justified — so present
 * always maps to "present" regardless of the justified flag.
 *
 * A copy lives in @learnlife/pb-client because that package can't depend on
 * @learnlife/shared at runtime without creating a circular workspace dep
 * (shared imports TIME_THRESHOLDS from pb-client). When you change one,
 * change the other and re-run the test suite in both packages.
 */
export function deriveStatus(
  arrival: ArrivalStatus | null,
  justified: boolean,
): AttendanceStatus | null {
  if (arrival === null) return null;
  if (arrival === "present") return "present";
  if (!justified) return arrival;
  return arrival === "late" ? "jLate" : "jAbsent";
}

/**
 * Inverse of deriveStatus: decode the legacy enum back into the split fields.
 * Used by the backfill migration and by aggregation code that needs to
 * fall back to the legacy `status` column when arrival has not been
 * populated yet.
 */
export function splitStatus(
  status: AttendanceStatus | null,
): { arrival: ArrivalStatus | null; justified: boolean } {
  switch (status) {
    case "present": return { arrival: "present", justified: false };
    case "late": return { arrival: "late", justified: false };
    case "absent": return { arrival: "absent", justified: false };
    case "jLate": return { arrival: "late", justified: true };
    case "jAbsent": return { arrival: "absent", justified: true };
    default: return { arrival: null, justified: false };
  }
}

/**
 * Snapshot of a learner's attendance record passed into the state machine.
 * Only the fields relevant to computing the next action are included.
 */
export interface AttendanceState {
  time_in: string | null;
  time_out: string | null;
  lunch_events: LunchEvent[] | null;
  lunch_out: string | null; // legacy — used before lunch_events array was introduced
  lunch_in: string | null; // legacy — used before lunch_events array was introduced
  status: AttendanceStatus | null;
  lunch_status: AttendanceStatus | null;
}

/**
 * Discriminated union of every possible outcome from computeCheckInAction.
 * `fields` mirrors the PocketBase attendance record fields to update.
 *
 *  - check_in         First NFC tap of the day (morning arrival)
 *  - lunch_event      NFC tap during the lunch window; toggles out→in→out…
 *  - late_lunch_return Learner scans in after 2 PM while still marked "out" for lunch
 *  - check_out        End-of-day departure scan (4:59 PM+). If the learner is
 *                     still out for lunch when this fires, lunch is closed in
 *                     the same write and marked as late.
 *  - no_action        All expected events have already been recorded
 */
export type CheckInAction =
  | {
      type: "check_in";
      // `arrival` is the source of truth; `status` is written alongside it
      // so legacy consumers keep working. A learner who was auto-marked
      // absent at noon and then scans in will have arrival flipped back to
      // present/late here — they showed up, so absent no longer holds.
      fields: {
        time_in: string;
        arrival: ArrivalStatus;
        status: AttendanceStatus;
      };
    }
  | { type: "lunch_event"; fields: { lunch_events: string; lunch_status?: AttendanceStatus } }
  | { type: "late_lunch_return"; fields: { lunch_events: string; lunch_status: "late" } }
  | {
      type: "check_out";
      fields: {
        time_out: string;
        lunch_events?: string;
        lunch_status?: "late";
      };
    }
  | { type: "no_action"; reason: string };

/**
 * Pure function that determines what attendance action to take based on
 * the current attendance state and the current time.
 *
 * State machine flow (evaluated in order):
 *   1. No time_in yet                       → check_in  (status = present | late)
 *   2. Lunch window (1–2 PM)                → lunch_event (toggles out/in; sets lunch_status on return)
 *   3. Past checkout cutoff + no time_out   → check_out (also closes an open
 *                                              lunch as late, in the same write)
 *   4. After 2 PM + still out for lunch     → late_lunch_return
 *   5. Otherwise                            → no_action
 *
 * Returns the action type and the fields to update — caller is responsible
 * for actually writing to PocketBase.
 */
export function computeCheckInAction(
  state: AttendanceState,
  now: Date,
): CheckInAction {
  const hour = now.getHours();
  const minute = now.getMinutes();
  // Normalise null to an empty array so downstream code can always use array methods.
  const lunchEvents = (state.lunch_events || []) as LunchEvent[];

  // ── Step 1: Morning check-in ─────────────────────────────────────────────
  // If there is no time_in yet, this is the learner's first scan of the day.
  if (!state.time_in) {
    // Threshold: arriving at or after LATE_HOUR:LATE_MINUTE counts as "late".
    const lateTime = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      TIME_THRESHOLDS.LATE_HOUR,
      TIME_THRESHOLDS.LATE_MINUTE,
      0,
      0,
    );
    const arrival: ArrivalStatus =
      now.getTime() >= lateTime.getTime() ? "late" : "present";

    // Preserve any prior justification: if a guide had marked the learner
    // absent-but-justified before they actually showed up, we still want
    // their late arrival to inherit the excused flag.
    const wasJustified =
      state.status === "jLate" || state.status === "jAbsent";
    const status = deriveStatus(arrival, wasJustified) as AttendanceStatus;

    return {
      type: "check_in",
      fields: { time_in: now.toISOString(), arrival, status },
    };
  }

  // ── Step 2: Lunch window (1 PM – 2 PM) ───────────────────────────────────
  // During this window every tap toggles the learner between "out for lunch"
  // and "back from lunch". Multiple out/in pairs are supported (e.g. quick
  // errand + full lunch break on the same day).
  if (hour >= TIME_THRESHOLDS.LUNCH_START_HOUR && hour < TIME_THRESHOLDS.LUNCH_END_HOUR) {
    // Toggle: if the last event was "in" (or there are no events), next is "out".
    const lastEvent = lunchEvents.length > 0 ? lunchEvents[lunchEvents.length - 1] : null;
    const nextEventType: "out" | "in" =
      !lastEvent || lastEvent.type === "in" ? "out" : "in";

    const updatedEvents = [
      ...lunchEvents,
      { type: nextEventType, time: now.toISOString() },
    ];

    const fields: { lunch_events: string; lunch_status?: AttendanceStatus } = {
      // Serialised to JSON because PocketBase stores this as a JSON column.
      lunch_events: JSON.stringify(updatedEvents),
    };

    // Only set lunch_status when the learner is returning (type === "in").
    if (nextEventType === "in") {
      const lunchLateTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        TIME_THRESHOLDS.LUNCH_LATE_HOUR,
        TIME_THRESHOLDS.LUNCH_LATE_MINUTE,
        0,
        0,
      );
      fields.lunch_status =
        now.getTime() >= lunchLateTime.getTime() ? "late" : "present";
    }

    return { type: "lunch_event", fields };
  }

  // Is the learner currently mid-lunch (an unmatched "out" event)?
  // Check both the modern lunch_events array and the legacy single-field format.
  const currentlyAtLunch =
    (lunchEvents.length > 0 && lunchEvents[lunchEvents.length - 1].type === "out") ||
    Boolean(state.lunch_out && !state.lunch_in);

  // ── Step 3: End-of-day checkout ────────────────────────────────────────────
  // Fridays use an earlier checkout time (2 PM) than other days (4:59 PM).
  // Only fire if time_out has not been recorded yet to prevent double-checkouts.
  // Evaluated *before* late_lunch_return so a learner who never returned from
  // lunch gets a single combined write — lunch closed as late + check_out —
  // instead of two separate scans.
  const isFriday = now.getDay() === 5;
  const checkoutHour = isFriday ? TIME_THRESHOLDS.FRIDAY_CHECKOUT_HOUR : TIME_THRESHOLDS.CHECKOUT_HOUR;
  const checkoutMinute = isFriday ? TIME_THRESHOLDS.FRIDAY_CHECKOUT_MINUTE : TIME_THRESHOLDS.CHECKOUT_MINUTE;
  if (
    (hour > checkoutHour ||
      (hour === checkoutHour && minute >= checkoutMinute)) &&
    !state.time_out
  ) {
    const fields: {
      time_out: string;
      lunch_events?: string;
      lunch_status?: "late";
    } = { time_out: now.toISOString() };

    if (currentlyAtLunch) {
      const updatedEvents = [
        ...lunchEvents,
        { type: "in" as const, time: now.toISOString() },
      ];
      fields.lunch_events = JSON.stringify(updatedEvents);
      fields.lunch_status = "late";
    }

    return { type: "check_out", fields };
  }

  // ── Step 4: Late lunch return (after 2 PM, before checkout) ───────────────
  // Lunch window is closed but the learner is still marked as "out". Append
  // a synthetic "in" event and mark lunch_status as "late".
  if (hour >= TIME_THRESHOLDS.LUNCH_LATE_HOUR && currentlyAtLunch) {
    const updatedEvents = [
      ...lunchEvents,
      { type: "in" as const, time: now.toISOString() },
    ];

    return {
      type: "late_lunch_return",
      fields: {
        lunch_events: JSON.stringify(updatedEvents),
        lunch_status: "late",
      },
    };
  }

  // ── Fallback: nothing left to record ─────────────────────────────────────
  return { type: "no_action", reason: "All check-ins complete for today" };
}

// ── Auto-absent sweep ────────────────────────────────────────────────────────

/**
 * Determine which learners should be auto-marked absent for the day.
 *
 * Inputs:
 *   - `records`     all attendance records for today (one or zero per learner)
 *   - `learners`    every learner the dashboard cares about
 *   - `now`         current time (test-mode injectable)
 *
 * Rules:
 *   1. Do nothing before the ABSENT cutoff (noon by default).
 *   2. Skip weekends (no school).
 *   3. A learner is a candidate iff they have no `time_in` for today AND no
 *      `arrival` has been recorded yet. The `arrival` check makes the sweep
 *      idempotent — re-running it never overwrites a guide's manual call,
 *      and it never re-marks someone who is already absent.
 *   4. Fallback for records created before the migration: if `arrival` is
 *      null but the legacy `status` is set, treat that as "guide already
 *      handled this" and skip.
 *
 * Returns the learner IDs that should be flipped to arrival="absent". Caller
 * is responsible for actually writing the attendance updates.
 */
export function findLearnersToMarkAbsent(
  records: AttendanceRecord[],
  learners: Pick<Learner, "id">[],
  now: Date,
): string[] {
  const hour = now.getHours();
  const minute = now.getMinutes();
  const past =
    hour > TIME_THRESHOLDS.ABSENT_HOUR ||
    (hour === TIME_THRESHOLDS.ABSENT_HOUR && minute >= TIME_THRESHOLDS.ABSENT_MINUTE);
  if (!past) return [];

  // Sun=0, Sat=6 — skip both. Schools that hold weekend sessions would need
  // a calendar/exception system; out of scope here.
  const day = now.getDay();
  if (day === 0 || day === 6) return [];

  // Index records by learner for O(1) lookup.
  const byLearner = new Map<string, AttendanceRecord>();
  for (const r of records) byLearner.set(r.learner, r);

  const out: string[] = [];
  for (const learner of learners) {
    const rec = byLearner.get(learner.id);
    if (rec) {
      // Skip if any state is already recorded for the day — never overwrite.
      if (rec.time_in) continue;
      if (rec.arrival !== null && rec.arrival !== undefined) continue;
      if (rec.status) continue; // legacy fallback
    }
    out.push(learner.id);
  }
  return out;
}

// ── Summary / aggregation helpers ────────────────────────────────────────────
// Pure functions used by reporting views to roll up many attendance records
// into per-learner or per-cohort counters. No side effects, no network calls —
// callers load records however they like and pass them in.

/**
 * Rolled-up counters for a single learner (or cohort) over a set of records.
 * All time values are "minutes past midnight" so they can be averaged and
 * rendered consistently regardless of the day a record falls on.
 *
 * Percentage fields are computed against `expectedDays - jAbsent` — justified
 * absences never hurt the rate, and days with no record at all are rolled
 * into `missingRecords` and treated as unaccounted-for absence.
 */
export interface AttendanceSummary {
  daysTracked: number;               // records considered
  expectedDays: number;              // weekdays × learners expected; defaults to daysTracked
  missingRecords: number;            // expectedDays − daysTracked, floored at 0
  present: number;
  late: number;
  absent: number;
  jLate: number;
  jAbsent: number;
  avgCheckInMinutes: number | null;  // null if no records had time_in
  avgCheckOutMinutes: number | null; // null if no records had time_out
  totalLunchMinutes: number;         // summed duration across lunch_events pairs
  lateLunches: number;               // lunch_status === "late"
  missingCheckouts: number;          // time_in present but time_out missing (past days only)
  onTimePct: number;                 // present / (expectedDays − jAbsent)
  attendancePct: number;             // (present + late + jLate) / (expectedDays − jAbsent)
  absentPct: number;                 // (absent + missingRecords) / (expectedDays − jAbsent)
}

export interface SummarizeOptions {
  /** School days the learner/cohort was expected to be present in the range.
   *  When omitted we default to `records.length`, which yields records-only
   *  math. Passing an explicit value enables proper denominator accounting —
   *  days with no record are rolled into `missingRecords` instead of silently
   *  disappearing. */
  expectedDays?: number;
  /** Today's date as YYYY-MM-DD. Records with this date don't count toward
   *  `missingCheckouts` since the learner may not have left yet. Defaults to
   *  the local machine's today. Exposed so tests can pin the reference date. */
  today?: string;
}

/** Minutes past local midnight for an ISO timestamp, or null if unparseable. */
function minutesOfDay(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = parsePBDate(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Sum paired out/in lunch events into total minutes spent at lunch.
 * Unpaired trailing "out" events (learner never returned) are ignored to avoid
 * inflating the total with an open-ended duration. Legacy `lunch_out`/`lunch_in`
 * fields are consulted when `lunch_events` is empty.
 */
function lunchMinutes(record: AttendanceRecord): number {
  const events = record.lunch_events;
  if (events && events.length > 0) {
    let total = 0;
    let openOut: LunchEvent | null = null;
    for (const ev of events) {
      if (ev.type === "out") {
        openOut = ev;
      } else if (ev.type === "in" && openOut) {
        const start = parsePBDate(openOut.time).getTime();
        const end = parsePBDate(ev.time).getTime();
        if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
          total += Math.round((end - start) / 60000);
        }
        openOut = null;
      }
    }
    return total;
  }
  if (record.lunch_out && record.lunch_in) {
    const start = parsePBDate(record.lunch_out).getTime();
    const end = parsePBDate(record.lunch_in).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
      return Math.round((end - start) / 60000);
    }
  }
  return 0;
}

/**
 * Aggregate a set of attendance records into summary counters.
 * Does not assume the records share a learner — caller can pass per-learner
 * slices via `summarizeByLearner` or a pre-filtered cohort slice directly.
 */
export function summarizeAttendance(
  records: AttendanceRecord[],
  options: SummarizeOptions = {},
): AttendanceSummary {
  let present = 0, late = 0, absent = 0, jLate = 0, jAbsent = 0;
  let checkInSum = 0, checkInCount = 0;
  let checkOutSum = 0, checkOutCount = 0;
  let totalLunch = 0;
  let lateLunches = 0;
  let missingCheckouts = 0;

  const today = options.today ?? todayDateStr();

  for (const r of records) {
    // Prefer the split (arrival + justified) representation when present;
    // fall back to the legacy status enum so records that haven't been
    // touched since the migration are still counted correctly.
    const arrival = r.arrival ?? null;
    if (arrival !== null) {
      if (arrival === "present") present++;
      else if (arrival === "late") (r.justified ? jLate++ : late++);
      else if (arrival === "absent") (r.justified ? jAbsent++ : absent++);
    } else {
      switch (r.status) {
        case "present": present++; break;
        case "late": late++; break;
        case "absent": absent++; break;
        case "jLate": jLate++; break;
        case "jAbsent": jAbsent++; break;
      }
    }
    const inMin = minutesOfDay(r.time_in);
    if (inMin !== null) { checkInSum += inMin; checkInCount++; }
    const outMin = minutesOfDay(r.time_out);
    if (outMin !== null) { checkOutSum += outMin; checkOutCount++; }

    totalLunch += lunchMinutes(r);
    if (r.lunch_status === "late") lateLunches++;
    // A learner who checked in today but hasn't checked out yet isn't "missing"
    // — their day isn't over. Only count past days.
    if (r.time_in && !r.time_out && r.date.slice(0, 10) < today) missingCheckouts++;
  }

  const daysTracked = records.length;
  const rates = computeAttendanceRates(
    { present, late, absent, jLate, jAbsent, daysTracked },
    options.expectedDays ?? daysTracked,
  );

  return {
    daysTracked,
    expectedDays: rates.expectedDays,
    missingRecords: rates.missingRecords,
    present, late, absent, jLate, jAbsent,
    avgCheckInMinutes: checkInCount === 0 ? null : Math.round(checkInSum / checkInCount),
    avgCheckOutMinutes: checkOutCount === 0 ? null : Math.round(checkOutSum / checkOutCount),
    totalLunchMinutes: totalLunch,
    lateLunches,
    missingCheckouts,
    onTimePct: rates.onTimePct,
    attendancePct: rates.attendancePct,
    absentPct: rates.absentPct,
  };
}

/**
 * Counter bundle used by `computeAttendanceRates`. Separate from
 * `AttendanceSummary` so cohort-level callers can sum counters across learners
 * and run the rate math once with a cohort-wide `expectedDays`.
 */
export interface AttendanceCounts {
  present: number;
  late: number;
  absent: number;
  jLate: number;
  jAbsent: number;
  daysTracked: number;
}

/**
 * Derive attendance rates from summed counters + expected days. Factored out so
 * per-learner summaries and cohort totals use identical math, and so tests can
 * exercise the rate logic directly without building records.
 *
 * Rules:
 *   - `expectedDays` is bumped to at least `daysTracked` to avoid >100% rates
 *     when records exist outside the declared range (e.g. Saturday scans).
 *   - `missingRecords = max(0, expectedDays − daysTracked)` — days with no row.
 *   - `eligibleDays = max(0, expectedDays − jAbsent)` — justified absences are
 *     excluded from the denominator so they never hurt the rate.
 *   - All three rates are capped at 100 to survive edge cases cleanly.
 */
export function computeAttendanceRates(
  counts: AttendanceCounts,
  expectedDaysInput: number,
): {
  expectedDays: number;
  missingRecords: number;
  onTimePct: number;
  attendancePct: number;
  absentPct: number;
} {
  const expectedDays = Math.max(expectedDaysInput, counts.daysTracked);
  const missingRecords = Math.max(0, expectedDays - counts.daysTracked);
  const eligibleDays = Math.max(0, expectedDays - counts.jAbsent);
  if (eligibleDays === 0) {
    return { expectedDays, missingRecords, onTimePct: 0, attendancePct: 0, absentPct: 0 };
  }
  const cap = (v: number) => Math.min(100, Math.max(0, Math.round(v)));
  const attended = counts.present + counts.late + counts.jLate;
  const unaccounted = counts.absent + missingRecords;
  return {
    expectedDays,
    missingRecords,
    onTimePct: cap((counts.present / eligibleDays) * 100),
    attendancePct: cap((attended / eligibleDays) * 100),
    absentPct: cap((unaccounted / eligibleDays) * 100),
  };
}

/**
 * Group records by `learner` FK and summarize each group.
 * Returns a Map keyed by learner id; callers that have a learner list can
 * iterate it and look up (or default to an empty summary for learners with
 * zero records in the range). Pass `expectedDays` (weekdays in the range) so
 * each learner's rate accounts for days with no record at all.
 */
export function summarizeByLearner(
  records: AttendanceRecord[],
  options: SummarizeOptions = {},
): Map<string, AttendanceSummary> {
  const buckets = new Map<string, AttendanceRecord[]>();
  for (const r of records) {
    const arr = buckets.get(r.learner);
    if (arr) arr.push(r);
    else buckets.set(r.learner, [r]);
  }
  const out = new Map<string, AttendanceSummary>();
  for (const [learnerId, group] of buckets) {
    out.set(learnerId, summarizeAttendance(group, options));
  }
  return out;
}

/**
 * Empty summary used when a learner has zero records in the selected range.
 * Pass `expectedDays` to reflect the range so the learner registers as fully
 * absent (100% absentPct) rather than silently looking like 0-of-0.
 */
export function emptySummary(expectedDays = 0): AttendanceSummary {
  const rates = computeAttendanceRates(
    { present: 0, late: 0, absent: 0, jLate: 0, jAbsent: 0, daysTracked: 0 },
    expectedDays,
  );
  return {
    daysTracked: 0,
    expectedDays: rates.expectedDays,
    missingRecords: rates.missingRecords,
    present: 0, late: 0, absent: 0, jLate: 0, jAbsent: 0,
    avgCheckInMinutes: null,
    avgCheckOutMinutes: null,
    totalLunchMinutes: 0,
    lateLunches: 0,
    missingCheckouts: 0,
    onTimePct: rates.onTimePct,
    attendancePct: rates.attendancePct,
    absentPct: rates.absentPct,
  };
}

/** Format minutes-past-midnight as "HH:MM AM/PM"; returns "—" for null. */
export function formatMinutesOfDay(min: number | null): string {
  if (min === null) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}
