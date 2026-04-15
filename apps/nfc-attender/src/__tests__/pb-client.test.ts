import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist mocks so they're available inside vi.mock factory
const {
  mockGetFirstListItem,
  mockCreate,
  mockUpdate,
  mockGetList,
  mockCollection,
} = vi.hoisted(() => {
  const mockGetFirstListItem = vi.fn();
  const mockCreate = vi.fn();
  const mockUpdate = vi.fn();
  const mockGetList = vi.fn();
  const mockCollection = vi.fn(() => ({
    getFirstListItem: mockGetFirstListItem,
    create: mockCreate,
    update: mockUpdate,
    getList: mockGetList,
  }));
  return { mockGetFirstListItem, mockCreate, mockUpdate, mockGetList, mockCollection };
});

vi.mock("pocketbase", () => {
  const PocketBase = vi.fn(function (this: any) {
    this.collection = mockCollection;
    this.autoCancellation = vi.fn();
    this.authStore = { isValid: true, onChange: vi.fn() };
  });
  return { default: PocketBase };
});

import { updateAttendance, listAttendance, getAttendance } from "@/lib/pb-client";

const fakeAttendance = {
  id: "att123",
  learner: "learner1",
  date: "2026-04-08",
  time_in: null,
  time_out: null,
  lunch_out: null,
  lunch_in: null,
  lunch_events: null,
  status: null,
  lunch_status: null,
  collectionId: "col1",
  collectionName: "attendance",
  created: "2026-04-08T08:00:00Z",
  updated: "2026-04-08T08:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateAttendance", () => {
  it("uses getFirstListItem to find existing record by date", async () => {
    mockGetFirstListItem.mockResolvedValueOnce(fakeAttendance);
    mockUpdate.mockResolvedValueOnce({ ...fakeAttendance, time_in: "2026-04-08T09:00:00Z" });

    const result = await updateAttendance({
      learnerId: "learner1",
      field: "time_in",
      date: "2026-04-08",
      timestamp: "2026-04-08T09:00:00Z",
    });

    // Should query with date filter, NOT getFullList
    expect(mockGetFirstListItem).toHaveBeenCalledWith(
      'learner = "learner1" && date ~ "2026-04-08"'
    );
    expect(result.status).toBe("updated");
    expect(result.field).toBe("time_in");
  });

  it("creates a new record when none exists for the date", async () => {
    mockGetFirstListItem.mockRejectedValueOnce(new Error("Not found"));
    mockCreate.mockResolvedValueOnce({ ...fakeAttendance, id: "new123" });
    mockUpdate.mockResolvedValueOnce({ ...fakeAttendance, id: "new123", status: "present" });

    const result = await updateAttendance({
      learnerId: "learner1",
      field: "status",
      value: "present",
      date: "2026-04-08",
    });

    expect(mockCreate).toHaveBeenCalledWith({
      learner: "learner1",
      date: "2026-04-08",
    });
    expect(result.status).toBe("updated");
  });

  it("does not overwrite existing timestamp unless force is set", async () => {
    mockGetFirstListItem.mockResolvedValueOnce({
      ...fakeAttendance,
      time_in: "2026-04-08T08:30:00Z",
    });

    const result = await updateAttendance({
      learnerId: "learner1",
      field: "time_in",
      date: "2026-04-08",
      timestamp: "2026-04-08T09:00:00Z",
    });

    expect(result.status).toBe("already_set");
    expect(result.existingValue).toBe("2026-04-08T08:30:00Z");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("overwrites existing timestamp when force is true", async () => {
    mockGetFirstListItem.mockResolvedValueOnce({
      ...fakeAttendance,
      time_in: "2026-04-08T08:30:00Z",
    });
    mockUpdate.mockResolvedValueOnce({
      ...fakeAttendance,
      time_in: "2026-04-08T09:00:00Z",
    });

    const result = await updateAttendance({
      learnerId: "learner1",
      field: "time_in",
      date: "2026-04-08",
      timestamp: "2026-04-08T09:00:00Z",
      force: true,
    });

    expect(result.status).toBe("updated");
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("rejects invalid fields", async () => {
    await expect(
      updateAttendance({
        learnerId: "learner1",
        field: "invalid_field",
        date: "2026-04-08",
      })
    ).rejects.toThrow("Invalid field");
  });

  it("rejects invalid status values", async () => {
    await expect(
      updateAttendance({
        learnerId: "learner1",
        field: "status",
        value: "invalid_status",
        date: "2026-04-08",
      })
    ).rejects.toThrow("Invalid status value");
  });

  it("does not make a separate learner verification call", async () => {
    mockGetFirstListItem.mockResolvedValueOnce(fakeAttendance);
    mockUpdate.mockResolvedValueOnce({ ...fakeAttendance, status: "present" });

    await updateAttendance({
      learnerId: "learner1",
      field: "status",
      value: "present",
      date: "2026-04-08",
    });

    // collection("learners").getOne() should NOT be called
    const collectionCalls = mockCollection.mock.calls.map((c) => c[0]);
    expect(collectionCalls).not.toContain("learners");
  });
});

describe("getAttendance", () => {
  it("returns existing record using getFirstListItem with date filter", async () => {
    mockGetFirstListItem.mockResolvedValueOnce(fakeAttendance);

    const result = await getAttendance("learner1", "2026-04-08");

    expect(mockGetFirstListItem).toHaveBeenCalledWith(
      'learner = "learner1" && date ~ "2026-04-08"',
      { expand: "learner" }
    );
    expect(result.exists).toBe(true);
    expect(result.attendance).toEqual(fakeAttendance);
  });

  it("returns null when no record exists", async () => {
    mockGetFirstListItem.mockRejectedValueOnce(new Error("Not found"));

    const result = await getAttendance("learner1", "2026-04-08");

    expect(result.exists).toBe(false);
    expect(result.attendance).toBeNull();
  });
});

describe("listAttendance", () => {
  it("filters by date and uses pagination", async () => {
    mockGetList.mockResolvedValueOnce({
      items: [fakeAttendance],
      totalItems: 1,
      totalPages: 1,
      page: 1,
    });

    const result = await listAttendance({ date: "2026-04-08", perPage: 100 });

    expect(mockGetList).toHaveBeenCalledWith(1, 100, {
      filter: 'date ~ "2026-04-08"',
      expand: "learner",
      sort: "-created",
    });
    expect(result.items).toHaveLength(1);
  });
});
