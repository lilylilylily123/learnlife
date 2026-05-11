import { describe, it, expect } from "vitest";
import {
  summarizeAttendance,
  summarizeByLearner,
  emptySummary,
  formatMinutesOfDay,
  computeAttendanceRates,
  countWeekdays,
} from "@learnlife/shared";
import type { AttendanceRecord, LunchEvent } from "@learnlife/pb-client";

// Build an attendance record with sensible defaults. Tests override only what
// they care about, which keeps each case readable.
function makeRecord(overrides: Partial<AttendanceRecord>): AttendanceRecord {
  return {
    id: "rec-" + Math.random().toString(36).slice(2),
    learner: "learner-A",
    date: "2026-04-20",
    time_in: null,
    time_out: null,
    lunch_out: null,
    lunch_in: null,
    lunch_events: null,
    status: null,
    lunch_status: null,
    collectionId: "attendance",
    collectionName: "attendance",
    created: "2026-04-20 00:00:00.000Z",
    updated: "2026-04-20 00:00:00.000Z",
    ...overrides,
  };
}

// Construct an ISO timestamp pinned to a specific local wall-clock time on a
// reference date. Using the local constructor matches how minutesOfDay parses
// times (via parsePBDate → Date → getHours/getMinutes in the test's tz).
function at(h: number, m: number): string {
  const d = new Date(2026, 3, 20, h, m, 0, 0); // Apr 20 2026
  return d.toISOString();
}

describe("summarizeAttendance", () => {
  it("returns zeros for an empty record set", () => {
    expect(summarizeAttendance([])).toEqual(emptySummary());
  });

  it("counts statuses and computes attendance percentage", () => {
    const recs = [
      makeRecord({ status: "present" }),
      makeRecord({ status: "present" }),
      makeRecord({ status: "late" }),
      makeRecord({ status: "absent" }),
    ];
    const s = summarizeAttendance(recs);
    expect(s.daysTracked).toBe(4);
    expect(s.present).toBe(2);
    expect(s.late).toBe(1);
    expect(s.absent).toBe(1);
    expect(s.attendancePct).toBe(75); // (2 + 1) / 4
  });

  it("averages check-in and check-out times across records with data", () => {
    const recs = [
      makeRecord({ time_in: at(9, 0), time_out: at(16, 0) }),  // 540 / 960
      makeRecord({ time_in: at(10, 0), time_out: at(17, 0) }), // 600 / 1020
      makeRecord({ time_in: null, time_out: null }),           // ignored
    ];
    const s = summarizeAttendance(recs);
    expect(s.avgCheckInMinutes).toBe(570);  // (540 + 600) / 2
    expect(s.avgCheckOutMinutes).toBe(990); // (960 + 1020) / 2
  });

  it("returns null averages when no record had the time field set", () => {
    const s = summarizeAttendance([makeRecord({})]);
    expect(s.avgCheckInMinutes).toBeNull();
    expect(s.avgCheckOutMinutes).toBeNull();
  });

  it("sums lunch minutes from paired out/in events", () => {
    const lunchEvents: LunchEvent[] = [
      { type: "out", time: at(13, 0) },
      { type: "in", time: at(13, 45) },
    ];
    const recs = [makeRecord({ lunch_events: lunchEvents })];
    expect(summarizeAttendance(recs).totalLunchMinutes).toBe(45);
  });

  it("handles multiple lunch pairs and ignores an unpaired trailing out", () => {
    const lunchEvents: LunchEvent[] = [
      { type: "out", time: at(13, 0) },
      { type: "in", time: at(13, 15) },
      { type: "out", time: at(13, 30) }, // never returned — should not count
    ];
    const recs = [makeRecord({ lunch_events: lunchEvents })];
    expect(summarizeAttendance(recs).totalLunchMinutes).toBe(15);
  });

  it("falls back to legacy lunch_out/lunch_in when lunch_events is empty", () => {
    const recs = [makeRecord({ lunch_out: at(13, 0), lunch_in: at(13, 30) })];
    expect(summarizeAttendance(recs).totalLunchMinutes).toBe(30);
  });

  it("counts late lunches and missing checkouts", () => {
    const recs = [
      makeRecord({ date: "2026-04-18", lunch_status: "late" }),
      makeRecord({ date: "2026-04-18", lunch_status: "late" }),
      makeRecord({ date: "2026-04-18", time_in: at(9, 0), time_out: null }),
      makeRecord({ date: "2026-04-18", time_in: at(9, 0), time_out: at(16, 0) }),
    ];
    // Pin "today" so the open-checkout record (dated 2026-04-18) is safely in
    // the past and counted as missing.
    const s = summarizeAttendance(recs, { today: "2026-04-20" });
    expect(s.lateLunches).toBe(2);
    expect(s.missingCheckouts).toBe(1);
  });

  it("does not count an open checkout on 'today' as missing", () => {
    const recs = [
      makeRecord({ date: "2026-04-20", time_in: at(9, 0), time_out: null }),
    ];
    const s = summarizeAttendance(recs, { today: "2026-04-20" });
    // The learner might still be at school — don't flag as missing yet.
    expect(s.missingCheckouts).toBe(0);
  });

  it("excludes jAbsent from the attendance denominator", () => {
    const recs = [
      makeRecord({ status: "present" }),
      makeRecord({ status: "present" }),
      makeRecord({ status: "present" }),
      makeRecord({ status: "jAbsent" }), // excused — shouldn't hurt rate
    ];
    const s = summarizeAttendance(recs);
    // 3 present / (4 expected - 1 jAbsent) = 100% attendance, 100% on time
    expect(s.onTimePct).toBe(100);
    expect(s.attendancePct).toBe(100);
    expect(s.absentPct).toBe(0);
  });

  it("rolls untracked days into missingRecords and absent%", () => {
    const recs = [
      makeRecord({ status: "present" }),
      makeRecord({ status: "present" }),
      makeRecord({ status: "late" }),
    ];
    // 3 records, but 5 weekdays were expected — the missing 2 should hurt.
    const s = summarizeAttendance(recs, { expectedDays: 5 });
    expect(s.expectedDays).toBe(5);
    expect(s.missingRecords).toBe(2);
    // on time: 2 present / 5 = 40%; attended: 3 / 5 = 60%; absent: 2 / 5 = 40%
    expect(s.onTimePct).toBe(40);
    expect(s.attendancePct).toBe(60);
    expect(s.absentPct).toBe(40);
  });

  it("splits on-time vs attended so late days don't hide in the headline", () => {
    const recs = [
      makeRecord({ status: "present" }),
      makeRecord({ status: "late" }),
      makeRecord({ status: "late" }),
    ];
    const s = summarizeAttendance(recs, { expectedDays: 3 });
    expect(s.onTimePct).toBe(33);    // 1/3 on time
    expect(s.attendancePct).toBe(100); // 3/3 attended
  });

  it("bumps expectedDays up to daysTracked when records exceed the range", () => {
    // Saturday-session scans in a range that only counted weekdays — records
    // shouldn't push the rate above 100%.
    const recs = [
      makeRecord({ status: "present" }),
      makeRecord({ status: "present" }),
    ];
    const s = summarizeAttendance(recs, { expectedDays: 1 });
    expect(s.expectedDays).toBe(2);
    expect(s.onTimePct).toBe(100);
    expect(s.attendancePct).toBe(100);
  });

  it("caps all rates at 100 even under weird inputs", () => {
    const r = computeAttendanceRates(
      { present: 10, late: 0, absent: 0, jLate: 0, jAbsent: 0, daysTracked: 10 },
      3, // caller lied about expectedDays
    );
    expect(r.onTimePct).toBeLessThanOrEqual(100);
    expect(r.attendancePct).toBeLessThanOrEqual(100);
  });
});

