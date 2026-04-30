/**
 * Normalize PocketBase datetime strings.
 * PB returns "2026-04-01 09:00:00.000Z" (space separator)
 * which iOS JavaScriptCore cannot parse.
 */
export function parsePBDate(iso: string): Date {
  return new Date(iso.replace(" ", "T"));
}

/**
 * Format a time range for display.
 * e.g. "09:00 AM – 10:30 AM"
 */
export function formatTimeRange(startIso: string, endIso: string): string {
  const fmt = (iso: string) =>
    parsePBDate(iso).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

/**
 * Create a date key string for calendar lookups.
 * Month is 0-indexed (JS convention). Output: "YEAR-MONTH1-DAY"
 */
export function makeDateKey(year: number, month: number, day: number): string {
  return `${year}-${month + 1}-${day}`;
}

/**
 * Canonical occurrence date for RSVP rows: zero-padded "YYYY-MM-DD".
 * Distinct from makeDateKey because the database column is sortable text and
 * benefits from fixed-width formatting. Month is 0-indexed (JS convention).
 */
export function toOccurrenceDate(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Convert a `makeDateKey` output ("YYYY-M-D") into the canonical
 * occurrence_date format ("YYYY-MM-DD"). Returns null for malformed input.
 */
export function dateKeyToOccurrenceDate(dateKey: string): string | null {
  const parts = dateKey.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return toOccurrenceDate(parts[0], parts[1] - 1, parts[2]);
}

/**
 * Format a timestamp for display (platform-agnostic, string-only version).
 * Returns a compact string representation.
 *
 * - Same day: just the time (e.g. "2:30 PM")
 * - Within a week: weekday + time (e.g. "Mon 2:30 PM")
 * - Older: date + time (e.g. "Apr 10, 2026 2:30 PM")
 */
export function prettyTimestamp(val?: string | null): string {
  if (!val) return "—";

  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return val;

  const now = Date.now();
  const diff = now - d.getTime();

  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateLong = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // Same day — just time
  const dt = new Date(now);
  if (
    d.getFullYear() === dt.getFullYear() &&
    d.getMonth() === dt.getMonth() &&
    d.getDate() === dt.getDate()
  ) {
    return time;
  }

  // Within a week — weekday + time
  const dayDiff = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (dayDiff <= 7) {
    const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
    return `${weekday} ${time}`;
  }

  // Older — full date + time
  return `${dateLong} ${time}`;
}

/**
 * Get today's date as YYYY-MM-DD string.
 */
export function todayDateStr(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Count Mon–Fri days in the inclusive range [from, to]. Weekends are skipped;
 * holidays are not known to this layer and are counted as weekdays. Returns 0
 * for malformed or reversed ranges.
 *
 * Used as the denominator for attendance percentages so that days with no
 * record still factor in to the rate.
 */
export function countWeekdays(from: string, to: string): number {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  if (end.getTime() < start.getTime()) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function parseDateOnly(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}
