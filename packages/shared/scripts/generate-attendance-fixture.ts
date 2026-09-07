/**
 * Builds packages/shared/fixtures/attendance-state-machine.json — the single
 * set of state-machine cases that BOTH the Vitest suite and the PlatformIO
 * suite load.
 *
 *   pnpm gen:attendance-fixture      regenerate; produces a diff to review
 *   pnpm check:attendance-fixture    fail if the committed fixture is stale
 *
 * The committed fixture is the source of truth
 * --------------------------------------------
 * Both harnesses read the committed JSON, never this script. Regeneration is
 * an explicit human action that produces a reviewable diff — it is deliberately
 * NOT wired into either test run, because a fixture regenerated on the fly
 * would make the TypeScript side tautological (it could never fail its own
 * expectations) and would silently re-baseline the recorded C++ divergences the
 * moment somebody edited the spec.
 *
 * Instead the two directions of drift fail separately and loudly:
 *
 *   - Change the TypeScript spec       -> `check:attendance-fixture` goes red
 *                                         and names the cases whose expected
 *                                         values moved.
 *   - Change the C++ port              -> the PlatformIO harness goes red on
 *                                         the case that moved.
 *
 * Neither can be satisfied by editing the other side's code; both force the
 * change through a review of this fixture.
 *
 * Expected values are derived, never transcribed
 * ----------------------------------------------
 * Case *inputs* are declared by hand below. Every expected value is produced by
 * actually calling packages/shared/src/attendance.ts, which is the
 * specification. The hand-written half of the file is only the inputs and the
 * recorded C++ behaviour for the known divergences.
 *
 * Known divergences
 * -----------------
 * Five behaviours differ between the spec and the C++ port (D1, D2, D2a, D3,
 * D4). Which side is correct is an unmade product decision, so this script does
 * NOT pick a winner. Affected cases carry a `divergence` block recording the
 * port's behaviour alongside the spec's. Each harness asserts against its own
 * recorded side and reports KNOWN DIVERGENT, so both behaviours stay pinned:
 * unintended drift still fails, while the five documented gaps stay visible
 * until someone decides. When a decision lands, fix the losing implementation,
 * drop the `divergence` block, and regenerate.
 *
 * Timezone determinism
 * --------------------
 * Both implementations read *local* wall-clock fields (`Date.getHours` /
 * `std::tm.tm_hour`), so the fixture stores wall-clock components rather than
 * instants, and uses the `$now` sentinel instead of literal timestamps — each
 * harness expands it with its own clock conversion, so no string ever has to
 * agree across runtimes. On top of that both suites are pinned to UTC (see the
 * fixture's `timezone` block) to remove DST normalisation as a variable, and
 * both harnesses assert the wall clock they built matches the fixture before
 * asserting anything else.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { TIME_THRESHOLDS } from "@learnlife/pb-client";
import type {
  ArrivalStatus,
  AttendanceRecord,
  AttendanceStatus,
  LunchEvent,
} from "@learnlife/pb-client";
import {
  computeCheckInAction,
  findLearnersToMarkAbsent,
  type AttendanceState,
} from "../src/attendance";
import {
  FIXTURE_PATH,
  NOW_SENTINEL as NOW,
  fixtureDate,
  normalizeAction,
  type AttendanceFixture,
  type FixtureCase,
  type FixtureDivergence,
  type FixtureDivergenceEntry,
  type FixtureNow,
  type FixtureSweepCase,
  type FixtureSweepRecord,
} from "./attendance-fixture";

// ── Case declarations ────────────────────────────────────────────────────────

/** Wall-clock instant for a case. `weekday` is derived and then asserted. */
interface NowSpec {
  year: number;
  month: number; // 1-based, as a human writes it
  day: number;
  hour: number;
  minute: number;
}

interface CaseInput {
  id: string;
  desc: string;
  now: NowSpec;
  state?: Partial<AttendanceState>;
  /** Recorded C++ behaviour, hand-written from the port. See ./attendance-fixture.ts. */
  divergence?: FixtureDivergence;
}

/**
 * Arbitrary fixed timestamps for pre-existing lunch events. Opaque to the state
 * machine, which copies them through untouched, so their timezone is
 * irrelevant and they are safe as literals.
 */
const T_LUNCH_OUT = "2026-04-20T11:05:00.000Z";
const T_LUNCH_IN = "2026-04-20T11:40:00.000Z";
const T_TIME_IN = "2026-04-20T07:55:00.000Z";

const out = (time = T_LUNCH_OUT): LunchEvent => ({ type: "out", time });
const inn = (time = T_LUNCH_IN): LunchEvent => ({ type: "in", time });