describe("summarizeByLearner", () => {
  it("groups records by learner FK and summarizes each", () => {
    const recs = [
      makeRecord({ learner: "A", status: "present" }),
      makeRecord({ learner: "A", status: "late" }),
      makeRecord({ learner: "B", status: "absent" }),
    ];
    const map = summarizeByLearner(recs);
    expect(map.get("A")?.daysTracked).toBe(2);
    expect(map.get("A")?.late).toBe(1);
    expect(map.get("B")?.absent).toBe(1);
    expect(map.get("B")?.attendancePct).toBe(0);
  });

  it("passes expectedDays through so each learner's rate reflects missed scans", () => {
    const recs = [
      makeRecord({ learner: "A", status: "present" }),
      makeRecord({ learner: "A", status: "present" }),
      // B has one record but the range covers 3 weekdays
      makeRecord({ learner: "B", status: "present" }),
    ];
    const map = summarizeByLearner(recs, { expectedDays: 3 });
    expect(map.get("A")?.missingRecords).toBe(1);
    expect(map.get("A")?.onTimePct).toBe(67); // 2/3
    expect(map.get("B")?.missingRecords).toBe(2);
    expect(map.get("B")?.onTimePct).toBe(33); // 1/3
  });
});

describe("emptySummary", () => {
  it("returns fully-absent when expectedDays > 0", () => {
    const s = emptySummary(5);
    expect(s.expectedDays).toBe(5);
    expect(s.missingRecords).toBe(5);
    expect(s.absentPct).toBe(100);
    expect(s.attendancePct).toBe(0);
    expect(s.onTimePct).toBe(0);
  });

  it("returns all zeros when expectedDays is 0", () => {
    const s = emptySummary();
    expect(s.expectedDays).toBe(0);
    expect(s.absentPct).toBe(0);
  });
});

describe("countWeekdays", () => {
  it("counts Mon–Fri inclusively", () => {
    // 2026-04-20 is a Monday; range through Friday 2026-04-24 = 5 weekdays.
    expect(countWeekdays("2026-04-20", "2026-04-24")).toBe(5);
  });

  it("skips weekends inside the range", () => {
    // Mon 2026-04-20 through Mon 2026-04-27 = 6 weekdays (skips Sat/Sun).
    expect(countWeekdays("2026-04-20", "2026-04-27")).toBe(6);
  });

  it("returns 0 for a weekend-only range", () => {
    // Sat 2026-04-25 to Sun 2026-04-26
    expect(countWeekdays("2026-04-25", "2026-04-26")).toBe(0);
  });

  it("returns 0 for a reversed range", () => {
    expect(countWeekdays("2026-04-24", "2026-04-20")).toBe(0);
  });
});

describe("formatMinutesOfDay", () => {
  it("formats morning, noon, and PM times with 12-hour clock", () => {
    expect(formatMinutesOfDay(null)).toBe("—");
    expect(formatMinutesOfDay(0)).toBe("12:00 AM");
    expect(formatMinutesOfDay(9 * 60 + 5)).toBe("9:05 AM");
    expect(formatMinutesOfDay(12 * 60)).toBe("12:00 PM");
    expect(formatMinutesOfDay(14 * 60 + 30)).toBe("2:30 PM");
  });
});
