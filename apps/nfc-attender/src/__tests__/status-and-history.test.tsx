import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  StatusEditor,
  buildScanHistory,
  ScanHistoryCell,
} from "../app/components/AttenderD";
import { groupRosterRows } from "../app/history/page";
import type { Student } from "../app/types";
import type { AttendanceRecord, Learner } from "@learnlife/pb-client";

// ─── StatusEditor ──────────────────────────────────────────────────────────

describe("StatusEditor", () => {
  it("renders 'Set' placeholder when no value", () => {
    render(<StatusEditor value={undefined} onChange={vi.fn()} />);
    expect(screen.getByText(/set/i)).toBeInTheDocument();
  });

  it("opens the popover and calls onChange when picking a status", () => {
    const onChange = vi.fn();
    render(<StatusEditor value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByTitle(/set status/i));
    fireEvent.click(screen.getByText(/^Late$/));
    expect(onChange).toHaveBeenCalledWith("late");
  });

  it("hides the lunch section when onLunchChange is not provided", () => {
    render(<StatusEditor value="present" onChange={vi.fn()} />);
    fireEvent.click(screen.getByTitle(/set status/i));
    expect(screen.queryByText(/^Lunch$/)).not.toBeInTheDocument();
    expect(screen.getByText(/^Morning$/)).toBeInTheDocument();
  });

  it("shows the lunch section and caption when onLunchChange is provided", () => {
    render(
      <StatusEditor
        value="present"
        lunchValue="late"
        onChange={vi.fn()}
        onLunchChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/lunch · late/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle(/set status/i));
    expect(screen.getByText(/^Lunch$/)).toBeInTheDocument();
  });

  it("dispatches onLunchChange independently from morning onChange", () => {
    const onChange = vi.fn();
    const onLunchChange = vi.fn();
    render(
      <StatusEditor
        value="present"
        lunchValue=""
        onChange={onChange}
        onLunchChange={onLunchChange}
      />,
    );
    fireEvent.click(screen.getByTitle(/set status/i));
    // Two "Late" rows now exist (one in morning section, one in lunch section)
    const lateRows = screen.getAllByText(/^Late$/);
    expect(lateRows.length).toBeGreaterThanOrEqual(2);
    // Click the one inside the lunch section: it's the second occurrence
    fireEvent.click(lateRows[1]);
    expect(onLunchChange).toHaveBeenCalledWith("late");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    render(<StatusEditor value={undefined} onChange={vi.fn()} />);
    fireEvent.click(screen.getByTitle(/set status/i));
    expect(screen.getByText(/^Morning$/)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText(/^Morning$/)).not.toBeInTheDocument();
  });
});

// ─── buildScanHistory ──────────────────────────────────────────────────────

describe("buildScanHistory", () => {
  const baseStudent = {
    id: "s1",
    collectionId: "x",
    collectionName: "learners",
    created: "",
    updated: "",
    uid: "",
    name: "Test",
    email: "",
    dob: "",
    NFC_ID: null,
  } as unknown as Student;

  it("returns empty list when no scans recorded", () => {
    expect(buildScanHistory(baseStudent)).toEqual([]);
  });

  it("orders events chronologically across check-in / lunch / check-out", () => {
    const s = {
      ...baseStudent,
      time_in: "2026-05-05T09:42:00.000Z",
      time_out: "2026-05-05T17:02:00.000Z",
      lunch_events: [
        { type: "out" as const, time: "2026-05-05T13:05:00.000Z" },
        { type: "in" as const, time: "2026-05-05T13:48:00.000Z" },
      ],
    };
    const events = buildScanHistory(s);
    expect(events.map((e) => e.label)).toEqual([
      "Check-in",
      "Lunch out",
      "Lunch in",
      "Check-out",
    ]);
    expect(events[0].arrow).toBe("→");
    expect(events[1].arrow).toBe("↗");
    expect(events[2].arrow).toBe("↘");
    expect(events[3].arrow).toBe("←");
  });

  it("handles a learner still at lunch (1 lunch event, no check-out)", () => {
    const s = {
      ...baseStudent,
      time_in: "2026-05-05T09:42:00.000Z",
      lunch_events: [
        { type: "out" as const, time: "2026-05-05T13:05:00.000Z" },
      ],
    };
    const events = buildScanHistory(s);
    expect(events).toHaveLength(2);
    expect(events[events.length - 1].tone).toBe("lunch-out");
  });
});