// Weekday is load-bearing: FRIDAY_CHECKOUT_HOUR/MINUTE (14:00) replaces
// CHECKOUT_HOUR/MINUTE on Fridays, and the C++ lock window is Friday-exempt.
// Every date below is asserted against Date.getDay() at generation time and
// again in both harnesses.
//   2026-04-20 Monday (1)    2026-04-23 Thursday (4)
//   2026-04-24 Friday (5)    2026-04-25 Saturday (6)   2026-04-26 Sunday (0)
const MON = { year: 2026, month: 4, day: 20 };
const THU = { year: 2026, month: 4, day: 23 };
const FRI = { year: 2026, month: 4, day: 24 };
const SAT = { year: 2026, month: 4, day: 25 };
const SUN = { year: 2026, month: 4, day: 26 };

const mon = (hour: number, minute: number): NowSpec => ({ ...MON, hour, minute });
const thu = (hour: number, minute: number): NowSpec => ({ ...THU, hour, minute });
const fri = (hour: number, minute: number): NowSpec => ({ ...FRI, hour, minute });

/** The C++ Locked action, which the spec has no equivalent for (D3). */
const CPP_LOCKED = { action: "locked", reason: "Scans locked 14:00\u201317:00" };

const CASES: CaseInput[] = [
  // ── Morning check-in, and the 10:00 / 10:01 late boundary ─────────────────
  {
    id: "check_in/present_09_00",
    desc: "First tap well before the late cutoff arrives as present.",
    now: mon(9, 0),
  },
  {
    id: "check_in/present_10_00_last_on_time_minute",
    desc: "10:00 is the last on-time minute — the cutoff is 10:01, not 10:00.",
    now: mon(10, 0),
  },
  {
    id: "check_in/late_10_01_first_late_minute",
    desc: "10:01 exactly is the first late minute.",
    now: mon(10, 1),
  },
  {
    id: "check_in/late_10_02",
    desc: "Past the cutoff stays late.",
    now: mon(10, 2),
  },
  {
    id: "check_in/jabsent_excusal_survives_as_jlate",
    desc:
      "A learner a guide had excused as jAbsent who then shows up keeps the " +
      "excusal: arrival flips to late, status to jLate.",
    now: mon(10, 30),
    state: { status: "jAbsent" },
  },
  {
    id: "check_in/jlate_excusal_survives_as_jlate",
    desc: "Same inheritance from a prior jLate.",
    now: mon(11, 0),
    state: { status: "jLate" },
  },
  {
    id: "check_in/on_time_arrival_drops_excusal",
    desc:
      "Arriving on time cannot be justified — a prior jAbsent collapses to " +
      "plain present, since there is no jPresent.",
    now: mon(9, 15),
    state: { status: "jAbsent" },
  },
  {
    id: "check_in/friday_late_10_01",
    desc: "The late cutoff is weekday-independent — Friday behaves like any other day.",
    now: fri(10, 1),
  },
  {
    id: "check_in/beats_locked_window_14_30",
    desc:
      "Step 1 runs before everything else, so a learner whose first tap of the " +
      "day lands inside the disputed 14:00-17:00 window still checks in. Both " +
      "sides agree: the C++ Locked branch requires has_time_in.",
    now: mon(14, 30),
  },
  {
    id: "check_in/beats_checkout_17_30",
    desc: "Likewise a first tap after checkout time is a check-in, not a checkout.",
    now: mon(17, 30),
  },

  // ── Lunch window, 13:00 - 13:59 ───────────────────────────────────────────
  {
    id: "lunch/before_window_12_59_no_action",
    desc: "12:59 is outside the window; nothing to record.",
    now: mon(12, 59),
    state: { time_in: T_TIME_IN },
  },
  {
    id: "lunch/out_at_13_00_window_opens",
    desc: "13:00 exactly opens the window; the first tap toggles the learner out.",
    now: mon(13, 0),
    state: { time_in: T_TIME_IN },
  },
  {
    id: "lunch/in_at_13_30_writes_present_not_late",
    desc:
      "Returning inside the window sets lunch_status. DEAD BRANCH: the code " +
      "asks `now >= 14:01 ? late : present`, but this block only runs while " +
      "hour < 14, so the late arm is unreachable and the window always writes " +
      "present. Present in BOTH implementations, so it is a shared defect, NOT " +
      "a divergence. This case pins the current behaviour.",
    now: mon(13, 30),
    state: { time_in: T_TIME_IN, lunch_events: [out()] },
  },
  {
    id: "lunch/out_again_at_13_45_toggles",
    desc:
      "The window supports several out/in pairs; a trailing in toggles back to " +
      "out, and an out leg must not set lunch_status.",
    now: mon(13, 45),
    state: { time_in: T_TIME_IN, lunch_events: [out(), inn()] },
  },
  {
    id: "lunch/in_at_13_59_last_window_minute",
    desc:
      "13:59 is the last minute of the window and still writes present — the " +
      "closest the dead late branch ever gets to firing.",
    now: mon(13, 59),
    state: { time_in: T_TIME_IN, lunch_events: [out()] },
  },

  // ── 14:00 — window shuts, late lunch return opens, lock window opens ──────
  {
    id: "lunch/late_return_at_14_00",
    desc:
      "14:00 closes the window and immediately opens late lunch return: " +
      "LUNCH_LATE_HOUR is 14, so the hour check passes at :00 even though the " +
      "minute threshold is :01.",
    now: mon(14, 0),
    state: { time_in: T_TIME_IN, lunch_events: [out()] },
  },
  {
    id: "lunch/late_return_at_14_01",
    desc: "14:01, the nominal late-lunch minute, behaves identically.",
    now: mon(14, 1),
    state: { time_in: T_TIME_IN, lunch_events: [out()] },
  },
  {
    id: "lunch/late_return_via_legacy_columns_15_00",
    desc:
      "Pre-lunch_events rows are still honoured: lunch_out set with lunch_in " +
      "null means mid-lunch, and the synthetic return is appended to an empty " +
      "events array.",
    now: mon(15, 0),
    state: { time_in: T_TIME_IN, lunch_out: T_LUNCH_OUT },
  },
  {
    id: "lunch/late_return_beats_lock_16_00",
    desc:
      "An open lunch still resolves inside the C++ lock window — the device " +
      "processes mid-lunch returns before it locks. Both sides agree.",
    now: mon(16, 0),
    state: { time_in: T_TIME_IN, lunch_events: [out()] },
  },
  {
    id: "lunch/no_open_lunch_at_14_00",
    desc:
      "14:00 with nothing open. The spec has no more work to do; the device " +
      "rejects the tap outright.",
    now: mon(14, 0),
    state: { time_in: T_TIME_IN },
    divergence: {
      refs: ["D3"],
      note:
        "First minute of the C++-only 14:00-17:00 lock window. Spec: " +
        "no_action. Device: Locked.",
      cpp: CPP_LOCKED,
    },
  },
  {
    id: "lunch/legacy_lunch_already_closed_15_00",
    desc:
      "Legacy lunch_out AND lunch_in both set means lunch is finished, so there " +
      "is no late return to synthesise.",
    now: mon(15, 0),
    state: { time_in: T_TIME_IN, lunch_out: T_LUNCH_OUT, lunch_in: T_LUNCH_IN },
    divergence: {
      refs: ["D3"],
      note: "Inside the C++-only lock window. Spec: no_action. Device: Locked.",
      cpp: CPP_LOCKED,
    },
  },
  {
    id: "lunch/closed_events_mid_afternoon_16_00",
    desc: "Matched out/in pair, mid-afternoon: nothing outstanding.",
    now: mon(16, 0),
    state: { time_in: T_TIME_IN, lunch_events: [out(), inn()] },
    divergence: {
      refs: ["D3"],
      note: "Inside the C++-only lock window. Spec: no_action. Device: Locked.",
      cpp: CPP_LOCKED,
    },
  },

  // ── Non-Friday checkout, and the 16:59 / 17:00 boundary ───────────────────
  {
    id: "checkout/16_58_too_early",
    desc: "One minute before the spec's cutoff. Neither side checks out.",
    now: mon(16, 58),
    state: { time_in: T_TIME_IN },
    divergence: {
      refs: ["D3"],
      note:
        "Both agree there is no checkout, but disagree on the fallback: spec " +
        "no_action, device Locked (16:58 < LOCKED_END_HOUR 17).",
      cpp: CPP_LOCKED,
    },
  },
  {
    id: "checkout/16_59_spec_cutoff",
    desc:
      "THE cutoff disagreement. TIME_THRESHOLDS puts the cutoff at 16:59, so " +
      "the spec checks the learner out. The device's constants say 17:00, so " +
      "16:59 is still inside its lock window and the tap is refused — a learner " +
      "leaving at 16:59 is checked out on the dashboard and rejected by the " +
      "reader.",
    now: mon(16, 59),
    state: { time_in: T_TIME_IN },
    divergence: {
      refs: ["D1", "D3"],
      note:
        "Spec cutoff 16:59 vs device cutoff 17:00 (D1). The device's fallback " +
        "in that minute is Locked (D3), so the observable difference is " +
        "check_out vs locked.",
      cpp: CPP_LOCKED,
    },
  },
  {
    id: "checkout/17_00_both_agree",
    desc:
      "At 17:00 both cutoffs have passed, so both sides check out. With no open " +
      "lunch, neither writes lunch fields — the negative half of D2a.",
    now: mon(17, 0),
    state: { time_in: T_TIME_IN },
  },
  {
    id: "checkout/thursday_17_00",
    desc:
      "A second non-Friday weekday, to prove the 17:00 checkout is not " +
      "accidentally keyed to Monday.",
    now: thu(17, 0),
    state: { time_in: T_TIME_IN },
  },
  {
    id: "checkout/17_30_after_cutoff",
    desc: "Well past either cutoff.",
    now: mon(17, 30),
    state: { time_in: T_TIME_IN },
  },
  {
    id: "checkout/no_double_checkout_17_30",
    desc: "time_out already recorded — checkout must not fire twice.",
    now: mon(17, 30),
    state: { time_in: T_TIME_IN, time_out: "2026-04-20T15:10:00.000Z" },
  },
  {
    id: "checkout/open_lunch_17_00_ordering",
    desc:
      "THE ordering disagreement. A learner who never came back from lunch taps " +
      "at checkout time. The spec evaluates checkout BEFORE late lunch return " +
      "and emits one combined write. The device evaluates late lunch return " +
      "first, so it only closes the lunch and never records time_out — the " +
      "learner stays checked in overnight.",
    now: mon(17, 0),
    state: { time_in: T_TIME_IN, lunch_events: [out()] },
    divergence: {
      refs: ["D2", "D2a"],
      note:
        "D2: the device returns LateLunchReturn where the spec returns " +
        "check_out, so no time_out is ever written. D2a rides along: even if " +
        "the order were swapped, the device's CheckOut branch sets only " +
        "time_out_iso, so the lunch close would be dropped instead.",
      cpp: {
        action: "late_lunch_return",
        lunch_events: [
          { type: "out", time: T_LUNCH_OUT },
          { type: "in", time: NOW },
        ],
        lunch_status: "late",
      },
    },
  },
  {
    id: "checkout/open_lunch_18_00_lunch_close_lost",
    desc:
      "THE data-loss case. Same shape as the ordering case but framed on what " +
      "is LOST rather than on which branch wins: the spec's single write closes " +
      "the lunch and marks it late, and the device produces no equivalent write " +
      "at any point in the day. The lunch is closed on the dashboard and NEVER " +
      "on the device, so the device's copy of the record keeps a dangling out " +
      "event forever. Reordering the C++ steps alone does not fix this — see " +
      "D2a.",
    now: mon(18, 0),
    state: { time_in: T_TIME_IN, lunch_events: [out(), inn(), out()] },
    divergence: {
      refs: ["D2a", "D2"],
      note:
        "D2a: the C++ CheckOut branch populates only time_out_iso — it never " +
        "sets lunch_events_after or lunch_status, so the combined close the " +
        "spec performs has no counterpart in the port. Masked today by D2 " +
        "(LateLunchReturn wins first), which is why the recorded cpp action is " +
        "late_lunch_return; fixing D2 in isolation would convert this from a " +
        "wrong-action bug into a silent field-loss bug.",
      cpp: {
        action: "late_lunch_return",
        lunch_events: [
          { type: "out", time: T_LUNCH_OUT },
          { type: "in", time: T_LUNCH_IN },
          { type: "out", time: T_LUNCH_OUT },
          { type: "in", time: NOW },
        ],
        lunch_status: "late",
      },
    },
  },
  {
    id: "checkout/open_lunch_via_legacy_columns_17_00",
    desc: "Same pair of defects reached through the legacy lunch columns.",
    now: mon(17, 0),
    state: { time_in: T_TIME_IN, lunch_out: T_LUNCH_OUT },
    divergence: {
      refs: ["D2", "D2a"],
      note:
        "Spec: check_out plus a synthetic lunch close. Device: LateLunchReturn " +
        "only, no time_out, and its CheckOut branch could not have written the " +
        "lunch fields anyway (D2a).",
      cpp: {
        action: "late_lunch_return",
        lunch_events: [{ type: "in", time: NOW }],
        lunch_status: "late",
      },
    },
  },

  // ── Friday, which checks out at 14:00 ─────────────────────────────────────
  {
    id: "friday/lunch_window_13_00_beats_checkout",
    desc: "Friday's early checkout does not swallow the lunch window at its start.",
    now: fri(13, 0),
    state: { time_in: T_TIME_IN },
  },
  {
    id: "friday/lunch_window_13_59_beats_checkout",
    desc: "…nor at its last minute. Still a lunch toggle on both sides.",
    now: fri(13, 59),
    state: { time_in: T_TIME_IN },
  },
  {
    id: "friday/checkout_at_14_00",
    desc:
      "Friday checks out at 14:00 rather than 16:59/17:00. Both sides agree " +
      "when no lunch is open: the device's late-lunch step falls through and " +
      "its lock window is Friday-exempt.",
    now: fri(14, 0),
    state: { time_in: T_TIME_IN },
  },
  {
    id: "friday/checkout_at_15_00",
    desc:
      "Later on a Friday afternoon, still a checkout — and notably NOT locked, " +
      "which is where Friday and the other weekdays part company.",
    now: fri(15, 0),
    state: { time_in: T_TIME_IN },
  },
  {
    id: "friday/no_double_checkout_15_00",
    desc:
      "Friday, already checked out. Confirms the device's lock window really is " +
      "Friday-exempt: it falls through to NoAction rather than Locked. Compare " +
      "checkout/16_58_too_early, the same shape on a Monday, which diverges.",
    now: fri(15, 0),
    state: { time_in: T_TIME_IN, time_out: "2026-04-24T12:10:00.000Z" },
  },
  {
    id: "friday/thursday_15_00_is_not_a_checkout",
    desc:
      "The far side of the Friday boundary: at 15:00 on Thursday the early " +
      "checkout does not apply, so the spec has nothing to do.",
    now: thu(15, 0),
    state: { time_in: T_TIME_IN },
    divergence: {
      refs: ["D3"],
      note:
        "Inside the C++-only lock window, which applies on Thursday but not " +
        "Friday. Spec: no_action. Device: Locked.",
      cpp: CPP_LOCKED,
    },
  },
  {
    id: "friday/open_lunch_at_checkout_14_00",
    desc:
      "The ordering and data-loss pair on a Friday, where they bite three hours " +
      "earlier than on other days.",
    now: fri(14, 0),
    state: { time_in: T_TIME_IN, lunch_events: [out()] },
    divergence: {
      refs: ["D2", "D2a"],
      note:
        "Spec: check_out with the lunch closed as late in the same write. " +
        "Device: LateLunchReturn only, no time_out.",
      cpp: {
        action: "late_lunch_return",
        lunch_events: [
          { type: "out", time: T_LUNCH_OUT },
          { type: "in", time: NOW },
        ],
        lunch_status: "late",
      },
    },
  },
];

