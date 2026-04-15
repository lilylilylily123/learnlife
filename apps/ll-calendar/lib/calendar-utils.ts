// Pure calendar utility functions — no PocketBase or React Native deps.
// Kept separate so they can be unit-tested without any mocking.

export type CalRecurrence = "none" | "weekly";

export interface CalRecord {
  id: string;
  title: string;
  start: string; // ISO datetime string
  end: string;   // ISO datetime string
  color: string;
  emoji: string;
  type: "event" | "class";
  recurrence: CalRecurrence;
  recurrence_days: number[]; // 0=Mon … 6=Sun, only when recurrence="weekly"
  recurrence_end: string;    // ISO date string or ""
  created_by: string;
}

export interface CalEvent {
  id: string;       // recordId for one-off; "recordId-YEAR-M-D" for recurring
  recordId: string; // original PocketBase record ID (for mutations)
  title: string;
  time: string;     // "09:00 AM – 10:30 AM"
  emoji: string;
  color: string;
}

/** Normalize PocketBase datetime strings: PB returns "2026-04-01 09:00:00.000Z" (space) which iOS JavaScriptCore cannot parse. */
function parsePBDate(iso: string): Date {
  return new Date(iso.replace(" ", "T"));
}

export function formatTimeRange(startIso: string, endIso: string): string {
  const fmt = (iso: string) =>
    parsePBDate(iso).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

export function makeDateKey(year: number, month: number, day: number): string {
  return `${year}-${month + 1}-${day}`;
}

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
  month: number
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

    // Determine if this is a recurring event: explicitly marked "weekly",
    // or has recurrence_days set (PocketBase may omit the recurrence field).
    const days: number[] = Array.isArray(rec.recurrence_days) ? rec.recurrence_days : [];
    const isWeekly = rec.recurrence === "weekly" || days.length > 0;

    if (!isWeekly) {
      const d = parsePBDate(rec.start);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const key = makeDateKey(year, month, d.getDate());
        push(key, { ...base, id: rec.id, recordId: rec.id });
      }
    } else {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const recEnd = rec.recurrence_end ? parsePBDate(rec.recurrence_end) : null;

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
