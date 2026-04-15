/**
 * Tests for lib/calendar-utils.ts
 *
 * Run with: pnpm test
 * All dates run under TZ=UTC (set in package.json test script) so date
 * arithmetic is deterministic regardless of the host machine's locale.
 *
 * April 2026 weekday reference (Mon-first index in parentheses):
 *   Mon: 6, 13, 20, 27  (0)
 *   Tue: 7, 14, 21, 28  (1)
 *   Wed: 1, 8, 15, 22, 29  (2)
 *   Thu: 2, 9, 16, 23, 30  (3)
 *   Fri: 3, 10, 17, 24  (4)
 *   Sat: 4, 11, 18, 25  (5)
 *   Sun: 5, 12, 19, 26  (6)
 */

import { expandEvents, makeDateKey, formatTimeRange, CalRecord } from "../lib/calendar-utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const YEAR = 2026;
const MONTH = 3; // April (0-indexed)

/** Build a minimal CalRecord, with sensible defaults overrideable per-test. */
function makeRecord(overrides: Partial<CalRecord> = {}): CalRecord {
  return {
    id: "rec1",
    title: "Test Event",
    start: "2026-04-12T09:00:00.000Z", // Sunday Apr 12
    end: "2026-04-12T10:00:00.000Z",
    color: "#B892FF",
    emoji: "📅",
    type: "event",
    recurrence: "none",
    recurrence_days: [],
    recurrence_end: "",
    created_by: "user1",
    ...overrides,
  };
}

// ─── makeDateKey ──────────────────────────────────────────────────────────────

describe("makeDateKey", () => {
  it("formats as YEAR-MONTH(1-indexed)-DAY", () => {
    expect(makeDateKey(2026, 3, 12)).toBe("2026-4-12");
  });

  it("uses 1-indexed months", () => {
    expect(makeDateKey(2026, 0, 1)).toBe("2026-1-1");   // January
    expect(makeDateKey(2026, 11, 31)).toBe("2026-12-31"); // December
  });
});

// ─── formatTimeRange ──────────────────────────────────────────────────────────

describe("formatTimeRange", () => {
  it("returns a dash-separated time range string", () => {
    const result = formatTimeRange(
      "2026-04-12T09:00:00.000Z",
      "2026-04-12T10:30:00.000Z"
    );
    expect(result).toMatch(/–/); // em-dash separator
    expect(result).toMatch(/AM|PM/i);
  });
});

// ─── PocketBase date format (space instead of T) ──────────────────────────────

describe("PocketBase space-separated datetime format", () => {
  it("formatTimeRange handles PB space format without returning Invalid Date", () => {
    const result = formatTimeRange(
      "2026-04-12 09:00:00.000Z",
      "2026-04-12 10:30:00.000Z"
    );
    expect(result).not.toContain("Invalid");
    expect(result).toMatch(/–/);
    expect(result).toMatch(/AM|PM/i);
  });

  it("expandEvents places a one-off event with PB space format on the correct day", () => {
    const rec = makeRecord({
      start: "2026-04-12 09:00:00.000Z",
      end: "2026-04-12 10:00:00.000Z",
    });
    const result = expandEvents([rec], YEAR, MONTH);
    expect(result["2026-4-12"]).toHaveLength(1);
  });

  it("expandEvents handles weekly recurrence_end with PB space format", () => {
    const rec = makeRecord({
      recurrence: "weekly",
      recurrence_days: [0],
      recurrence_end: "2026-04-14 00:00:00.000Z",
    });
    const result = expandEvents([rec], YEAR, MONTH);
    expect(result["2026-4-6"]).toHaveLength(1);
    expect(result["2026-4-13"]).toHaveLength(1);
    expect(result["2026-4-20"]).toBeUndefined();
  });
});

// ─── expandEvents ─────────────────────────────────────────────────────────────

