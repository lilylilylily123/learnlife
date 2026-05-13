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

  it("returns nothing before the 10:30 cutoff", () => {
    expect(findLearnersToMarkAbsent([], allLearners, at(10, 29))).toEqual([]);
  });

  it("returns every learner with no record once past 10:30", () => {
    const ids = findLearnersToMarkAbsent([], allLearners, at(10, 30));
    expect(ids.sort()).toEqual(["alice", "bob", "carol"]);
  });

  it("skips learners who have already checked in", () => {
    const records = [makeRecord({ learner: "alice", time_in: at(9, 0).toISOString() })];
    const ids = findLearnersToMarkAbsent(records, allLearners, at(10, 45));
    expect(ids.sort()).toEqual(["bob", "carol"]);
  });

  it("skips learners with arrival already set (idempotent)", () => {
    const records = [
      makeRecord({ learner: "alice", arrival: "absent" }),
      makeRecord({ learner: "bob", arrival: "present" }),
    ];
    const ids = findLearnersToMarkAbsent(records, allLearners, at(10, 45));
    expect(ids).toEqual(["carol"]);
  });

  it("falls back to legacy status — guides who pre-marked are respected", () => {
    const records = [makeRecord({ learner: "alice", status: "jAbsent" })];
    const ids = findLearnersToMarkAbsent(records, allLearners, at(10, 45));
    expect(ids.sort()).toEqual(["bob", "carol"]);
  });

  it("skips weekends entirely", () => {
    // Apr 25 2026 is a Saturday; Apr 26 is Sunday.
    expect(findLearnersToMarkAbsent([], allLearners, at(12, 30, 5))).toEqual([]);
    expect(findLearnersToMarkAbsent([], allLearners, at(12, 30, 6))).toEqual([]);
  });
});

describe("computeCheckInAction — lunch window (1–2 PM)", () => {
  const checkedIn = blankState({
    time_in: at(9, 0).toISOString(),
    status: "present",
    arrival: "present",
  } as Partial<AttendanceState>);

  it("first lunch tap appends an 'out' event", () => {
    const action = computeCheckInAction(checkedIn, at(13, 15));
    expect(action.type).toBe("lunch_event");
    if (action.type !== "lunch_event") return;
    const events = JSON.parse(action.fields.lunch_events);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("out");
    // lunch_status is only set on return — going out shouldn't touch it.
    expect(action.fields.lunch_status).toBeUndefined();
  });

  it("tap after an 'out' appends an 'in' and marks lunch_status present when on time", () => {
    const state = blankState({
      time_in: at(9, 0).toISOString(),
      lunch_events: [{ type: "out", time: at(13, 5).toISOString() }],
    });
    const action = computeCheckInAction(state, at(13, 45));
    expect(action.type).toBe("lunch_event");
    if (action.type !== "lunch_event") return;
    const events = JSON.parse(action.fields.lunch_events);
    expect(events.map((e: { type: string }) => e.type)).toEqual(["out", "in"]);
    expect(action.fields.lunch_status).toBe("present");
  });

  it("supports multi-trip lunches by re-toggling out→in→out", () => {
    const state = blankState({
      time_in: at(9, 0).toISOString(),
      lunch_events: [
        { type: "out", time: at(13, 0).toISOString() },
        { type: "in", time: at(13, 10).toISOString() },
      ],
    });
    const action = computeCheckInAction(state, at(13, 20));
    expect(action.type).toBe("lunch_event");
    if (action.type !== "lunch_event") return;
    const events = JSON.parse(action.fields.lunch_events);
    expect(events.map((e: { type: string }) => e.type)).toEqual(["out", "in", "out"]);
  });
});

describe("computeCheckInAction — late lunch return", () => {
  it("scanning in after 2 PM while still 'out' returns late_lunch_return", () => {
    const state = blankState({
      time_in: at(9, 0).toISOString(),
      lunch_events: [{ type: "out", time: at(13, 30).toISOString() }],
    });
    const action = computeCheckInAction(state, at(14, 30));
    expect(action.type).toBe("late_lunch_return");
    if (action.type !== "late_lunch_return") return;
    const events = JSON.parse(action.fields.lunch_events);
    expect(events.map((e: { type: string }) => e.type)).toEqual(["out", "in"]);
    expect(action.fields.lunch_status).toBe("late");
  });

  it("recognises legacy lunch_out/lunch_in fields when no events array", () => {
    const state = blankState({
      time_in: at(9, 0).toISOString(),
      lunch_out: at(13, 15).toISOString(),
      lunch_in: null,
    });
    const action = computeCheckInAction(state, at(14, 45));
    expect(action.type).toBe("late_lunch_return");
  });
});

describe("computeCheckInAction — end-of-day checkout", () => {
  it("scanning at 4:59 PM on a weekday returns check_out", () => {
    const state = blankState({
      time_in: at(9, 0).toISOString(),
      lunch_events: [
        { type: "out", time: at(13, 0).toISOString() },
        { type: "in", time: at(13, 30).toISOString() },
      ],
    });
    const action = computeCheckInAction(state, at(16, 59));
    expect(action.type).toBe("check_out");
    if (action.type !== "check_out") return;
    expect(action.fields.time_out).toBeDefined();
    // Lunch already closed, so no lunch_events rewrite.
    expect(action.fields.lunch_events).toBeUndefined();
  });

  it("scanning before 4:59 PM with no open lunch returns no_action, not check_out", () => {
    const state = blankState({
      time_in: at(9, 0).toISOString(),
      lunch_events: [
        { type: "out", time: at(13, 0).toISOString() },
        { type: "in", time: at(13, 30).toISOString() },
      ],
    });
    const action = computeCheckInAction(state, at(16, 58));
    expect(action.type).toBe("no_action");
  });

  it("closes an open lunch as 'late' when checkout fires with learner still out", () => {
    const state = blankState({
      time_in: at(9, 0).toISOString(),
      lunch_events: [{ type: "out", time: at(13, 30).toISOString() }],
    });
    const action = computeCheckInAction(state, at(17, 0));
    expect(action.type).toBe("check_out");
    if (action.type !== "check_out") return;
    expect(action.fields.lunch_status).toBe("late");
    const events = JSON.parse(action.fields.lunch_events!);
    expect(events.map((e: { type: string }) => e.type)).toEqual(["out", "in"]);
  });

  it("uses 2 PM checkout on Fridays", () => {
    // Apr 24 2026 is a Friday (Mon Apr 20 + 4).
    const state = blankState({ time_in: new Date(2026, 3, 24, 9, 0).toISOString() });
    const fridayAt2 = new Date(2026, 3, 24, 14, 0);
    const action = computeCheckInAction(state, fridayAt2);
    expect(action.type).toBe("check_out");
  });

  it("does not re-checkout once time_out is already set", () => {
    const state = blankState({
      time_in: at(9, 0).toISOString(),
      time_out: at(17, 0).toISOString(),
    });
    const action = computeCheckInAction(state, at(17, 30));
    expect(action.type).toBe("no_action");
  });
});

describe("computeCheckInAction — no_action fallback", () => {
  it("returns no_action when nothing left to record (mid-afternoon, fully tapped)", () => {
    const state = blankState({
      time_in: at(9, 0).toISOString(),
      lunch_events: [
        { type: "out", time: at(13, 0).toISOString() },
        { type: "in", time: at(13, 45).toISOString() },
      ],
    });
    const action = computeCheckInAction(state, at(15, 30));
    expect(action.type).toBe("no_action");
    if (action.type !== "no_action") return;
    expect(action.reason).toMatch(/all check-ins/i);
  });
});
