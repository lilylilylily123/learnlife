import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock PocketBase — capture the collection-level calls used by checkLearnerIn.
const mockUpdate = vi.fn();
const mockGetFirstListItem = vi.fn();
const mockCreate = vi.fn();
const mockGetFullList = vi.fn();

vi.mock("pocketbase", () => {
  const PocketBase = vi.fn(function (this: unknown) {
    const self = this as {
      collection: (name: string) => unknown;
      autoCancellation: () => void;
      authStore: { isValid: boolean; onChange: () => void };
    };
    self.collection = vi.fn(() => ({
      getFirstListItem: mockGetFirstListItem,
      create: mockCreate,
      update: mockUpdate,
      getFullList: mockGetFullList,
    }));
    self.autoCancellation = vi.fn();
    self.authStore = { isValid: true, onChange: vi.fn() };
  });
  return { default: PocketBase };
});

// Mock pb-client module — checkLearnerIn calls getLearnerByNfc + batchUpdateAttendance.
const mockBatchUpdateAttendance = vi.fn();
const mockGetLearnerByNfc = vi.fn();

vi.mock("@/lib/pb-client", () => ({
  batchUpdateAttendance: (...args: unknown[]) => mockBatchUpdateAttendance(...args),
  getLearnerByNfc: (...args: unknown[]) => mockGetLearnerByNfc(...args),
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

/** Build an attendance snapshot for the state-machine input. */
function makeAttendance(overrides: Record<string, unknown> = {}) {
  return {
    id: "att1",
    learner: "learner1",
    date: "2026-04-08 00:00:00Z",
    time_in: null,
    time_out: null,
    lunch_out: null,
    lunch_in: null,
    lunch_events: null,
    status: null,
    lunch_status: null,
    collectionId: "col2",
    collectionName: "attendance",
    created: "2026-04-08T00:00:00Z",
    updated: "2026-04-08T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetLearnerByNfc.mockResolvedValue(fakeLearner);
  // Default batchUpdateAttendance: returns an empty existing record.
  const empty = makeAttendance();
  mockBatchUpdateAttendance.mockResolvedValue({
    existing: empty,
    attendance: empty,
    created: true,
  });
  mockUpdate.mockResolvedValue({});
});

describe("checkLearnerIn", () => {
  it("checks in as present before 10:01 AM", async () => {
    const morning9am = new Date("2026-04-08T09:00:00");

    await checkLearnerIn("ABCD1234", {
      testTime: morning9am,
      testDate: "2026-04-08",
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [id, fields] = mockUpdate.mock.calls[0];
    expect(id).toBe("att1");
    expect(fields).toEqual(
      expect.objectContaining({
        time_in: expect.any(String),
        status: "present",
      })
    );
  });

  it("checks in as late at 10:01 AM or after", async () => {
    const morning1001 = new Date("2026-04-08T10:01:00");

    await checkLearnerIn("ABCD1234", {
      testTime: morning1001,
      testDate: "2026-04-08",
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [, fields] = mockUpdate.mock.calls[0];
    expect(fields).toEqual(
      expect.objectContaining({
        time_in: expect.any(String),
        status: "late",
      })
    );
  });

  it("does not re-check-in if already checked in", async () => {
    const existing = makeAttendance({
      time_in: "2026-04-08T09:00:00Z",
      status: "present",
    });
    mockBatchUpdateAttendance.mockResolvedValueOnce({
      existing,
      attendance: existing,
      created: false,
    });

    // Time outside lunch window and before checkout → state machine returns no_action.
    const morning11 = new Date("2026-04-08T11:00:00");
    await checkLearnerIn("ABCD1234", {
      testTime: morning11,
      testDate: "2026-04-08",
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("creates lunch-out event during 1-2pm window", async () => {
    const existing = makeAttendance({
      time_in: "2026-04-08T09:00:00Z",
      status: "present",
    });
    mockBatchUpdateAttendance.mockResolvedValueOnce({
      existing,
      attendance: existing,
      created: false,
    });

    const lunch1pm = new Date("2026-04-08T13:00:00");
    await checkLearnerIn("ABCD1234", {
      testTime: lunch1pm,
      testDate: "2026-04-08",
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [, fields] = mockUpdate.mock.calls[0];
    const events = JSON.parse(fields.lunch_events);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("out");
  });

  it("creates lunch-in event when last event was out", async () => {
    const existing = makeAttendance({
      time_in: "2026-04-08T09:00:00Z",
      status: "present",
      lunch_events: [{ type: "out", time: "2026-04-08T13:00:00Z" }],
    });
    mockBatchUpdateAttendance.mockResolvedValueOnce({
      existing,
      attendance: existing,
      created: false,
    });

    const lunch130pm = new Date("2026-04-08T13:30:00");
    await checkLearnerIn("ABCD1234", {
      testTime: lunch130pm,
      testDate: "2026-04-08",
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [, fields] = mockUpdate.mock.calls[0];
    const events = JSON.parse(fields.lunch_events);
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe("in");
  });

  it("checks out for the day at 4:59 PM or later", async () => {
    const existing = makeAttendance({
      time_in: "2026-04-08T09:00:00Z",
      status: "present",
    });
    mockBatchUpdateAttendance.mockResolvedValueOnce({
      existing,
      attendance: existing,
      created: false,
    });

    const evening5pm = new Date("2026-04-08T17:00:00");
    await checkLearnerIn("ABCD1234", {
      testTime: evening5pm,
      testDate: "2026-04-08",
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [id, fields] = mockUpdate.mock.calls[0];
    expect(id).toBe("att1");
    expect(fields).toEqual(
      expect.objectContaining({ time_out: expect.any(String) })
    );
  });

  it("does nothing for unknown NFC UID", async () => {
    mockGetLearnerByNfc.mockResolvedValueOnce(null);

    await checkLearnerIn("UNKNOWN_UID", {
      testTime: new Date("2026-04-08T09:00:00"),
      testDate: "2026-04-08",
    });

    expect(mockBatchUpdateAttendance).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