describe("expandEvents", () => {
  // ── Empty input ─────────────────────────────────────────────────────────────

  describe("with no records", () => {
    it("returns an empty map", () => {
      expect(expandEvents([], YEAR, MONTH)).toEqual({});
    });
  });

  // ── One-off events ──────────────────────────────────────────────────────────

  describe("one-off events (recurrence: none)", () => {
    it("places the event under the correct date key", () => {
      const rec = makeRecord(); // Apr 12
      const result = expandEvents([rec], YEAR, MONTH);

      expect(result["2026-4-12"]).toHaveLength(1);
      expect(result["2026-4-12"][0]).toMatchObject({
        id: "rec1",
        title: "Test Event",
        color: "#B892FF",
        emoji: "📅",
      });
    });

    it("preserves the record id on one-off events", () => {
      const rec = makeRecord({ id: "unique-id" });
      const result = expandEvents([rec], YEAR, MONTH);
      expect(result["2026-4-12"][0].id).toBe("unique-id");
    });

    it("excludes events in a different month", () => {
      const rec = makeRecord({ start: "2026-05-01T09:00:00.000Z", end: "2026-05-01T10:00:00.000Z" });
      expect(expandEvents([rec], YEAR, MONTH)).toEqual({});
    });

    it("excludes events in a different year", () => {
      const rec = makeRecord({ start: "2025-04-12T09:00:00.000Z", end: "2025-04-12T10:00:00.000Z" });
      expect(expandEvents([rec], YEAR, MONTH)).toEqual({});
    });

    it("places event on the first day of the month", () => {
      const rec = makeRecord({
        start: "2026-04-01T08:00:00.000Z",
        end: "2026-04-01T09:00:00.000Z",
      });
      const result = expandEvents([rec], YEAR, MONTH);
      expect(result["2026-4-1"]).toHaveLength(1);
    });

    it("places event on the last day of the month", () => {
      const rec = makeRecord({
        start: "2026-04-30T08:00:00.000Z",
        end: "2026-04-30T09:00:00.000Z",
      });
      const result = expandEvents([rec], YEAR, MONTH);
      expect(result["2026-4-30"]).toHaveLength(1);
    });
  });

  // ── Weekly recurring ────────────────────────────────────────────────────────

  describe("weekly recurring events (recurrence: weekly)", () => {
    // Regression test for the original bug: recurrence_days was undefined
    it("does NOT crash when recurrence_days is undefined", () => {
      const rec = makeRecord({
        recurrence: "weekly",
        recurrence_days: undefined as any,
      });
      expect(() => expandEvents([rec], YEAR, MONTH)).not.toThrow();
    });

    it("does NOT crash when recurrence_days is null", () => {
      const rec = makeRecord({
        recurrence: "weekly",
        recurrence_days: null as any,
      });
      expect(() => expandEvents([rec], YEAR, MONTH)).not.toThrow();
    });

    it("returns an empty map when recurrence_days is empty", () => {
      const rec = makeRecord({ recurrence: "weekly", recurrence_days: [] });
      expect(expandEvents([rec], YEAR, MONTH)).toEqual({});
    });

    it("places event on all Mondays in April 2026", () => {
      const rec = makeRecord({
        recurrence: "weekly",
        recurrence_days: [0], // Monday
      });
      const result = expandEvents([rec], YEAR, MONTH);

      // Mondays in April 2026: 6, 13, 20, 27
      expect(result["2026-4-6"]).toHaveLength(1);
      expect(result["2026-4-13"]).toHaveLength(1);
      expect(result["2026-4-20"]).toHaveLength(1);
      expect(result["2026-4-27"]).toHaveLength(1);

      // Non-Mondays should be absent
      expect(result["2026-4-1"]).toBeUndefined(); // Wednesday
      expect(result["2026-4-7"]).toBeUndefined(); // Tuesday
      expect(result["2026-4-12"]).toBeUndefined(); // Sunday
    });

    it("places event on all Sundays (index 6) in April 2026", () => {
      const rec = makeRecord({
        recurrence: "weekly",
        recurrence_days: [6], // Sunday
      });
      const result = expandEvents([rec], YEAR, MONTH);

      // Sundays in April 2026: 5, 12, 19, 26
      expect(result["2026-4-5"]).toHaveLength(1);
      expect(result["2026-4-12"]).toHaveLength(1);
      expect(result["2026-4-19"]).toHaveLength(1);
      expect(result["2026-4-26"]).toHaveLength(1);
    });

    it("places event on multiple days per week (Mon + Wed)", () => {
      const rec = makeRecord({
        recurrence: "weekly",
        recurrence_days: [0, 2], // Mon + Wed
      });
      const result = expandEvents([rec], YEAR, MONTH);

      // Mondays: 6, 13, 20, 27
      expect(result["2026-4-6"]).toHaveLength(1);
      expect(result["2026-4-13"]).toHaveLength(1);
      // Wednesdays: 1, 8, 15, 22, 29
      expect(result["2026-4-1"]).toHaveLength(1);
      expect(result["2026-4-8"]).toHaveLength(1);
      expect(result["2026-4-29"]).toHaveLength(1);
      // Tuesdays absent
      expect(result["2026-4-7"]).toBeUndefined();
      expect(result["2026-4-14"]).toBeUndefined();
    });

    it("uses a composite id (recordId-dateKey) for each occurrence", () => {
      const rec = makeRecord({
        id: "myid",
        recurrence: "weekly",
        recurrence_days: [0], // Monday
      });
      const result = expandEvents([rec], YEAR, MONTH);
      expect(result["2026-4-6"][0].id).toBe("myid-2026-4-6");
      expect(result["2026-4-13"][0].id).toBe("myid-2026-4-13");
    });

    it("stops recurring after recurrence_end", () => {
      // recurrence_end = Apr 14, so Apr 6 and Apr 13 (Mon) are in; Apr 20+ are out
      const rec = makeRecord({
        recurrence: "weekly",
        recurrence_days: [0],
        recurrence_end: "2026-04-14",
      });
      const result = expandEvents([rec], YEAR, MONTH);

      expect(result["2026-4-6"]).toHaveLength(1);
      expect(result["2026-4-13"]).toHaveLength(1);
      expect(result["2026-4-20"]).toBeUndefined();
      expect(result["2026-4-27"]).toBeUndefined();
    });

    it("includes the recurrence_end date itself if it falls on a matching day", () => {
      // recurrence_end = Apr 13 (Monday) — should still be included
      const rec = makeRecord({
        recurrence: "weekly",
        recurrence_days: [0],
        recurrence_end: "2026-04-13",
      });
      const result = expandEvents([rec], YEAR, MONTH);

      expect(result["2026-4-13"]).toHaveLength(1);
      expect(result["2026-4-20"]).toBeUndefined();
    });
  });

  // ── Multiple events ─────────────────────────────────────────────────────────

  describe("multiple events", () => {
    it("stacks two one-off events on the same day", () => {
      const rec1 = makeRecord({ id: "a", title: "First" });
      const rec2 = makeRecord({
        id: "b",
        title: "Second",
        start: "2026-04-12T11:00:00.000Z",
        end: "2026-04-12T12:00:00.000Z",
      });
      const result = expandEvents([rec1, rec2], YEAR, MONTH);
      expect(result["2026-4-12"]).toHaveLength(2);
      expect(result["2026-4-12"].map((e) => e.title)).toEqual(["First", "Second"]);
    });

    it("mixes a one-off and a recurring event on the same day", () => {
      const oneOff = makeRecord({
        id: "one",
        title: "One-off",
        start: "2026-04-06T08:00:00.000Z", // Monday Apr 6
        end: "2026-04-06T09:00:00.000Z",
      });
      const recurring = makeRecord({
        id: "rec",
        title: "Weekly Class",
        recurrence: "weekly",
        recurrence_days: [0], // Monday
      });
      const result = expandEvents([oneOff, recurring], YEAR, MONTH);
      expect(result["2026-4-6"]).toHaveLength(2);
    });

    it("keeps events on different days independent", () => {
      const rec1 = makeRecord({ id: "a", start: "2026-04-01T09:00:00.000Z", end: "2026-04-01T10:00:00.000Z" });
      const rec2 = makeRecord({ id: "b", start: "2026-04-12T09:00:00.000Z", end: "2026-04-12T10:00:00.000Z" });
      const result = expandEvents([rec1, rec2], YEAR, MONTH);
      expect(result["2026-4-1"]).toHaveLength(1);
      expect(result["2026-4-12"]).toHaveLength(1);
    });
  });

  // ── Prop passthrough ────────────────────────────────────────────────────────

  describe("event property passthrough", () => {
    it("passes title, color, and emoji to each CalEvent", () => {
      const rec = makeRecord({ title: "Art Class", color: "#4ADE80", emoji: "🎨" });
      const result = expandEvents([rec], YEAR, MONTH);
      const ev = result["2026-4-12"][0];
      expect(ev.title).toBe("Art Class");
      expect(ev.color).toBe("#4ADE80");
      expect(ev.emoji).toBe("🎨");
    });

    it("falls back to empty string when emoji is missing", () => {
      const rec = makeRecord({ emoji: undefined as any });
      const result = expandEvents([rec], YEAR, MONTH);
      expect(result["2026-4-12"][0].emoji).toBe("");
    });
  });
});
