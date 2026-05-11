import type { CalRecord, CalEvent } from "@learnlife/pb-client";
import { parsePBDate, formatTimeRange, makeDateKey } from "./date-utils";

/**
 * Expand CalRecords into a date-keyed map of CalEvents for the given month.
 *
 * One-off events are included only if they fall within the requested month.
 * Weekly recurring events are expanded for every matching weekday in the month,
 * respecting the optional recurrence_end date.
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
      const recEnd = rec.recurrence_end
        ? parsePBDate(rec.recurrence_end)
        : null;

      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);

        // PocketBase recurrence_days uses Mon=0 … Sun=6 (Monday-first ISO week).
        // JS Date.getDay() returns Sun=0 … Sat=6, so we convert:
        //   Sunday (0) → 6, Monday (1) → 0, … Saturday (6) → 5
        const jsDay = date.getDay();
        const monFirst = jsDay === 0 ? 6 : jsDay - 1;

        if (!days.includes(monFirst)) continue; // weekday not in recurrence schedule
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
