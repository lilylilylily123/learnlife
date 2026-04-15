import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock PocketBase
const mockGetFirstListItem = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockGetFullList = vi.fn();

vi.mock("pocketbase", () => {
  const PocketBase = vi.fn(function (this: any) {
    this.collection = vi.fn(() => ({
      getFirstListItem: mockGetFirstListItem,
      create: mockCreate,
      update: mockUpdate,
      getFullList: mockGetFullList,
    }));
    this.autoCancellation = vi.fn();
    this.authStore = { isValid: true, onChange: vi.fn() };
  });
  return { default: PocketBase };
});

// Mock pb-client module
const mockUpdateAttendance = vi.fn();
const mockGetAttendance = vi.fn();

vi.mock("@/lib/pb-client", () => ({
  updateAttendance: (...args: unknown[]) => mockUpdateAttendance(...args),
  getAttendance: (...args: unknown[]) => mockGetAttendance(...args),
}));

import { checkLearnerIn, getLearnerByNfc } from "@/app/utils/utils";

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

beforeEach(() => {
  vi.clearAllMocks();
  // Default: learner exists
  mockGetFirstListItem.mockResolvedValue(fakeLearner);
  // Default: no existing attendance
  mockGetAttendance.mockResolvedValue({ attendance: null, exists: false });
  // Default: update succeeds
  mockUpdateAttendance.mockResolvedValue({ status: "updated" });
});

describe("getLearnerByNfc", () => {
  it("returns learner when found", async () => {
    const result = await getLearnerByNfc("ABCD1234");
    expect(result).toEqual(fakeLearner);
    expect(mockGetFirstListItem).toHaveBeenCalledWith("NFC_ID = 'ABCD1234'");
  });

  it("returns null when not found", async () => {
    mockGetFirstListItem.mockRejectedValueOnce(new Error("Not found"));
    const result = await getLearnerByNfc("UNKNOWN");
    expect(result).toBeNull();
  });
});

describe("checkLearnerIn", () => {
  it("checks in as present before 10:01 AM", async () => {
    const morning9am = new Date("2026-04-08T09:00:00");

    await checkLearnerIn("ABCD1234", {
      testTime: morning9am,
      testDate: "2026-04-08",
    });

    // Should set time_in
    expect(mockUpdateAttendance).toHaveBeenCalledWith(
      expect.objectContaining({
        learnerId: "learner1",
        field: "time_in",
        date: "2026-04-08",
      })
    );

    // Should set status to "present"
    expect(mockUpdateAttendance).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "status",
        value: "present",
      })
    );
  });

  it("checks in as late at 10:01 AM or after", async () => {
    const morning1001 = new Date("2026-04-08T10:01:00");

    await checkLearnerIn("ABCD1234", {
      testTime: morning1001,
      testDate: "2026-04-08",
    });

    expect(mockUpdateAttendance).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "status",
        value: "late",
      })
    );
  });

  it("does not re-check-in if already checked in", async () => {
    mockGetAttendance.mockResolvedValueOnce({
      attendance: { time_in: "2026-04-08T09:00:00Z", time_out: null, lunch_events: [] },
      exists: true,
    });

    // Time outside lunch window and before checkout
    const morning11 = new Date("2026-04-08T11:00:00");
    await checkLearnerIn("ABCD1234", {
      testTime: morning11,
      testDate: "2026-04-08",
    });

    // Should not attempt to set time_in again
    const timeInCalls = mockUpdateAttendance.mock.calls.filter(
      (c: any[]) => c[0]?.field === "time_in"
    );
    expect(timeInCalls).toHaveLength(0);
  });

  it("creates lunch-out event during 1-2pm window", async () => {
    mockGetAttendance.mockResolvedValueOnce({
      attendance: { time_in: "2026-04-08T09:00:00Z", time_out: null, lunch_events: [] },
      exists: true,
    });

    const lunch1pm = new Date("2026-04-08T13:00:00");
    await checkLearnerIn("ABCD1234", {
      testTime: lunch1pm,
      testDate: "2026-04-08",
    });

    expect(mockUpdateAttendance).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "lunch_events",
        force: true,
      })
    );

    // Verify the event is an 'out' type
    const lunchCall = mockUpdateAttendance.mock.calls.find(
      (c: any[]) => c[0]?.field === "lunch_events"
    );
    const events = JSON.parse(lunchCall[0].value);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("out");
  });

  it("creates lunch-in event when last event was out", async () => {
    const existingLunchOut = [{ type: "out", time: "2026-04-08T13:00:00Z" }];
    mockGetAttendance.mockResolvedValueOnce({
      attendance: {
        time_in: "2026-04-08T09:00:00Z",
        time_out: null,
        lunch_events: existingLunchOut,
      },
      exists: true,
    });

    const lunch130pm = new Date("2026-04-08T13:30:00");
    await checkLearnerIn("ABCD1234", {
      testTime: lunch130pm,
      testDate: "2026-04-08",
    });

    const lunchCall = mockUpdateAttendance.mock.calls.find(
      (c: any[]) => c[0]?.field === "lunch_events"
    );
    const events = JSON.parse(lunchCall[0].value);
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe("in");
  });

  it("checks out for the day at 4:59 PM or later", async () => {
    mockGetAttendance.mockResolvedValueOnce({
      attendance: {
        time_in: "2026-04-08T09:00:00Z",
        time_out: null,
        lunch_events: [],
      },
      exists: true,
    });

    const evening5pm = new Date("2026-04-08T17:00:00");
    await checkLearnerIn("ABCD1234", {
      testTime: evening5pm,
      testDate: "2026-04-08",
    });

    expect(mockUpdateAttendance).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "time_out",
        learnerId: "learner1",
      })
    );
  });

  it("does nothing for unknown NFC UID", async () => {
    mockGetFirstListItem.mockRejectedValueOnce(new Error("Not found"));

    await checkLearnerIn("UNKNOWN_UID", {
      testTime: new Date("2026-04-08T09:00:00"),
      testDate: "2026-04-08",
    });

    expect(mockUpdateAttendance).not.toHaveBeenCalled();
  });
});
