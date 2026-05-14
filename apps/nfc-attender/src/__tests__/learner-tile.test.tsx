import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  WallView,
  getWallTone,
  lunchLabel,
  formatTimeShort,
  shortCardNum,
} from "../app/components/AttenderD";
import type { Student } from "../app/types";

/**
 * Component tests for the wall/scan tile rendering logic.
 *
 * The original LearnerCard.tsx referenced in issue #24 was deleted in the
 * ll-ui design refactor (d749dbc) and its responsibilities now live inside
 * AttenderD.tsx as a set of small pure helpers (getWallTone, lunchLabel,
 * formatTimeShort, shortCardNum) plus the WallView tile that renders one
 * Student. This file covers all of those.
 */

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: "stu1",
    collectionId: "learners",
    collectionName: "learners",
    created: "2026-05-14T08:00:00Z",
    updated: "2026-05-14T08:00:00Z",
    uid: "u1",
    name: "Ada Lovelace",
    email: "ada@learnlife.test",
    dob: "2010-12-10",
    NFC_ID: "ABCDEF",
    time_in: null,
    time_out: null,
    lunch_events: null,
    status: undefined,
    program: "exp",
    ...overrides,
  } as Student;
}

// ── getWallTone ──────────────────────────────────────────────────────────────

describe("getWallTone", () => {
  it("returns the checked-out tone (with title 'Checked out') when time_out is set", () => {
    const tone = getWallTone(makeStudent({ time_out: "2026-05-14T15:00:00Z" }));
    expect(tone.title).toBe("Checked out");
    expect(tone.flag).toBeUndefined();
  });

  it("flags 'LUNCH' when the last lunch event is 'out'", () => {
    const tone = getWallTone(
      makeStudent({
        time_in: "2026-05-14T09:00:00Z",
        lunch_events: [{ type: "out", time: "2026-05-14T12:00:00Z" }],
      }),
    );
    expect(tone.flag).toBe("LUNCH");
    expect(tone.title).toBe("At lunch");
  });

  it("flags 'LATE' when checked in with status=late", () => {
    const tone = getWallTone(
      makeStudent({ time_in: "2026-05-14T09:30:00Z", status: "late" }),
    );
    expect(tone.flag).toBe("LATE");
    expect(tone.title).toBe("Late");
  });

  it("flags 'J·L' for justified-late, with a dashed-style ghost tone", () => {
    const tone = getWallTone(
      makeStudent({ time_in: "2026-05-14T09:30:00Z", status: "jLate" }),
    );
    expect(tone.flag).toBe("J·L");
    expect(tone.title).toBe("Justified late");
    expect(tone.bg).toBe("transparent");
  });

  it("returns a present-tone (no flag) when checked in with no status escalation", () => {
    const tone = getWallTone(makeStudent({ time_in: "2026-05-14T09:00:00Z" }));
    expect(tone.flag).toBeUndefined();
    expect(tone.title).toBe("Present");
  });

  it("flags 'J·A' when not checked in but status=jAbsent", () => {
    const tone = getWallTone(makeStudent({ status: "jAbsent" }));
    expect(tone.flag).toBe("J·A");
    expect(tone.title).toBe("Justified absent");
    expect(tone.bg).toBe("transparent");
  });

  it("uses a dashed border for the no-check-in state, distinguishing it from a real absence", () => {
    const noCheckIn = getWallTone(makeStudent());
    expect(noCheckIn.dashed).toBe(true);
    expect(noCheckIn.title).toBe("No check-in");

    const markedAbsent = getWallTone(makeStudent({ status: "absent" }));
    expect(markedAbsent.dashed).toBe(true);
    expect(markedAbsent.title).toBe("Marked absent");
  });
});

// ── lunchLabel ───────────────────────────────────────────────────────────────

describe("lunchLabel", () => {
  it.each([
    ["present", "on time"],
    ["late", "late"],
    ["absent", "skipped"],
    ["jLate", "j·late"],
    ["jAbsent", "j·skipped"],
  ])("maps %s → %s", (input, expected) => {
    expect(lunchLabel(input)).toBe(expected);
  });

  it("passes unknown values through unchanged", () => {
    expect(lunchLabel("something-else")).toBe("something-else");
  });
});

