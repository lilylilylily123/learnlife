import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parsePBDate,
  formatTimeRange,
  makeDateKey,
  toOccurrenceDate,
  dateKeyToOccurrenceDate,
  prettyTimestamp,
  todayDateStr,
  countWeekdays,
} from "@learnlife/shared";

describe("parsePBDate", () => {
  it("parses PocketBase's space-separated format", () => {
    const d = parsePBDate("2026-04-20 09:00:00.000Z");
    expect(d.getTime()).toBe(new Date("2026-04-20T09:00:00.000Z").getTime());
  });

  it("still parses standard ISO with a T separator", () => {
    const d = parsePBDate("2026-04-20T09:00:00.000Z");
    expect(d.getTime()).toBe(new Date("2026-04-20T09:00:00.000Z").getTime());
  });
});

describe("formatTimeRange", () => {
  it("renders an en-dash separated start/end pair", () => {
    const out = formatTimeRange(
      "2026-04-20T09:00:00.000Z",
      "2026-04-20T10:30:00.000Z",
    );
    // Locale-dependent — assert structure not exact text.
    expect(out).toContain("–");
    expect(out.split(" – ")).toHaveLength(2);
  });
});

describe("makeDateKey", () => {
  it("uses 1-indexed month in the key (month arg is 0-indexed)", () => {
    expect(makeDateKey(2026, 0, 1)).toBe("2026-1-1");
    expect(makeDateKey(2026, 3, 20)).toBe("2026-4-20");
    expect(makeDateKey(2026, 11, 31)).toBe("2026-12-31");
  });

  it("does not zero-pad — month/day are emitted bare", () => {
    expect(makeDateKey(2026, 2, 5)).toBe("2026-3-5");
  });
});

describe("toOccurrenceDate", () => {
  it("zero-pads month and day to two digits", () => {
    expect(toOccurrenceDate(2026, 0, 1)).toBe("2026-01-01");
    expect(toOccurrenceDate(2026, 3, 5)).toBe("2026-04-05");
    expect(toOccurrenceDate(2026, 11, 31)).toBe("2026-12-31");
  });
});

describe("dateKeyToOccurrenceDate", () => {
  it("round-trips through makeDateKey / toOccurrenceDate", () => {
    expect(dateKeyToOccurrenceDate("2026-4-5")).toBe("2026-04-05");
    expect(dateKeyToOccurrenceDate("2026-12-31")).toBe("2026-12-31");
  });

  it("returns null for malformed input", () => {
    expect(dateKeyToOccurrenceDate("nope")).toBeNull();
    expect(dateKeyToOccurrenceDate("2026-4")).toBeNull();
    expect(dateKeyToOccurrenceDate("2026-x-5")).toBeNull();
  });
});

describe("prettyTimestamp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Fixed "now" — Mon Apr 20 2026 12:00 local.
    vi.setSystemTime(new Date(2026, 3, 20, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("returns em-dash for null/undefined", () => {
    expect(prettyTimestamp(null)).toBe("—");
    expect(prettyTimestamp(undefined)).toBe("—");
    expect(prettyTimestamp("")).toBe("—");
  });

  it("returns the raw value for unparseable input", () => {
    expect(prettyTimestamp("not a date")).toBe("not a date");
  });

  it("renders only the time for same-day timestamps", () => {
    const sameDay = new Date(2026, 3, 20, 9, 30).toISOString();
    const out = prettyTimestamp(sameDay);
    // Should not contain a weekday abbreviation or month name.
    expect(out).not.toMatch(/Mon|Apr/);
    expect(out).toMatch(/\d{1,2}:\d{2}/);
  });

  it("renders weekday + time within the past week", () => {
    const threeDaysAgo = new Date(2026, 3, 17, 9, 30).toISOString();
    const out = prettyTimestamp(threeDaysAgo);
    expect(out).toMatch(/Fri|Thu|Sat/); // weekday abbreviation
  });

  it("renders full date + time for older timestamps", () => {
    const monthAgo = new Date(2026, 2, 1, 9, 30).toISOString();
    const out = prettyTimestamp(monthAgo);
    expect(out).toMatch(/2026/);
  });
});

describe("todayDateStr", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T15:30:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("returns YYYY-MM-DD for today in UTC", () => {
    expect(todayDateStr()).toBe("2026-04-20");
  });
});

describe("countWeekdays", () => {
  it("counts Mon–Fri in a one-week range", () => {
    // Mon Apr 20 → Sun Apr 26 = 5 weekdays
    expect(countWeekdays("2026-04-20", "2026-04-26")).toBe(5);
  });

  it("returns 1 when the range is a single weekday", () => {
    expect(countWeekdays("2026-04-20", "2026-04-20")).toBe(1);
  });

  it("returns 0 when the range is a single weekend day", () => {
    expect(countWeekdays("2026-04-25", "2026-04-25")).toBe(0);
  });

  it("returns 0 for a reversed range", () => {
    expect(countWeekdays("2026-04-26", "2026-04-20")).toBe(0);
  });

  it("returns 0 for malformed input", () => {
    expect(countWeekdays("not-a-date", "2026-04-26")).toBe(0);
    expect(countWeekdays("2026-04-20", "")).toBe(0);
  });

  it("handles a multi-week range correctly", () => {
    // Mon Apr 6 → Fri Apr 24 (inclusive) = 3 full work weeks = 15 weekdays.
    expect(countWeekdays("2026-04-06", "2026-04-24")).toBe(15);
  });
});