// ── Absence sweep cases (findLearnersToMarkAbsent) ───────────────────────────

/**
 * `FixtureSweepRecord` carries only the fields findLearnersToMarkAbsent
 * actually reads; the harness pads the rest of AttendanceRecord with nulls.
 * Keeping the fixture to the read set means an unrelated schema addition does
 * not churn it.
 */
interface SweepCaseInput {
  id: string;
  desc: string;
  now: NowSpec;
  learners: string[];
  records: FixtureSweepRecord[];
}

const SWEEP_CASES: SweepCaseInput[] = [
  {
    id: "sweep/before_cutoff_10_29",
    desc: "One minute before the 10:30 cutoff the sweep does nothing at all.",
    now: { ...MON, hour: 10, minute: 29 },
    learners: ["lnr_a", "lnr_b"],
    records: [],
  },
  {
    id: "sweep/at_cutoff_10_30",
    desc:
      "10:30 exactly is the first sweeping minute; every learner without a " +
      "record is a candidate.",
    now: { ...MON, hour: 10, minute: 30 },
    learners: ["lnr_a", "lnr_b"],
    records: [],
  },
  {
    id: "sweep/skips_learner_with_time_in",
    desc: "A learner who tapped in is never swept, however late they were.",
    now: { ...MON, hour: 11, minute: 0 },
    learners: ["lnr_a", "lnr_b"],
    records: [{ learner: "lnr_a", time_in: T_TIME_IN, arrival: "late" }],
  },
  {
    id: "sweep/skips_learner_with_arrival_already_set",
    desc:
      "Idempotence: an arrival a guide already recorded is never overwritten, " +
      "even with no time_in. This is what stops a repeating sweep timer from " +
      "clobbering manual calls.",
    now: { ...MON, hour: 11, minute: 0 },
    learners: ["lnr_a", "lnr_b"],
    records: [{ learner: "lnr_a", arrival: "absent" }],
  },
  {
    id: "sweep/skips_learner_with_legacy_status_only",
    desc:
      "Pre-migration rows carry status but no arrival; treat that as already " +
      "handled rather than re-marking.",
    now: { ...MON, hour: 11, minute: 0 },
    learners: ["lnr_a", "lnr_b"],
    records: [{ learner: "lnr_a", status: "jAbsent" }],
  },
  {
    id: "sweep/marks_blank_record",
    desc: "A row that exists but is entirely blank is still a candidate.",
    now: { ...MON, hour: 12, minute: 0 },
    learners: ["lnr_a"],
    records: [{ learner: "lnr_a" }],
  },
  {
    id: "sweep/skips_saturday",
    desc: "No school on Saturday.",
    now: { ...SAT, hour: 12, minute: 0 },
    learners: ["lnr_a", "lnr_b"],
    records: [],
  },
  {
    id: "sweep/skips_sunday",
    desc: "No school on Sunday.",
    now: { ...SUN, hour: 12, minute: 0 },
    learners: ["lnr_a", "lnr_b"],
    records: [],
  },
  {
    id: "sweep/friday_is_a_school_day",
    desc: "Friday's early checkout does not make it a non-school day.",
    now: { ...FRI, hour: 12, minute: 0 },
    learners: ["lnr_a"],
    records: [],
  },
];

