import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mocks for the singleton pb client and the pb-client wrappers used
// inside checkLearnerIn. Hoisting is required because vi.mock factories run
// before the imports below.
const { mockUpdate, mockCollection, mockBatchUpdateAttendance, mockGetLearnerByNfc } =
  vi.hoisted(() => {
    const mockUpdate = vi.fn();
    const mockCollection = vi.fn(() => ({ update: mockUpdate }));
    const mockBatchUpdateAttendance = vi.fn();
    const mockGetLearnerByNfc = vi.fn();
    return {
      mockUpdate,
      mockCollection,
      mockBatchUpdateAttendance,
      mockGetLearnerByNfc,
    };
  });

vi.mock("@/app/pb", () => ({
  pb: {
    collection: mockCollection,
    authStore: { isValid: true, record: { role: "admin" } },
  },
}));

vi.mock("@/lib/pb-client", () => ({
  batchUpdateAttendance: (...args: unknown[]) => mockBatchUpdateAttendance(...args),
  getLearnerByNfc: (...args: unknown[]) => mockGetLearnerByNfc(...args),
}));

vi.mock("@/lib/debug", () => ({
  debug: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { checkLearnerIn } from "@/app/utils/utils";

const fakeLearner = {
  id: "learner1",
  name: "Test Student",
  email: "test@school.com",
  dob: "2010-01-01",
  NFC_ID: "ABCD1234",
  program: "exp",
  collectionId: "col1",
  collectionName: "learners",
  created: "2026-01-01T00:00:00Z",
  updated: "2026-01-01T00:00:00Z",
};

// A fresh blank attendance row — the state machine input. checkLearnerIn
// passes this into computeCheckInAction() to decide what to write next.
function blankAttendance(overrides: Record<string, unknown> = {}) {
  return {
    id: "att1",
    learner: "learner1",
    date: "2026-04-08",
    time_in: null,
    time_out: null,
    lunch_out: null,
    lunch_in: null,
    lunch_events: null,
    status: null,
    lunch_status: null,
    arrival: null,
    justified: false,
    collectionId: "col1",
    collectionName: "attendance",
    created: "2026-04-08T08:00:00Z",
    updated: "2026-04-08T08:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetLearnerByNfc.mockResolvedValue(fakeLearner);
  mockUpdate.mockResolvedValue({});
});

/** Get the fields the code wrote to pb.collection("attendance").update(id, fields). */
function lastUpdateFields(): Record<string, unknown> | null {
  const lastCall = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1];
  return (lastCall?.[1] as Record<string, unknown>) ?? null;
}

describe("checkLearnerIn", () => {
  it("checks in as present before 10:01 AM", async () => {
    mockBatchUpdateAttendance.mockResolvedValueOnce({
      attendance: blankAttendance(),
      existing: blankAttendance(),
      created: true,
    });

    const morning9am = new Date("2026-04-08T09:00:00");
    const result = await checkLearnerIn("ABCD1234", {
      testTime: morning9am,
      testDate: "2026-04-08",
    });

    expect(result?.type).toBe("check_in");
    expect(result?.status).toBe("present");
    expect(mockUpdate).toHaveBeenCalledWith(
      "att1",
      expect.objectContaining({ status: "present", time_in: expect.any(String) }),
    );
  });

  it("checks in as late at 10:01 AM or after", async () => {
    mockBatchUpdateAttendance.mockResolvedValueOnce({
      attendance: blankAttendance(),
      existing: blankAttendance(),
      created: true,
    });

    const morning1001 = new Date("2026-04-08T10:01:00");
    const result = await checkLearnerIn("ABCD1234", {
      testTime: morning1001,
      testDate: "2026-04-08",
    });

    expect(result?.type).toBe("check_in");
    expect(result?.status).toBe("late");
    expect(lastUpdateFields()).toMatchObject({ status: "late" });
  });

  // ── Regression: the write must never leave the row contradicting itself ──
  //
  // checkLearnerIn writes action.fields verbatim through a raw attendance
  // update, so any field the state machine omits keeps whatever the row
  // already held. When `justified` was omitted, a learner marked jAbsent who
  // then tapped in ended up arrival "late" / justified false / status "jLate":
  // summarizeAttendance reads the split pair and counted an UNJUSTIFIED late,
  // while every legacy consumer reading `status` saw jLate.

  it("writes justified: true when a legacy jAbsent row's learner taps in late", async () => {
    // Pre-migration shape: the enum says justified, the column does not.
    const existing = blankAttendance({ status: "jAbsent", justified: false });
    mockBatchUpdateAttendance.mockResolvedValueOnce({
      attendance: existing,
      existing,
      created: false,
    });

    const result = await checkLearnerIn("ABCD1234", {
      testTime: new Date("2026-04-08T10:30:00"),
      testDate: "2026-04-08",
    });

    expect(result?.type).toBe("check_in");
    expect(lastUpdateFields()).toMatchObject({
      arrival: "late",
      justified: true,
      status: "jLate",
    });
  });

  it("writes justified: false when an excused learner turns up on time", async () => {
    // The other direction: leaving `justified` untouched here would strand a
    // true flag on a present day, which has no jPresent to justify.
    const existing = blankAttendance({
      status: "jAbsent",
      arrival: "absent",
      justified: true,
    });
    mockBatchUpdateAttendance.mockResolvedValueOnce({
      attendance: existing,
      existing,
      created: false,
    });

    const result = await checkLearnerIn("ABCD1234", {
      testTime: new Date("2026-04-08T09:00:00"),
      testDate: "2026-04-08",
    });

    expect(result?.type).toBe("check_in");
    expect(lastUpdateFields()).toMatchObject({
      arrival: "present",
      justified: false,
      status: "present",
    });
  });

  it("always writes all three of arrival, justified and status together", async () => {
    // The structural guarantee: whatever the prior row looked like, the write
    // never sets a subset that could disagree with the fields it left behind.
    for (const prior of [
      {},
      { status: "jAbsent", justified: false },
      { status: "jLate", justified: true },
      { justified: true },
      { status: "absent", arrival: "absent" },
    ]) {
      mockUpdate.mockClear();
      const existing = blankAttendance(prior);
      mockBatchUpdateAttendance.mockResolvedValueOnce({
        attendance: existing,
        existing,
        created: false,
      });

      await checkLearnerIn("ABCD1234", {
        testTime: new Date("2026-04-08T10:30:00"),
        testDate: "2026-04-08",
      });

      const written = lastUpdateFields();
      const label = JSON.stringify(prior);
      expect(written, label).not.toBeNull();
      expect(Object.keys(written as object).sort(), label).toEqual([
        "arrival",
        "justified",
        "status",
        "time_in",
      ]);
    }
  });

  it("does not re-check-in if already checked in", async () => {
    const existing = blankAttendance({
      time_in: "2026-04-08T09:00:00Z",
    });
    mockBatchUpdateAttendance.mockResolvedValueOnce({
      attendance: existing,
      existing,
      created: false,
    });

    // 11 AM — outside the lunch window and before checkout. State machine
    // should produce no_action.
    const morning11 = new Date("2026-04-08T11:00:00");
    const result = await checkLearnerIn("ABCD1234", {
      testTime: morning11,
      testDate: "2026-04-08",
    });

    expect(result?.type).toBe("no_action");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("creates lunch-out event during 1-2pm window", async () => {
    const existing = blankAttendance({
      time_in: "2026-04-08T09:00:00Z",
    });
    mockBatchUpdateAttendance.mockResolvedValueOnce({
      attendance: existing,
      existing,
      created: false,
    });

    const lunch1pm = new Date("2026-04-08T13:00:00");
    const result = await checkLearnerIn("ABCD1234", {
      testTime: lunch1pm,
      testDate: "2026-04-08",
    });

    expect(result?.type).toBe("lunch_event");
    const fields = lastUpdateFields();
    expect(fields).toBeTruthy();
    const events = JSON.parse(fields!.lunch_events as string);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("out");
  });

  it("creates lunch-in event when last event was out", async () => {
    const existing = blankAttendance({
      time_in: "2026-04-08T09:00:00Z",
      lunch_events: [{ type: "out", time: "2026-04-08T13:00:00Z" }],
    });
    mockBatchUpdateAttendance.mockResolvedValueOnce({
      attendance: existing,
      existing,
      created: false,
    });

    const lunch130pm = new Date("2026-04-08T13:30:00");
    const result = await checkLearnerIn("ABCD1234", {
      testTime: lunch130pm,
      testDate: "2026-04-08",
    });

    expect(result?.type).toBe("lunch_event");
    const events = JSON.parse(lastUpdateFields()!.lunch_events as string);
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe("in");
  });

  it("checks out for the day at 4:59 PM or later", async () => {
    const existing = blankAttendance({
      time_in: "2026-04-08T09:00:00Z",
    });
    mockBatchUpdateAttendance.mockResolvedValueOnce({
      attendance: existing,
      existing,
      created: false,
    });

    const evening5pm = new Date("2026-04-08T17:00:00");
    const result = await checkLearnerIn("ABCD1234", {
      testTime: evening5pm,
      testDate: "2026-04-08",
    });

    expect(result?.type).toBe("check_out");
    expect(lastUpdateFields()).toMatchObject({ time_out: expect.any(String) });
  });

  it("does nothing for unknown NFC UID", async () => {
    mockGetLearnerByNfc.mockResolvedValueOnce(null);

    const result = await checkLearnerIn("UNKNOWN_UID", {
      testTime: new Date("2026-04-08T09:00:00"),
      testDate: "2026-04-08",
    });

    expect(result).toBeNull();
    expect(mockBatchUpdateAttendance).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
