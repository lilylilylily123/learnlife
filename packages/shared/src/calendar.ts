import type { CalRecord, CalEvent } from "@learnlife/pb-client";
import { parsePBDate, formatTimeRange, makeDateKey } from "./date-utils";

/**
 * Truncate an instant to local midnight of its own calendar day.
 *
 * The weekly loop builds each candidate day as `new Date(year, month, day)`,
 * i.e. local midnight, while `start` and `recurrence_end` are full datetimes.
 * Both series bounds are put through this so the comparisons are date-only;
 * see the note at the guards for why that matters. Uses local calendar
 * getters to match how the candidate day is constructed, and how the one-off
 * branch already reads `rec.start`.
 */
const dayOnly = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Expand CalRecords into a date-keyed map of CalEvents for the given month.
 *
 * One-off events are included only if they fall within the requested month.
 * Weekly recurring events are expanded for every matching weekday in the month
 * that falls within the series' own bounds: on or after `start`, and on or
 * before the optional `recurrence_end`.
 *
 * @param records   Raw records from PocketBase (all records for the user; the
 *                  PocketBase list rule handles programme-based filtering)
 * @param year      Full year, e.g. 2026
 * @param month     0-indexed month, e.g. 3 = April
 * @returns         Map from "YEAR-M-D" keys to arrays of CalEvents
 */
export function expandEvents(
  records: CalRecord[],
  year: number,
  month: number,
): Record<string, CalEvent[]> {
  const map: Record<string, CalEvent[]> = {};

  // Helper: append a CalEvent to the correct date bucket, creating it if needed.
  const push = (key: string, ev: CalEvent) => {
    if (!map[key]) map[key] = [];
    map[key].push(ev);
  };

  for (const rec of records) {
    // Build the display-only fields that are shared between all occurrences.
    const base: Omit<CalEvent, "id" | "recordId"> = {
      title: rec.title,
      time: formatTimeRange(rec.start, rec.end),
      emoji: rec.emoji ?? "",
      color: rec.color,
      createdBy: rec.created_by,
    };

    // A record is treated as weekly if it declares recurrence="weekly" OR
    // if it has recurrence_days populated (belt-and-suspenders).
    const days: number[] = Array.isArray(rec.recurrence_days)
      ? rec.recurrence_days
      : [];
    const isWeekly = rec.recurrence === "weekly" || days.length > 0;

    if (!isWeekly) {
      // ── One-off event ─────────────────────────────────────────────────────
      // Only include if the event's start date falls within the requested month.
      const d = parsePBDate(rec.start);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const key = makeDateKey(year, month, d.getDate());
        // id === recordId for one-off events (no suffix needed).
        push(key, { ...base, id: rec.id, recordId: rec.id });
      }
    } else {
      // ── Recurring (weekly) event ──────────────────────────────────────────
      // Iterate every day of the requested month and include days that match
      // one of the configured recurrence_days.
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      // Both bounds are date-only (see `dayOnly`). `recurrence_end` behaved
      // this way already — `date` is midnight, so any time-of-day on the end
      // day compared as "not after" — and normalising makes that explicit and
      // symmetric with the start bound below.
      const recStart = dayOnly(parsePBDate(rec.start));
      const recEnd = rec.recurrence_end
        ? dayOnly(parsePBDate(rec.recurrence_end))
        : null;

      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);

        // PocketBase recurrence_days uses Mon=0 … Sun=6 (Monday-first ISO week).
        // JS Date.getDay() returns Sun=0 … Sat=6, so we convert:
        //   Sunday (0) → 6, Monday (1) → 0, … Saturday (6) → 5
        const jsDay = date.getDay();
        const monFirst = jsDay === 0 ? 6 : jsDay - 1;

        if (!days.includes(monFirst)) continue; // weekday not in recurrence schedule
        // Date-only, and inclusive at both ends: the occurrence falling on the
        // start date is the series' first, and the one on `recurrence_end` is
        // its last. Comparing the raw datetimes instead would drop that first
        // occurrence for any series starting after 00:00, because `date` is
        // midnight and would sort before e.g. a 09:00 start. Do not "simplify"
        // these back to `parsePBDate(rec.start)`.
        if (date < recStart) continue;          // before the series began
        if (recEnd && date > recEnd) continue;  // past the series end date

        const key = makeDateKey(year, month, day);
        // Suffix the record ID with the date key so each occurrence has a unique
        // stable id (used as React key and for targeted mutations in the UI).
        push(key, { ...base, id: `${rec.id}-${key}`, recordId: rec.id });
      }
    }
  }

  return map;
}
