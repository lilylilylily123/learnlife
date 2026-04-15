import { TIME_THRESHOLDS } from "@learnlife/pb-client";
import type { LunchEvent, AttendanceStatus } from "@learnlife/pb-client";

export interface AttendanceState {
  time_in: string | null;
  time_out: string | null;
  lunch_events: LunchEvent[] | null;
  lunch_out: string | null; // legacy
  lunch_in: string | null; // legacy
  status: AttendanceStatus | null;
  lunch_status: AttendanceStatus | null;
}

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
 * Returns the action type and the fields to update — caller is responsible
 * for actually writing to PocketBase.
 */
export function computeCheckInAction(
  state: AttendanceState,
  now: Date,
): CheckInAction {
  const hour = now.getHours();
  const minute = now.getMinutes();
  const lunchEvents = (state.lunch_events || []) as LunchEvent[];

  // Step 1: Morning check-in
  if (!state.time_in) {
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

  // Step 2: Lunch window (1pm-2pm) — multiple out/in events
  if (hour >= TIME_THRESHOLDS.LUNCH_START_HOUR && hour < TIME_THRESHOLDS.LUNCH_END_HOUR) {
    const lastEvent = lunchEvents.length > 0 ? lunchEvents[lunchEvents.length - 1] : null;
    const nextEventType: "out" | "in" =
      !lastEvent || lastEvent.type === "in" ? "out" : "in";

    const updatedEvents = [
      ...lunchEvents,
      { type: nextEventType, time: now.toISOString() },
    ];

    const fields: { lunch_events: string; lunch_status?: AttendanceStatus } = {
      lunch_events: JSON.stringify(updatedEvents),
    };

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

  // Step 3: After 2pm, late lunch return
  if (hour >= TIME_THRESHOLDS.LUNCH_LATE_HOUR) {
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

  // Step 4: Day checkout (4:59pm+)
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

  return { type: "no_action", reason: "All check-ins complete for today" };
}
