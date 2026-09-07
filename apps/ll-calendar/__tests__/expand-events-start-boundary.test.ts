/**
 * Regression tests for the weekly-series start boundary in `expandEvents`
 * (`packages/shared/src/calendar.ts`).
 *
 * ── The bug these pin (fixed) ─────────────────────────────────────────────
 * `expandEvents` expands a weekly series by walking every day of the
 * *requested* month and emitting an occurrence whenever the weekday matches
 * `recurrence_days`. The loop used to apply exactly two filters:
 *
 *     if (!days.includes(monFirst)) continue;  // weekday not in schedule
 *     if (recEnd && date > recEnd) continue;   // past the series end date
 *
 * `rec.start` was read only for the display-only `time` field
 * (`formatTimeRange`) and, in the non-recurring branch, for the month gate.
 * The weekly branch never compared the generated date against it, so the
 * series had an upper bound (`recurrence_end`) but **no lower bound**: a
 * weekly event reached infinitely far into the past. A series starting in
 * March was emitted for February, January, and every prior month the user
 * paged back to. `app/(tabs)/calendar.tsx` has prev/next month navigation and
 * re-expands for whichever month is displayed, so it was directly reachable.
 *
 * The fix adds `if (date < recStart) continue;` with both bounds normalised
 * to local midnight via `dayOnly`.
 *
 * ── Two things to preserve if you touch that code ─────────────────────────
 * 1. The bound is **date-only**. `rec.start` carries a time component, while
 *    the loop's candidate `date` is local midnight. Comparing the raw
 *    datetimes drops the first occurrence of every series starting after
 *    00:00 — midnight sorts before 09:00. "includes the occurrence falling
 *    exactly on the start date" is the case that catches that.
 * 2. The bound is **inclusive**, symmetric with `recurrence_end`.
 *
 * Affected weekly only: `CalRecurrence` is `"none" | "weekly"`, so there is
 * no daily/monthly path, and the one-off branch was already gated on the
 * start month — pinned below as a contrast.
 *
 * All dates run under TZ=UTC (set in package.json test script).
 *
 * February 2026 Mondays: 2, 9, 16, 23   (28 days, not a leap year)
 * March 2026 Mondays:    2, 9, 16, 23, 30
 * April 2026 Mondays:    6, 13, 20, 27
 */

import { expandEvents } from "@learnlife/shared";
import type { CalRecord } from "@learnlife/pb-client";

/** Mon=0 … Sun=6, matching PocketBase's `recurrence_days`. */
const MONDAY = 0;

/**
 * A weekly Monday series whose first occurrence is Monday 9 March 2026.
 * Nothing before that date should ever be emitted.
 */
function mondaySeriesFromMarch9(overrides: Partial<CalRecord> = {}): CalRecord {
  return {
    id: "weekly1",
    title: "Weekly Standup",
    start: "2026-03-09 09:00:00.000Z",
    end: "2026-03-09 10:00:00.000Z",
    color: "#B892FF",
    emoji: "📅",
    type: "event",
    recurrence: "weekly",
    recurrence_days: [MONDAY],
    recurrence_end: "",
    created_by: "user1",
    ...overrides,
  };
}

describe("expandEvents — weekly series must not precede its own start", () => {
  it("emits nothing for the month before the series began", () => {
    // Series starts Mon 9 Mar 2026. February has four Mondays, none of which
    // exist as occurrences. Current behaviour: all four are emitted.
    const map = expandEvents([mondaySeriesFromMarch9()], 2026, 1); // Feb 2026

    expect(map).toEqual({});
  });

  it("emits nothing for a month long before the series began", () => {
    // Demonstrates the absence of a lower bound rather than an off-by-one:
    // the series reaches arbitrarily far back, not just one month.
    const map = expandEvents([mondaySeriesFromMarch9()], 2026, 0); // Jan 2026

    expect(map).toEqual({});
  });

  it("emits nothing for a month in a previous year", () => {
    const map = expandEvents([mondaySeriesFromMarch9()], 2025, 10); // Nov 2025

    expect(map).toEqual({});
  });

  it("skips the pre-start weekdays inside the start month itself", () => {
    // The subtler half: Monday 2 March precedes the Monday 9 March start, but
    // sits in the requested month, so a naive month-level guard would not
    // catch it. Expected: 9, 16, 23, 30 only.
    const map = expandEvents([mondaySeriesFromMarch9()], 2026, 2); // Mar 2026

    expect(map["2026-3-2"]).toBeUndefined();
    expect(Object.keys(map).sort()).toEqual(
      ["2026-3-16", "2026-3-23", "2026-3-30", "2026-3-9"].sort(),
    );
  });

  it("includes the occurrence falling exactly on the start date", () => {
    // Lower bound is inclusive, mirroring recurrence_end's inclusive upper
    // bound. The series starts at 09:00, so this is the case that fails if
    // the guard ever compares raw datetimes instead of calendar dates —
    // midnight would sort before 09:00 and eat the first occurrence.
    const map = expandEvents([mondaySeriesFromMarch9()], 2026, 2); // Mar 2026

    expect(map["2026-3-9"]).toBeDefined();
    expect(map["2026-3-9"]).toHaveLength(1);
    expect(map["2026-3-9"][0].recordId).toBe("weekly1");
  });

  it("honours both bounds together", () => {
    // Series runs Mon 9 Mar → Mon 23 Mar inclusive. Expected: 9, 16, 23.
    // Both bounds date-only and inclusive, so neither end is clipped.
    const map = expandEvents(
      [mondaySeriesFromMarch9({ recurrence_end: "2026-03-23 00:00:00.000Z" })],
      2026,
      2, // Mar 2026
    );

    expect(Object.keys(map).sort()).toEqual(
      ["2026-3-16", "2026-3-23", "2026-3-9"].sort(),
    );
  });
});

describe("expandEvents — bounds must not over-clip", () => {
  it("still expands every matching weekday in a month wholly after the start", () => {
    // Regression guard: the fix must not narrow legitimate expansion.
    const map = expandEvents([mondaySeriesFromMarch9()], 2026, 3); // Apr 2026

    expect(Object.keys(map).sort()).toEqual(
      ["2026-4-13", "2026-4-20", "2026-4-27", "2026-4-6"].sort(),
    );
  });

  it("gates a one-off event on its own start month (the bug is weekly-only)", () => {
    // Contrast case: the non-recurring branch always compared against
    // rec.start, so it never had the missing lower bound. Confirms the fix
    // was needed in the weekly branch only.
    const oneOff = mondaySeriesFromMarch9({
      id: "oneoff1",
      recurrence: "none",
      recurrence_days: [],
    });

    expect(expandEvents([oneOff], 2026, 1)).toEqual({}); // Feb — excluded
    expect(expandEvents([oneOff], 2026, 2)).toHaveProperty("2026-3-9"); // Mar
  });
});