// ── formatTimeShort ──────────────────────────────────────────────────────────

describe("formatTimeShort", () => {
  it("returns '—' for null/undefined/empty input", () => {
    expect(formatTimeShort(null)).toBe("—");
    expect(formatTimeShort(undefined)).toBe("—");
    expect(formatTimeShort("")).toBe("—");
  });

  it("returns the raw input when the timestamp is unparseable", () => {
    expect(formatTimeShort("not-a-date")).toBe("not-a-date");
  });

  it("formats a valid ISO timestamp as HH:MM with hour12 disabled", () => {
    // 14:05 in UTC — the test env runs with TZ=UTC for jest, but vitest
    // inherits the user's TZ. To stay locale-agnostic, just check the shape:
    // either HH:MM digits, or a known 24h value if the system is UTC.
    const out = formatTimeShort("2026-05-14T14:05:00Z");
    expect(out).toMatch(/^\d{2}:\d{2}$/);
  });
});

// ── shortCardNum ─────────────────────────────────────────────────────────────

describe("shortCardNum", () => {
  it("takes the last 3 alphanumeric chars and uppercases them", () => {
    expect(shortCardNum("nfc-abcdef")).toBe("#A-DEF");
    expect(shortCardNum("AbCdEf")).toBe("#A-DEF");
  });

  it("strips non-alphanumeric characters before slicing", () => {
    expect(shortCardNum("nfc-:::a/b/c")).toBe("#A-ABC");
  });

  it("falls back to 000 when the id has no alphanumerics", () => {
    expect(shortCardNum("---")).toBe("#A-000");
    expect(shortCardNum("")).toBe("#A-000");
  });
});

// ── WallView (component) ─────────────────────────────────────────────────────

describe("WallView", () => {
  it("renders one tile per filtered student with name + check-in time", () => {
    const students = [
      makeStudent({ id: "s1", name: "Ada", time_in: "2026-05-14T09:00:00Z" }),
      makeStudent({ id: "s2", name: "Grace", time_in: null }),
    ];

    render(<WallView filtered={students} uid="" />);

    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
    // Grace has no check-in → em dash placeholder
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows the program code (uppercased, first 4 chars) when the student has no flag", () => {
    render(
      <WallView
        filtered={[
          makeStudent({
            id: "s1",
            name: "Ada",
            program: "chmk",
            time_in: "2026-05-14T09:00:00Z",
          }),
        ]}
        uid=""
      />,
    );

    expect(screen.getByText("CHMK")).toBeInTheDocument();
  });

  it("shows the LATE flag instead of the program code when status=late", () => {
    render(
      <WallView
        filtered={[
          makeStudent({
            id: "s1",
            name: "Ada",
            program: "exp",
            status: "late",
            time_in: "2026-05-14T09:30:00Z",
          }),
        ]}
        uid=""
      />,
    );

    expect(screen.getByText("LATE")).toBeInTheDocument();
    // Program code suppressed when a flag is set
    expect(screen.queryByText("EXP")).not.toBeInTheDocument();
  });

  it("renders the title as a tooltip describing the tone", () => {
    render(
      <WallView
        filtered={[
          makeStudent({ id: "s1", name: "Ada", time_in: "2026-05-14T09:00:00Z" }),
        ]}
        uid=""
      />,
    );

    // The inner name <div> also has title={s.name}; walk up one extra step to
    // the outer tile, whose title describes the tone ("Present").
    const nameDiv = screen.getByText("Ada");
    const tile = nameDiv.parentElement as HTMLElement;
    expect(tile.getAttribute("title")).toBe("Present");
  });

  it("renders nothing when the filtered roster is empty", () => {
    const { container } = render(<WallView filtered={[]} uid="" />);
    // The grid wrapper exists but has no tile children.
    const grid = container.querySelector(".grid") as HTMLElement;
    expect(grid).not.toBeNull();
    expect(within(grid).queryByText(/[A-Z]/)).toBeNull();
  });
});
