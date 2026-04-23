import { describe, it, expect } from "vitest";
import {
  summarizeAttendance,
  summarizeByLearner,
  emptySummary,
  formatMinutesOfDay,
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
      makeRecord({ lunch_status: "late" }),
      makeRecord({ lunch_status: "late" }),
      makeRecord({ time_in: at(9, 0), time_out: null }),
      makeRecord({ time_in: at(9, 0), time_out: at(16, 0) }),
    ];
    const s = summarizeAttendance(recs);
    expect(s.lateLunches).toBe(2);
    expect(s.missingCheckouts).toBe(1);
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
