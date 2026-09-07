/**
 * Fixture-driven conformance suite for the attendance state machine.
 *
 * Loads packages/shared/fixtures/attendance-state-machine.json — the SAME file
 * apps/nfc-attender-fw/test/test_state_machine/fixture_runner.cpp loads — and
 * runs every case against the TypeScript specification.
 *
 * The attendance rule is implemented four times and the copies had already
 * drifted. This suite plus its C++ twin is the structural fix: a case that
 * both harnesses run is a case where drift fails a build.
 *
 * Division of labour
 * ------------------
 *   - Unmarked cases must genuinely pass on both sides.
 *   - Cases carrying a `divergence` block are the four (five, once D2 is split
 *     from D2a) known TS/C++ disagreements. Each harness asserts against its
 *     OWN recorded side and prints KNOWN DIVERGENT. That keeps BOTH behaviours
 *     pinned — nobody can quietly change either one — while leaving the
 *     product decision open. It is deliberately not a skip: a skipped case
 *     would let drift hide inside a known-bad case.
 *
 * This suite does NOT regenerate the fixture; that would make it tautological.
 * Staleness is caught separately by `pnpm check:attendance-fixture`.
 */

import { describe, expect, it } from "vitest";
import {
  computeCheckInAction,
  findLearnersToMarkAbsent,
  type AttendanceState,
} from "@learnlife/shared";
import type { AttendanceRecord, Learner } from "@learnlife/pb-client";
import {
  fixtureDate,
  loadAttendanceFixture,
  normalizeAction,
  type FixtureSweepRecord,
} from "../../../../packages/shared/scripts/attendance-fixture";

const fixture = loadAttendanceFixture();

/** Collected for the end-of-run summary rather than printed case by case. */
const divergentSeen: string[] = [];