// ─── ScanHistoryCell ───────────────────────────────────────────────────────

describe("ScanHistoryCell", () => {
  const studentWithLunch = {
    id: "s1",
    collectionId: "x",
    collectionName: "learners",
    created: "",
    updated: "",
    uid: "",
    name: "Maria",
    email: "",
    dob: "",
    NFC_ID: null,
    time_in: "2026-05-05T09:42:00.000Z",
    lunch_events: [
      { type: "out", time: "2026-05-05T13:05:00.000Z" },
      { type: "in", time: "2026-05-05T13:48:00.000Z" },
    ],
  } as unknown as Student;

  it("renders an em-dash when no scans", () => {
    const empty = {
      id: "s2",
      collectionId: "x",
      collectionName: "learners",
      created: "",
      updated: "",
      uid: "",
      name: "Empty",
      email: "",
      dob: "",
      NFC_ID: null,
    } as unknown as Student;
    render(<ScanHistoryCell student={empty} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows lunch count and full chronology in the popover", () => {
    render(<ScanHistoryCell student={studentWithLunch} />);
    expect(screen.getByText(/lunch · 2×/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle(/scans? — click for history/i));
    const popover = screen.getByText(/scan history · 3/i).parentElement!;
    const labels = within(popover).getAllByText(
      /Check-in|Lunch out|Lunch in|Check-out/,
    );
    expect(labels.map((n) => n.textContent)).toEqual([
      "Check-in",
      "Lunch out",
      "Lunch in",
    ]);
  });
});

// ─── groupRosterRows (history Story view) ──────────────────────────────────

describe("groupRosterRows", () => {
  const learner = (id: string, name: string): Learner =>
    ({ id, name, email: "" }) as unknown as Learner;
  const record = (
    learnerId: string,
    overrides: Partial<AttendanceRecord> = {},
  ): AttendanceRecord =>
    ({
      id: `att-${learnerId}`,
      learner: learnerId,
      date: "2026-05-05",
      time_in: null,
      time_out: null,
      lunch_events: [],
      status: "",
      lunch_status: "",
      ...overrides,
    }) as unknown as AttendanceRecord;

  it("places present and late learners (with check-in) in 'here'", () => {
    const rows = [
      {
        learner: learner("a", "Alice"),
        record: record("a", {
          status: "present",
          time_in: "2026-05-05T09:42:00.000Z",
        }),
      },
      {
        learner: learner("b", "Bob"),
        record: record("b", {
          status: "late",
          time_in: "2026-05-05T10:14:00.000Z",
        }),
      },
    ];
    const groups = groupRosterRows(rows);
    expect(groups.here).toHaveLength(2);
    expect(groups.justified).toHaveLength(0);
    expect(groups.missing).toHaveLength(0);
  });

  it("places jLate / jAbsent in 'justified', sorted by name", () => {
    const rows = [
      { learner: learner("z", "Zara"), record: record("z", { status: "jAbsent" }) },
      { learner: learner("a", "Anna"), record: record("a", { status: "jLate" }) },
    ];
    const groups = groupRosterRows(rows);
    expect(groups.justified.map((r) => r.learner.name)).toEqual([
      "Anna",
      "Zara",
    ]);
  });

  it("places no-record learners and explicit absent in 'missing'", () => {
    const rows = [
      { learner: learner("a", "Adrian"), record: null },
      {
        learner: learner("b", "Beatriz"),
        record: record("b", { status: "absent" }),
      },
    ];
    const groups = groupRosterRows(rows);
    expect(groups.missing).toHaveLength(2);
    expect(groups.here).toHaveLength(0);
    expect(groups.justified).toHaveLength(0);
  });

  it("sorts 'here' by check-in time ascending", () => {
    const rows = [
      {
        learner: learner("late", "Zoe"),
        record: record("late", {
          status: "late",
          time_in: "2026-05-05T10:30:00.000Z",
        }),
      },
      {
        learner: learner("early", "Akiko"),
        record: record("early", {
          status: "present",
          time_in: "2026-05-05T08:55:00.000Z",
        }),
      },
    ];
    const groups = groupRosterRows(rows);
    expect(groups.here.map((r) => r.learner.name)).toEqual(["Akiko", "Zoe"]);
  });
});