// ── Derivation ───────────────────────────────────────────────────────────────

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

/**
 * Derive a case's expectation by actually running the specification, then
 * flatten it with the shared normaliser the Vitest harness also uses.
 */
function expectationFor(state: AttendanceState, now: Date) {
  return normalizeAction(computeCheckInAction(state, now), now.toISOString());
}

/**
 * Expand a fixture record into a full AttendanceRecord.
 * findLearnersToMarkAbsent reads only learner/time_in/arrival/status; the
 * PocketBase envelope fields are filled with inert placeholders so the fixture
 * does not have to carry them.
 */
function fullRecord(r: FixtureSweepRecord, index: number, date: string): AttendanceRecord {
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

// ── Divergence registry ──────────────────────────────────────────────────────

const DIVERGENCES: Record<string, FixtureDivergenceEntry> = {
  D1: {
    title: "Non-Friday check-out time",
    ts: "16:59 — TIME_THRESHOLDS.CHECKOUT_HOUR=16, CHECKOUT_MINUTE=59 (packages/pb-client/src/constants.ts:28-29)",
    cpp: "17:00 — CHECKOUT_HOUR=17, CHECKOUT_MINUTE=0 (apps/nfc-attender-fw/src/state_machine.cpp:21-22)",
    impact:
      "For the whole of 16:59 the dashboard checks a learner out while the " +
      "reader refuses the tap.",
    observable_today: true,
    decision: "UNDECIDED",
  },
  D2: {
    title: "Check-out is evaluated before late-lunch-return, or after",
    ts: "check-out first (packages/shared/src/attendance.ts:218), so a learner still at lunch gets one combined write",
    cpp: "late-lunch-return first (apps/nfc-attender-fw/src/state_machine.cpp:129), so the same tap only closes the lunch",
    impact:
      "A learner who never returned from lunch is checked out by the dashboard " +
      "but left checked in by the device — no time_out is ever recorded on the " +
      "device path.",
    observable_today: true,
    decision: "UNDECIDED",
  },
  D2a: {
    title: "The C++ CheckOut branch never writes the lunch fields",
    ts: "check_out closes an open lunch in the same write, setting lunch_events plus lunch_status='late' (packages/shared/src/attendance.ts:229-236)",
    cpp: "CheckOut populates time_out_iso only — lunch_events_after is left empty and set_lunch_status stays false (apps/nfc-attender-fw/src/state_machine.cpp:160-163)",
    impact:
      "Silent data loss on the device path, distinct from the ordering question " +
      "in D2. A learner who checks out with an open lunch has that lunch closed " +
      "and marked late on the dashboard and NEVER on the device, which keeps a " +
      "dangling out event. Because the device has no other route to that write, " +
      "the record can never converge.",
    observable_today: false,
    masked_by: "D2",
    masking_note:
      "No input can separate D2a from D2 today: the C++ late-lunch-return step " +
      "catches every at-lunch state from 14:00 onward, and both check-out " +
      "cutoffs are at or after 14:00, so the C++ CheckOut branch is never " +
      "reached with an open lunch. Fixing D2 by reordering alone would unmask " +
      "D2a and turn a wrong-action bug into a silent field-loss bug. The C++ " +
      "harness therefore asserts the mask directly — see the D2a guard in " +
      "test_state_machine.cpp.",
    decision: "UNDECIDED",
  },
  D3: {
    title: "The 14:00-17:00 no-scan window",
    ts: "no equivalent — falls through to no_action (packages/shared/src/attendance.ts:260)",
    cpp: "ActionType::Locked rejects taps from an already-checked-in learner between 14:00 and LOCKED_END_HOUR=17 on non-Fridays (apps/nfc-attender-fw/src/state_machine.cpp:169-175)",
    impact:
      "Every stray afternoon tap is a silent no-op on one side and a visible " +
      "rejection on the other.",
    observable_today: true,
    decision: "UNDECIDED",
  },
  D4: {
    title: "findLearnersToMarkAbsent was never ported",
    ts: "implemented (packages/shared/src/attendance.ts:288)",
    cpp: "absent — no auto-absent sweep exists in the firmware at all",
    impact:
      "The device can never mark anyone absent. The absence_sweep cases below " +
      "run against the spec only; the C++ harness reports them as unported.",
    observable_today: false,
    decision: "UNDECIDED",
  },
};

/**
 * Derive the weekday for a declared wall clock, then hand the completed spec
 * to the same validator both harnesses use — so a DST-shifted hour or a
 * mis-stated weekday fails at generation time rather than becoming a baked-in
 * lie.
 */
function resolveNow(spec: NowSpec, caseId: string): { now: FixtureNow; date: Date } {
  const probe = new Date(spec.year, spec.month - 1, spec.day, spec.hour, spec.minute, 0, 0);
  const now: FixtureNow = { ...spec, weekday: probe.getDay() };
  return { now, date: fixtureDate(now, caseId) };
}

// ── Build ────────────────────────────────────────────────────────────────────

function buildFixture(): AttendanceFixture {
  const cases: FixtureCase[] = CASES.map((c) => {
    const { now, date } = resolveNow(c.now, c.id);
    const state = blankState(c.state);
    for (const ref of c.divergence?.refs ?? []) {
      if (!(ref in DIVERGENCES)) throw new Error(`${c.id}: unknown divergence ref ${ref}`);
    }
    return {
      id: c.id,
      desc: c.desc,
      now,
      state,
      expect: expectationFor(state, date),
      ...(c.divergence ? { divergence: c.divergence } : {}),
    };
  });

  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
    ids.add(c.id);
  }

  const sweepCases: FixtureSweepCase[] = SWEEP_CASES.map((c) => {
    const { now, date } = resolveNow(c.now, c.id);
    const dateStr =
      `${c.now.year}-${String(c.now.month).padStart(2, "0")}-` +
      String(c.now.day).padStart(2, "0");
    const records = c.records.map((r, i) => fullRecord(r, i, dateStr));
    return {
      id: c.id,
      desc: c.desc,
      now,
      learners: c.learners,
      records: c.records,
      expect: findLearnersToMarkAbsent(
        records,
        c.learners.map((id) => ({ id })),
        date,
      ),
    };
  });

  return {
    $comment:
      "GENERATED FILE — do not hand-edit. This committed JSON is the source of " +
      "truth for both test suites; the generator is not run by either of them. " +
      "Regenerate deliberately with `pnpm gen:attendance-fixture` and commit the " +
      "diff. `pnpm check:attendance-fixture` fails when this file is stale.",
    schema_version: 1,
    generator: "packages/shared/scripts/generate-attendance-fixture.ts",
    spec: "packages/shared/src/attendance.ts",
    harnesses: [
      "apps/nfc-attender/src/__tests__/attendance-fixture.test.ts (Vitest)",
      "apps/nfc-attender-fw/test/test_state_machine/test_state_machine.cpp (PlatformIO, native env)",
    ],
    implementations: [
      "packages/shared/src/attendance.ts — the specification",
      "apps/nfc-attender-fw/src/state_machine.cpp — C++ port for the ESP32 reader",
      "packages/pb-client/src/queries/attendance.ts — duplicated deriveStatus",
      "packages/pb-client/scripts/backfill-arrival.ts — duplicated splitStatus",
    ],
    timezone: {
      policy: "UTC",
      why:
        "Both implementations read local wall-clock fields (Date.getHours, " +
        "std::tm.tm_hour), so a host timezone with a DST transition inside a " +
        "case's date could renormalise the hour and surface as a phantom " +
        "divergence. Pinning both suites to UTC removes DST entirely.",
      ts: "TZ=UTC is set in apps/nfc-attender/package.json's test script, matching the existing convention in apps/ll-calendar.",
      cpp: "The native harness calls setenv(\"TZ\",\"UTC\",1)+tzset() in main before any mktime, so it holds however the binary is invoked.",
      belt_and_braces:
        "Both harnesses re-read hour/minute/weekday back off the clock they " +
        "built and fail with an explicit message if it does not match this " +
        "fixture, rather than asserting on a shifted time.",
    },
    conventions: {
      now: "Local wall clock. `month` is 1-based; `weekday` is Sun=0..Sat=6 and is asserted, not trusted.",
      $now: "Sentinel for the ISO-8601 rendering of this case's `now`. Each harness expands it locally, so no timestamp string has to agree across runtimes.",
      expect:
        "The specification's behaviour, derived by calling it. `action` names the outcome; every other key is a field that implementation must set. A key that is ABSENT must not be set — that negative is what pins D2a.",
      divergence:
        "Present only where the C++ port disagrees. `cpp` records the port's behaviour today in the same shape as `expect`. Each harness asserts against its own recorded side and reports KNOWN DIVERGENT, so both behaviours stay pinned while the product decision is outstanding. Unmarked cases must genuinely pass on both sides.",
    },
    thresholds: TIME_THRESHOLDS,
    known_shared_defects: [
      {
        id: "DEAD_LUNCH_LATE_BRANCH",
        note:
          "Inside the lunch window lunch_status is computed as " +
          "`now >= 14:01 ? late : present`, but that branch only runs while " +
          "hour < 14, so the late arm is unreachable and the window always " +
          "writes present. Present in BOTH implementations, therefore NOT a " +
          "divergence and not marked as one. Pinned by " +
          "lunch/in_at_13_30_writes_present_not_late and " +
          "lunch/in_at_13_59_last_window_minute.",
      },
    ],
    divergences: DIVERGENCES,
    cases,
    absence_sweep: {
      divergence: "D4",
      note:
        "findLearnersToMarkAbsent has no C++ counterpart. The Vitest harness " +
        "runs these against the spec; the PlatformIO harness reports them as " +
        "unported.",
      cases: sweepCases,
    },
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

const TARGET = FIXTURE_PATH;
const REPO_ROOT = resolve(TARGET, "../../../..");

function render(): string {
  return `${JSON.stringify(buildFixture(), null, 2)}\n`;
}

/** Case-level diff so a stale fixture names exactly what moved. */
function reportDrift(committedRaw: string, freshRaw: string): void {
  const rel = relative(REPO_ROOT, TARGET);
  console.error(`\n${rel} is STALE — the TypeScript spec no longer produces it.\n`);

  let committed: AttendanceFixture;
  try {
    committed = JSON.parse(committedRaw) as AttendanceFixture;
  } catch {
    console.error("  the committed fixture is not valid JSON; regenerate it.\n");
    return;
  }
  const fresh = JSON.parse(freshRaw) as AttendanceFixture;

  const byId = (list: { id: string }[]): Record<string, string> => {
    const table: Record<string, string> = {};
    for (const c of list) table[c.id] = JSON.stringify(c);
    return table;
  };
  let named = 0;

  const sections: [string, { id: string }[], { id: string }[]][] = [
    ["case", committed.cases ?? [], fresh.cases],
    ["absence-sweep case", committed.absence_sweep?.cases ?? [], fresh.absence_sweep.cases],
  ];

  for (const [label, oldList, newList] of sections) {
    const before = byId(oldList);
    const after = byId(newList);
    for (const [id, next] of Object.entries(after)) {
      const prev = before[id];
      if (prev === undefined) {
        console.error(`  + ${label} added: ${id}`);
        named++;
      } else if (prev !== next) {
        console.error(`  ~ ${label} changed: ${id}`);
        console.error(`      committed: ${prev}`);
        console.error(`      spec now:  ${next}`);
        named++;
      }
    }
    for (const id of Object.keys(before)) {
      if (!(id in after)) {
        console.error(`  - ${label} removed: ${id}`);
        named++;
      }
    }
  }

  if (named === 0) {
    console.error(
      "  no case-level differences — metadata (thresholds, notes, registry) moved.",
    );
  }
  console.error(
    "\n  Attendance behaviour must not change silently. If the change is " +
      "intended,\n  run `pnpm gen:attendance-fixture` and commit the diff, then " +
      "re-check the\n  recorded C++ divergences — they may no longer describe " +
      "reality.\n",
  );
}

const mode = process.argv.includes("--check") ? "check" : "write";
const fresh = render();

if (mode === "check") {
  let committedRaw: string;
  try {
    committedRaw = readFileSync(TARGET, "utf8");
  } catch {
    console.error(
      `${relative(REPO_ROOT, TARGET)} is MISSING — run \`pnpm gen:attendance-fixture\`.`,
    );
    process.exit(1);
  }
  if (committedRaw !== fresh) {
    reportDrift(committedRaw, fresh);
    process.exit(1);
  }
  const parsed = JSON.parse(fresh) as AttendanceFixture;
  console.log(
    `${relative(REPO_ROOT, TARGET)} is up to date ` +
      `(${parsed.cases.length} cases, ${parsed.absence_sweep.cases.length} sweep cases).`,
  );
} else {
  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, fresh);
  const parsed = JSON.parse(fresh) as AttendanceFixture;
  const divergent = parsed.cases.filter((c) => c.divergence).length;
  console.log(
    `wrote ${relative(REPO_ROOT, TARGET)}\n` +
      `  ${parsed.cases.length} state-machine cases (${divergent} divergent)\n` +
      `  ${parsed.absence_sweep.cases.length} absence-sweep cases`,
  );
}