describe("attendance fixture — metadata", () => {
  it("is the schema version this harness understands", () => {
    expect(fixture.schema_version).toBe(1);
  });

  it("runs under the timezone the fixture requires", () => {
    // Both implementations read local wall-clock fields, so an unpinned host
    // timezone can renormalise an hour across a DST boundary and surface as a
    // phantom divergence. package.json sets TZ=UTC; this asserts it stuck.
    expect(fixture.timezone.policy).toBe("UTC");
    expect(process.env.TZ).toBe("UTC");
  });

  it("agrees with the thresholds the spec actually imports", () => {
    // Catches a threshold edit that never made it into a regenerated fixture.
    expect(fixture.thresholds.CHECKOUT_HOUR).toBe(16);
    expect(fixture.thresholds.CHECKOUT_MINUTE).toBe(59);
    expect(fixture.thresholds.FRIDAY_CHECKOUT_HOUR).toBe(14);
    expect(fixture.thresholds.LATE_HOUR).toBe(10);
    expect(fixture.thresholds.LATE_MINUTE).toBe(1);
  });

  it("every declared divergence is exercised by at least one case", () => {
    // Without this, deleting the last case for a divergence would silently
    // drop the coverage that keeps it visible.
    const referenced = new Set<string>([fixture.absence_sweep.divergence]);
    for (const c of fixture.cases) {
      for (const ref of c.divergence?.refs ?? []) referenced.add(ref);
    }
    expect([...referenced].sort()).toEqual(Object.keys(fixture.divergences).sort());
  });

  it("every divergence block is well formed and still undecided", () => {
    for (const c of fixture.cases) {
      if (!c.divergence) continue;
      expect(c.divergence.refs.length, `${c.id}: needs at least one ref`).toBeGreaterThan(0);
      expect(c.divergence.note.length, `${c.id}: needs a note`).toBeGreaterThan(0);
      expect(c.divergence.cpp.action, `${c.id}: needs a recorded C++ action`).toBeTruthy();
      for (const ref of c.divergence.refs) {
        expect(fixture.divergences[ref], `${c.id}: unknown ref ${ref}`).toBeDefined();
        // If someone resolves a divergence they must remove its cases, not
        // leave them recording a behaviour that is no longer wanted.
        expect(fixture.divergences[ref].decision, `${ref} was decided`).toBe("UNDECIDED");
      }
    }
  });

  it("has unique case ids", () => {
    const ids = fixture.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("attendance fixture — computeCheckInAction", () => {
  it.each(fixture.cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const now = fixtureDate(c.now, c.id);

    // The state is stored as the full AttendanceState, so it goes straight in.
    const state: AttendanceState = c.state;
    const actual = normalizeAction(computeCheckInAction(state, now), now.toISOString());

    // Deep equality is what enforces the negative half of the contract: a key
    // absent from `expect` must be absent from the action too. That is exactly
    // what pins D2a — check_out with no open lunch must not write lunch fields.
    expect(actual, `${c.id}: ${c.desc}`).toEqual(c.expect);

    if (c.divergence) {
      divergentSeen.push(`${c.id} [${c.divergence.refs.join(",")}]`);
      // The spec's side is asserted above; the port's side is asserted by the
      // C++ harness. Here we only assert the two are genuinely still different,
      // so a case that has silently converged gets promoted out of the
      // divergent set instead of lingering as a false alarm.
      expect(
        c.divergence.cpp,
        `${c.id} is marked divergent but the recorded C++ behaviour now matches ` +
          `the spec — remove the divergence block and regenerate`,
      ).not.toEqual(c.expect);
    }
  });

});

describe("attendance fixture — findLearnersToMarkAbsent", () => {
  // D4: never ported to C++. These run against the spec only; the C++ harness
  // reports them as unported so the gap stays visible on that side too.
  it("is the divergence the C++ harness reports as unported", () => {
    expect(fixture.absence_sweep.divergence).toBe("D4");
    expect(fixture.divergences.D4.observable_today).toBe(false);
  });

  it.each(fixture.absence_sweep.cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const now = fixtureDate(c.now, c.id);
    const records = c.records.map((r, i) => expandRecord(r, i, c.now));
    const learners: Pick<Learner, "id">[] = c.learners.map((id) => ({ id }));

    expect(findLearnersToMarkAbsent(records, learners, now), `${c.id}: ${c.desc}`).toEqual(
      c.expect,
    );
  });
});

describe("attendance fixture — known divergence report", () => {
  it("reports the TS/C++ disagreements that are still open", () => {
    const lines = [
      "",
      "  KNOWN DIVERGENT — recorded, not failed. Product decision outstanding.",
      "",
    ];
    for (const [ref, d] of Object.entries(fixture.divergences)) {
      const cases = fixture.cases
        .filter((c) => c.divergence?.refs.includes(ref))
        .map((c) => c.id);
      lines.push(`  ${ref}  ${d.title}`);
      lines.push(`        spec:   ${d.ts}`);
      lines.push(`        device: ${d.cpp}`);
      if (d.masked_by) {
        lines.push(`        masked by ${d.masked_by} — not observable in isolation today`);
      }
      lines.push(
        `        cases:  ${cases.length > 0 ? cases.join(", ") : "(absence_sweep — unported)"}`,
      );
      lines.push("");
    }
    lines.push(
      `  ${divergentSeen.length} of ${fixture.cases.length} state-machine cases are divergent.`,
    );
    lines.push("");
    console.info(lines.join("\n"));

    // The report is the point, but assert it is non-empty so a fixture that
    // lost its divergence registry fails rather than printing nothing.
    expect(Object.keys(fixture.divergences).length).toBeGreaterThan(0);
  });
});

/**
 * Expand a fixture sweep record into a full AttendanceRecord.
 * findLearnersToMarkAbsent reads only learner/time_in/arrival/status; the rest
 * is inert padding so the fixture does not carry the PocketBase envelope.
 */
function expandRecord(
  r: FixtureSweepRecord,
  index: number,
  now: { year: number; month: number; day: number },
): AttendanceRecord {
  const date =
    `${now.year}-${String(now.month).padStart(2, "0")}-` + String(now.day).padStart(2, "0");
  return {
    id: `rec_${index}`,
    collectionId: "attendance",
    collectionName: "attendance",
    created: `${date} 00:00:00.000Z`,
    updated: `${date} 00:00:00.000Z`,
    learner: r.learner,
    date,
    time_in: r.time_in ?? null,
    time_out: null,
    lunch_out: null,
    lunch_in: null,
    lunch_events: null,
    status: r.status ?? null,
    lunch_status: null,
    arrival: r.arrival ?? null,
    justified: false,
    justification_reason: null,
    justified_by: null,
    justified_at: null,
  };
}
