import { describe, it, expect } from "vitest";
import {
  computeCheckInAction,
  deriveStatus,
  splitStatus,
  findLearnersToMarkAbsent,
  type AttendanceState,
} from "@learnlife/shared";
import type { AttendanceRecord, Learner } from "@learnlife/pb-client";

// Empty state — no scans recorded yet. Each test overrides the fields it cares
// about; this keeps the cases readable.
function blankState(overrides: Partial<AttendanceState> = {}): AttendanceState {
  return {
    time_in: null,
    time_out: null,
    lunch_events: null,
    lunch_out: null,
    lunch_in: null,
    status: null,
    lunch_status: null,
    ...overrides,
  };
}

function at(h: number, m: number, dayOffset = 0): Date {
  // Apr 20 2026 is a Monday — used everywhere unless the test explicitly wants
  // a different weekday (e.g. Friday checkout / weekend sweep skip).
  return new Date(2026, 3, 20 + dayOffset, h, m, 0, 0);
}

describe("deriveStatus / splitStatus", () => {
  it("round-trips every legacy status enum value", () => {
    const cases = [
      ["present", { arrival: "present", justified: false }],
      ["late",    { arrival: "late",    justified: false }],
      ["absent",  { arrival: "absent",  justified: false }],
      ["jLate",   { arrival: "late",    justified: true }],
      ["jAbsent", { arrival: "absent",  justified: true }],
    ] as const;
    for (const [status, split] of cases) {
      expect(splitStatus(status)).toEqual(split);
      expect(deriveStatus(split.arrival, split.justified)).toBe(status);
    }
  });

  it("returns null when arrival is null", () => {
    expect(deriveStatus(null, false)).toBeNull();
    expect(deriveStatus(null, true)).toBeNull();
  });

  it("never produces 'jPresent' — present + justified is meaningless", () => {
    expect(deriveStatus("present", true)).toBe("present");
  });
});

describe("computeCheckInAction — morning check-in", () => {
  it("marks an early arrival as present (arrival + status both set)", () => {
    const action = computeCheckInAction(blankState(), at(9, 30));
    expect(action.type).toBe("check_in");
    if (action.type !== "check_in") return;
    expect(action.fields.arrival).toBe("present");
    expect(action.fields.status).toBe("present");
    expect(action.fields.time_in).toBeDefined();
  });

  it("marks an arrival at 10:01 AM as late", () => {
    const action = computeCheckInAction(blankState(), at(10, 1));
    expect(action.type).toBe("check_in");
    if (action.type !== "check_in") return;
    expect(action.fields.arrival).toBe("late");
    expect(action.fields.status).toBe("late");
  });

  it("preserves justified flag when a previously-jAbsent learner shows up", () => {
    // Front desk pre-marked the learner jAbsent before they arrived. When they
    // actually scan in late, arrival flips to "late" but the justification
    // sticks — the human's call is honored.
    const action = computeCheckInAction(
      blankState({ status: "jAbsent" }),
      at(11, 0),
    );
    expect(action.type).toBe("check_in");
    if (action.type !== "check_in") return;
    expect(action.fields.arrival).toBe("late");
    expect(action.fields.status).toBe("jLate");
  });
});

describe("findLearnersToMarkAbsent", () => {
  const allLearners: Pick<Learner, "id">[] = [
    { id: "alice" },
    { id: "bob" },
    { id: "carol" },
  ];

  function makeRecord(overrides: Partial<AttendanceRecord> & { learner: string }): AttendanceRecord {
    const base: AttendanceRecord = {
      id: "rec-" + overrides.learner,
      learner: overrides.learner,
      date: "2026-04-20",
      time_in: null,
      time_out: null,
      lunch_out: null,
      lunch_in: null,
      lunch_events: null,
      status: null,
      lunch_status: null,
      arrival: null,
      justified: false,
      justification_reason: null,
      justified_by: null,
      justified_at: null,
      collectionId: "attendance",
      collectionName: "attendance",
      created: "2026-04-20T00:00:00.000Z",
      updated: "2026-04-20T00:00:00.000Z",
    };
    return { ...base, ...overrides };
  }

  it("returns nothing before the noon cutoff", () => {
    expect(findLearnersToMarkAbsent([], allLearners, at(11, 59))).toEqual([]);
  });

  it("returns every learner with no record once past noon", () => {
    const ids = findLearnersToMarkAbsent([], allLearners, at(12, 0));
    expect(ids.sort()).toEqual(["alice", "bob", "carol"]);
  });

  it("skips learners who have already checked in", () => {
    const records = [makeRecord({ learner: "alice", time_in: at(9, 0).toISOString() })];
    const ids = findLearnersToMarkAbsent(records, allLearners, at(12, 30));
    expect(ids.sort()).toEqual(["bob", "carol"]);
  });

  it("skips learners with arrival already set (idempotent)", () => {
    const records = [
      makeRecord({ learner: "alice", arrival: "absent" }),
      makeRecord({ learner: "bob", arrival: "present" }),
    ];
    const ids = findLearnersToMarkAbsent(records, allLearners, at(12, 30));
    expect(ids).toEqual(["carol"]);
  });

  it("falls back to legacy status — guides who pre-marked are respected", () => {
    const records = [makeRecord({ learner: "alice", status: "jAbsent" })];
    const ids = findLearnersToMarkAbsent(records, allLearners, at(12, 30));
    expect(ids.sort()).toEqual(["bob", "carol"]);
  });

  it("skips weekends entirely", () => {
    // Apr 25 2026 is a Saturday; Apr 26 is Sunday.
    expect(findLearnersToMarkAbsent([], allLearners, at(12, 30, 5))).toEqual([]);
    expect(findLearnersToMarkAbsent([], allLearners, at(12, 30, 6))).toEqual([]);
  });
});
