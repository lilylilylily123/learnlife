/**
 * Schema, loader and action normaliser for
 * packages/shared/fixtures/attendance-state-machine.json.
 *
 * Imported by both the generator (generate-attendance-fixture.ts) and the
 * Vitest harness (apps/nfc-attender/src/__tests__/attendance-fixture.test.ts)
 * so the two cannot disagree about what a CheckInAction flattens to. The C++
 * harness reimplements `normalizeAction` against the same written contract —
 * that reimplementation is the point of the exercise, since it is what catches
 * the port drifting.
 *
 * Side-effect free: importing this must never read or write the fixture.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TIME_THRESHOLDS } from "@learnlife/pb-client";
import type { AttendanceState, CheckInAction } from "../src/attendance";

/**
 * Stands in for "the ISO-8601 rendering of this case's `now`". Stored instead
 * of a literal timestamp so the fixture is host-timezone independent: each
 * harness expands it using its own clock conversion, and no timestamp string
 * ever has to agree across the two runtimes.
 */
export const NOW_SENTINEL = "$now";

/** Wall clock for a case. `month` is 1-based; `weekday` is Sun=0..Sat=6. */
export interface FixtureNow {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

/**
 * An expected outcome. `action` names the branch; every other key is a field
 * that implementation must set. A key that is ABSENT must not be set — that
 * negative is what pins D2a.
 */
export type FixtureExpectation = Record<string, unknown>;

/** Recorded behaviour of the C++ port where it disagrees with the spec. */
export interface FixtureDivergence {
  /** Keys into the fixture's `divergences` registry. */
  refs: string[];
  note: string;
  cpp: FixtureExpectation;
}

export interface FixtureCase {
  id: string;
  desc: string;
  now: FixtureNow;
  state: AttendanceState;
  expect: FixtureExpectation;
  divergence?: FixtureDivergence;
}

/** Only the AttendanceRecord fields findLearnersToMarkAbsent actually reads. */
export interface FixtureSweepRecord {
  learner: string;
  time_in?: string | null;
  arrival?: "present" | "late" | "absent" | null;
  status?: "present" | "late" | "absent" | "jLate" | "jAbsent" | null;
}

export interface FixtureSweepCase {
  id: string;
  desc: string;
  now: FixtureNow;
  learners: string[];
  records: FixtureSweepRecord[];
  /** Learner ids findLearnersToMarkAbsent returns. */
  expect: string[];
}

export interface FixtureDivergenceEntry {
  title: string;
  ts: string;
  cpp: string;
  impact: string;
  observable_today: boolean;
  decision: string;
  masked_by?: string;
  masking_note?: string;
  /**
   * How a divergence with no per-case `divergence` block is held in place.
   * Every registered divergence must be pinned by SOMETHING — either at least
   * one case referencing it, or this.
   */
  pinned_by?: string;
  /**
   * Set when the port omits a whole field rather than producing a different
   * action. The C++ harness skips exactly this key when comparing and reports
   * the divergence once, instead of marking every affected case divergent and
   * drowning out the per-case signal. Read from the fixture so the key name
   * lives in one place.
   */
  cpp_skips_field?: string;
}

export interface AttendanceFixture {
  $comment: string;
  schema_version: number;
  generator: string;
  spec: string;
  harnesses: string[];
  implementations: string[];
  timezone: Record<string, string>;
  conventions: Record<string, string>;
  thresholds: typeof TIME_THRESHOLDS;
  known_shared_defects: { id: string; note: string }[];
  divergences: Record<string, FixtureDivergenceEntry>;
  cases: FixtureCase[];
  absence_sweep: {
    divergence: string;
    note: string;
    cases: FixtureSweepCase[];
  };
}

/** Absolute path to the committed fixture. */
export const FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/attendance-state-machine.json",
);

export function loadAttendanceFixture(path: string = FIXTURE_PATH): AttendanceFixture {
  return JSON.parse(readFileSync(path, "utf8")) as AttendanceFixture;
}

/**
 * Flatten a CheckInAction into the fixture's expectation shape.
 *
 * This is the contract the C++ harness mirrors, so keep it mechanical: emit
 * `action` plus exactly the fields the branch sets, and never emit a key with
 * an undefined value — an absent key means "must not be set".
 */
export function normalizeAction(
  action: CheckInAction,
  nowIso: string,
): FixtureExpectation {
  const stamp = (iso: string): string => {
    if (iso !== nowIso) {
      throw new Error(`expected timestamp ${iso} to equal now (${nowIso})`);
    }
    return NOW_SENTINEL;
  };
  const events = (json: string): { type: string; time: string }[] =>
    (JSON.parse(json) as { type: string; time: string }[]).map((e) => ({
      type: e.type,
      time: e.time === nowIso ? NOW_SENTINEL : e.time,
    }));

  switch (action.type) {
    case "check_in":
      return {
        action: "check_in",
        time_in: stamp(action.fields.time_in),
        arrival: action.fields.arrival,
        justified: action.fields.justified,
        status: action.fields.status,
      };
    case "lunch_event": {
      const e: FixtureExpectation = {
        action: "lunch_event",
        lunch_events: events(action.fields.lunch_events),
      };
      if (action.fields.lunch_status !== undefined) {
        e.lunch_status = action.fields.lunch_status;
      }
      return e;
    }
    case "late_lunch_return":
      return {
        action: "late_lunch_return",
        lunch_events: events(action.fields.lunch_events),
        lunch_status: action.fields.lunch_status,
      };
    case "check_out": {
      const e: FixtureExpectation = {
        action: "check_out",
        time_out: stamp(action.fields.time_out),
      };
      if (action.fields.lunch_events !== undefined) {
        e.lunch_events = events(action.fields.lunch_events);
      }
      if (action.fields.lunch_status !== undefined) {
        e.lunch_status = action.fields.lunch_status;
      }
      return e;
    }
    case "no_action":
      return { action: "no_action", reason: action.reason };
  }
}

/**
 * Rebuild a case's `now` as a local-time Date and verify the wall clock came
 * back as the fixture describes.
 *
 * Both implementations read local wall-clock fields, so a host timezone with a
 * DST transition inside a case's date could renormalise the hour and surface
 * as a phantom divergence. Both suites are pinned to UTC; this is the check
 * that says so out loud if that pin is ever lost.
 */
export function fixtureDate(now: FixtureNow, caseId: string): Date {
  const d = new Date(now.year, now.month - 1, now.day, now.hour, now.minute, 0, 0);
  const wall = `${d.getHours()}:${d.getMinutes()} weekday ${d.getDay()}`;
  const want = `${now.hour}:${now.minute} weekday ${now.weekday}`;
  if (wall !== want) {
    throw new Error(
      `${caseId}: wall clock mismatch — fixture says ${want} but ` +
        `${now.year}-${now.month}-${now.day} resolves to ${wall} in ` +
        `TZ=${process.env.TZ ?? "(host default)"}. Both suites must run under ` +
        `TZ=UTC; see the fixture's "timezone" block.`,
    );
  }
  return d;
}
