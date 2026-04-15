import { TIME_THRESHOLDS } from "@learnlife/pb-client";
import type { LunchEvent, AttendanceStatus } from "@learnlife/pb-client";

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
 *  - check_out        End-of-day departure scan (4:59 PM+)
 *  - no_action        All expected events have already been recorded
 */
export type CheckInAction =
  | { type: "check_in"; fields: { time_in: string; status: AttendanceStatus } }
  | { type: "lunch_event"; fields: { lunch_events: string; lunch_status?: AttendanceStatus } }
  | { type: "late_lunch_return"; fields: { lunch_events: string; lunch_status: "late" } }
  | { type: "check_out"; fields: { time_out: string } }
  | { type: "no_action"; reason: string };

/**
 * Pure function that determines what attendance action to take based on
 * the current attendance state and the current time.
 *
 * State machine flow (evaluated in order):
 *   1. No time_in yet           → check_in  (status = present | late)
 *   2. Lunch window (1–2 PM)    → lunch_event (toggles out/in; sets lunch_status on return)
 *   3. After 2 PM + still out   → late_lunch_return
 *   4. 4:59 PM+ and no time_out → check_out
 *   5. Otherwise                → no_action
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
    const status: AttendanceStatus =
      now.getTime() >= lateTime.getTime() ? "late" : "present";

    return {
      type: "check_in",
      fields: { time_in: now.toISOString(), status },
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

  // ── Step 3: Late lunch return (after 2 PM) ────────────────────────────────
  // Lunch window is closed but the learner is still marked as "out". Append
  // a synthetic "in" event and mark lunch_status as "late".
  if (hour >= TIME_THRESHOLDS.LUNCH_LATE_HOUR) {
    // Check both the modern lunch_events array and the legacy single-field format.
    const currentlyAtLunch =
      lunchEvents.length > 0 &&
      lunchEvents[lunchEvents.length - 1].type === "out";
    const currentlyAtLunchLegacy = state.lunch_out && !state.lunch_in;

    if (currentlyAtLunch || currentlyAtLunchLegacy) {
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
  }

  // ── Step 4: End-of-day checkout (4:59 PM+) ────────────────────────────────
  // Only fire if time_out has not been recorded yet to prevent double-checkouts.
  if (
    (hour > TIME_THRESHOLDS.CHECKOUT_HOUR ||
      (hour === TIME_THRESHOLDS.CHECKOUT_HOUR && minute >= TIME_THRESHOLDS.CHECKOUT_MINUTE)) &&
    !state.time_out
  ) {
    return {
      type: "check_out",
      fields: { time_out: now.toISOString() },
    };
  }

  // ── Fallback: nothing left to record ─────────────────────────────────────
  return { type: "no_action", reason: "All check-ins complete for today" };
}
