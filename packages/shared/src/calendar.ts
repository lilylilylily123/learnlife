import type { CalRecord, CalEvent } from "@learnlife/pb-client";
import { parsePBDate, formatTimeRange, makeDateKey } from "./date-utils";

/**
 * Expand CalRecords into a date-keyed map of CalEvents for the given month.
 *
 * @param records   Raw records from PocketBase
 * @param year      Full year, e.g. 2026
 * @param month     0-indexed month, e.g. 3 = April
 */
export function expandEvents(
  records: CalRecord[],
  year: number,
  month: number,
): Record<string, CalEvent[]> {
  const map: Record<string, CalEvent[]> = {};

  const push = (key: string, ev: CalEvent) => {
    if (!map[key]) map[key] = [];
    map[key].push(ev);
  };

  for (const rec of records) {
    const base: Omit<CalEvent, "id" | "recordId"> = {
      title: rec.title,
      time: formatTimeRange(rec.start, rec.end),
      emoji: rec.emoji ?? "",
      color: rec.color,
    };

    const days: number[] = Array.isArray(rec.recurrence_days)
      ? rec.recurrence_days
      : [];
    const isWeekly = rec.recurrence === "weekly" || days.length > 0;

    if (!isWeekly) {
      const d = parsePBDate(rec.start);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const key = makeDateKey(year, month, d.getDate());
        push(key, { ...base, id: rec.id, recordId: rec.id });
      }
    } else {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const recEnd = rec.recurrence_end
        ? parsePBDate(rec.recurrence_end)
        : null;

      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        // Convert JS getDay() (0=Sun) → Mon-first index (Mon=0 … Sun=6)
        const jsDay = date.getDay();
        const monFirst = jsDay === 0 ? 6 : jsDay - 1;

        if (!days.includes(monFirst)) continue;
        if (recEnd && date > recEnd) continue;

        const key = makeDateKey(year, month, day);
        push(key, { ...base, id: `${rec.id}-${key}`, recordId: rec.id });
      }
    }
  }

  return map;
}
