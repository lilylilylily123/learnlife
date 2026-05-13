import { describe, it, expect } from "vitest";
import { expandEvents } from "@learnlife/shared";
import type { CalRecord } from "@learnlife/pb-client";

function makeRecord(overrides: Partial<CalRecord> & { id: string }): CalRecord {
  const base: CalRecord = {
    id: overrides.id,
    title: "Untitled",
    start: "2026-04-20 09:00:00.000Z",
    end: "2026-04-20 10:00:00.000Z",
    color: "#ccc",
    emoji: "",
    type: "event",
    recurrence: "none",
    recurrence_days: [],
    recurrence_end: "",
    created_by: "user1",
  };
  return { ...base, ...overrides };
}

describe("expandEvents — one-off events", () => {
  it("includes events whose start falls in the requested month", () => {
    const map = expandEvents(
      [makeRecord({ id: "e1", title: "Field trip", start: "2026-04-15 09:00:00.000Z" })],
      2026,
      3, // April
    );
    expect(map["2026-4-15"]).toHaveLength(1);
    expect(map["2026-4-15"][0].title).toBe("Field trip");
    expect(map["2026-4-15"][0].id).toBe("e1");
    expect(map["2026-4-15"][0].recordId).toBe("e1");
  });

  it("excludes events from other months", () => {
    const map = expandEvents(
      [makeRecord({ id: "e1", start: "2026-05-10 09:00:00.000Z" })],
      2026,
      3,
    );
    expect(Object.keys(map)).toHaveLength(0);
  });

  it("excludes events from a different year, even on the same day-of-month", () => {
    const map = expandEvents(
      [makeRecord({ id: "e1", start: "2025-04-15 09:00:00.000Z" })],
      2026,
      3,
    );
    expect(Object.keys(map)).toHaveLength(0);
  });

  it("groups multiple events on the same day under one key", () => {
    const map = expandEvents(
      [
        makeRecord({ id: "e1", start: "2026-04-15 09:00:00.000Z" }),
        makeRecord({ id: "e2", start: "2026-04-15 13:00:00.000Z" }),
      ],
      2026,
      3,
    );
    expect(map["2026-4-15"]).toHaveLength(2);
    expect(map["2026-4-15"].map((e) => e.id).sort()).toEqual(["e1", "e2"]);
  });

  it("uses the parsed time range in the event's time field", () => {
    const map = expandEvents(
      [
        makeRecord({
          id: "e1",
          start: "2026-04-15 09:00:00.000Z",
          end: "2026-04-15 10:30:00.000Z",
        }),
      ],
      2026,
      3,
    );
    expect(map["2026-4-15"][0].time).toMatch(/–/); // en-dash separator
  });
});

describe("expandEvents — weekly recurring events", () => {
  it("expands a Monday-only series across every Monday in April 2026", () => {
    // April 2026 Mondays: 6, 13, 20, 27 (0=Mon in PB)
    const map = expandEvents(
      [
        makeRecord({
          id: "cls",
          title: "Math",
          recurrence: "weekly",
          recurrence_days: [0],
        }),
      ],
      2026,
      3,
    );
    const mondays = ["2026-4-6", "2026-4-13", "2026-4-20", "2026-4-27"];
    for (const key of mondays) {
      expect(map[key]).toBeDefined();
      expect(map[key][0].title).toBe("Math");
    }
    // No other days populated.
    expect(Object.keys(map).sort()).toEqual([...mondays].sort());
  });

  it("treats recurrence_days alone (without recurrence='weekly') as weekly", () => {
    const map = expandEvents(
      [makeRecord({ id: "cls", recurrence_days: [2] })], // Wednesday
      2026,
      3,
    );
    // April 2026 Wednesdays: 1, 8, 15, 22, 29
    expect(Object.keys(map).sort()).toEqual(
      ["2026-4-1", "2026-4-8", "2026-4-15", "2026-4-22", "2026-4-29"].sort(),
    );
  });

  it("gives each occurrence a unique id while keeping recordId stable", () => {
    const map = expandEvents(
      [makeRecord({ id: "cls", recurrence: "weekly", recurrence_days: [0] })],
      2026,
      3,
    );
    const ids = Object.values(map).flat().map((e) => e.id);
    const recordIds = Object.values(map).flat().map((e) => e.recordId);
    expect(new Set(ids).size).toBe(ids.length); // ids are unique
    expect(new Set(recordIds)).toEqual(new Set(["cls"])); // recordIds all match the source
  });

  it("stops emitting occurrences past recurrence_end", () => {
    const map = expandEvents(
      [
        makeRecord({
          id: "cls",
          recurrence: "weekly",
          recurrence_days: [0],
          recurrence_end: "2026-04-15 00:00:00.000Z",
        }),
      ],
      2026,
      3,
    );
    expect(map["2026-4-6"]).toBeDefined();
    expect(map["2026-4-13"]).toBeDefined();
    expect(map["2026-4-20"]).toBeUndefined();
    expect(map["2026-4-27"]).toBeUndefined();
  });

  it("converts JS Sunday (0) → PB Sunday (6) correctly", () => {
    // April 2026 Sundays: 5, 12, 19, 26
    const map = expandEvents(
      [makeRecord({ id: "cls", recurrence: "weekly", recurrence_days: [6] })],
      2026,
      3,
    );
    expect(Object.keys(map).sort()).toEqual(
      ["2026-4-5", "2026-4-12", "2026-4-19", "2026-4-26"].sort(),
    );
  });

  it("handles multi-day recurrence (Mon + Wed + Fri)", () => {
    const map = expandEvents(
      [makeRecord({ id: "cls", recurrence: "weekly", recurrence_days: [0, 2, 4] })],
      2026,
      3,
    );
    // Mon 6,13,20,27 + Wed 1,8,15,22,29 + Fri 3,10,17,24 = 13 occurrences
    expect(Object.values(map).flat()).toHaveLength(13);
  });
});

describe("expandEvents — mixed inputs", () => {
  it("returns an empty map for no records", () => {
    expect(expandEvents([], 2026, 3)).toEqual({});
  });

  it("combines one-off and recurring records into the same map", () => {
    const map = expandEvents(
      [
        makeRecord({ id: "e1", start: "2026-04-15 09:00:00.000Z" }),
        makeRecord({ id: "cls", recurrence: "weekly", recurrence_days: [0] }),
      ],
      2026,
      3,
    );
    expect(map["2026-4-15"]).toHaveLength(1);
    expect(map["2026-4-15"][0].id).toBe("e1");
    expect(map["2026-4-6"]).toHaveLength(1);
    expect(map["2026-4-6"][0].recordId).toBe("cls");
  });
});
