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
