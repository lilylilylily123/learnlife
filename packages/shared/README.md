> [!IMPORTANT]
> **`attendance.ts` is the specification for the product's core rule, and it is one of three copies of that rule.**
> See [Three implementations, no parity check](#three-implementations-no-parity-check) before changing anything in this file.

# `@learnlife/shared`

Pure domain logic for LearnLife. No network, no PocketBase SDK, no React, no
`console`, no `setTimeout` — every function here takes plain data plus (where
time matters) an explicit `now: Date`, and returns plain data.

That constraint is the whole point of the package. The attendance rule has to
run in three very different places: a Next.js/Tauri dashboard, an Expo app on
iOS/Android/web, and (as a hand-written C++ port) on an ESP32 with no
filesystem worth testing against. Anything that reached for a host global or a
network client would be untestable in at least one of them. Keeping this layer
pure is what makes `attendance.ts` verifiable at a desk instead of at a wall
socket with an NFC card.

The purity is enforced mechanically, not by convention:
`packages/shared/tsconfig.json` inherits `lib: ["esnext"]` from
`tsconfig.base.json` and does **not** add `dom`. `console` and `setTimeout` are
therefore not declared, so reaching for them is a typecheck error. The sibling
`packages/pb-client` deliberately *does* add `"dom"` for exactly this reason,
and its tsconfig carries a comment telling you not to move that up into the
base config.

| Field | Value |
|---|---|
| Package name | `@learnlife/shared` |
| Entry point | `src/index.ts` (source, not built — consumers bundle the TS directly) |
| Runtime deps | `@learnlife/pb-client` (types + `TIME_THRESHOLDS` only) |
| Own test script | **none** — see [How this package is checked](#how-this-package-is-checked) |

## Layout

| File | Contents |
|---|---|
| `src/attendance.ts` | Attendance state machine, status model, auto-absent sweep, reporting aggregation |
| `src/calendar.ts` | `expandEvents` — recurrence expansion into a date-keyed month map |
| `src/date-utils.ts` | PocketBase date parsing, date-key formats, weekday counting |
| `src/roles.ts` | The three-role model (`learner` / `lg` / `admin`) |
| `src/rsvp.ts` | RSVP capacity/waitlist state machine |
| `src/index.ts` | The public surface. Nothing outside this file is a supported import path. |

## Install / run

Nothing to build. Consumers reference the workspace package and their bundler
reads `src/index.ts` directly:

```jsonc
// apps/*/package.json
"@learnlife/shared": "workspace:*"
```

The only command this package has, run from the repo root:

```bash
pnpm --filter @learnlife/shared typecheck   # tsc --noEmit
```

---

# The attendance rule

This section is intended to be sufficient on its own. A reader should be able
to learn the complete rule set here without opening `attendance.ts`.

## Three implementations, no parity check

The rule exists three times in this repository. Nothing in CI compares them.

| # | Location | Language | Its own tests |
|---|---|---|---|
| 1 | `packages/shared/src/attendance.ts` — `deriveStatus`, `computeCheckInAction` | TypeScript | `apps/nfc-attender/src/__tests__/attendance-state-machine.test.ts` (vitest) |
| 2 | `packages/pb-client/src/queries/attendance.ts` — a private `deriveStatus` copy | TypeScript | exercised only indirectly, via `batchUpdateAttendance` / `justifyAttendance` cases in `apps/nfc-attender/src/__tests__/pb-client-shared.test.ts` |
| 3 | `apps/nfc-attender-fw/src/state_machine.cpp` — `derive_status`, `compute_check_in_action` | C++ | `apps/nfc-attender-fw/test/test_state_machine/` (PlatformIO native) |

Copy 2 exists because `pb-client` cannot import `shared` at runtime: `shared`
imports `TIME_THRESHOLDS` from `pb-client`, so the reverse edge would close a
workspace dependency cycle. Both copies carry a `MUST STAY IN SYNC` banner.
There is **no test that imports both and asserts they agree**, and there is no
shared fixture file anywhere in the repo that both the vitest suite and the
PlatformIO suite consume. The two suites are independently hand-written.

**They have already drifted.** Verified differences between copy 1 (this
package) and copy 3 (the firmware) as of this writing:

| Behaviour | `packages/shared` (TS) | `nfc-attender-fw` (C++) |
|---|---|---|
| Non-Friday check-out opens at | **16:59** (`CHECKOUT_HOUR: 16`, `CHECKOUT_MINUTE: 59`) | **17:00** (`CHECKOUT_HOUR = 17`, `CHECKOUT_MINUTE = 0`) |
| Evaluation order | check-out is tested **before** late-lunch-return | late-lunch-return is tested **before** check-out |
| Tap after check-out time while still out for lunch | one combined write: lunch closed as `late` **and** `time_out` set | `LateLunchReturn` only — `time_out` is never set by that tap |
| 14:00–17:00 on a non-Friday, already checked in, not at lunch | `no_action` (silent no-op) | `Locked` action — the tap is rejected with "Scans locked 14:00–17:00" |
| Auto-absent sweep | `findLearnersToMarkAbsent` lives here | not ported; the device does not sweep |

The firmware's inline `attendance.ts:NNN` line citations are also stale — they
point at the pre-aggregation layout of this file.

There is **no locked / no-scan window in the TypeScript rule.** It is a
firmware-only concept, added because a physical terminal in a hallway gets
idle-curiosity taps that a dashboard operator does not. If you read about a
locked window elsewhere and expect `computeCheckInAction` to return it, it will
not.

## The status model: `arrival` + `justified`, plus a legacy enum

Attendance carries the same information twice, on purpose.

**The split model (source of truth).** Two independent columns:

| Column | Values | Meaning |
|---|---|---|
| `arrival` | `"present"` \| `"late"` \| `"absent"` \| `null` | The *fact*: did the learner show up, and when. `null` = nothing recorded yet. |
| `justified` | `boolean` | Whether a guide has accepted a reason for a late or absent arrival. |

The split exists so that excusing a day does not destroy the underlying fact.
Before the split there was a single enum, and marking a learner excused
overwrote `late` with `jLate`; the "was this learner actually late?" question
became unanswerable. `present + justified` is meaningless — you cannot justify
being on time — so callers should only set `justified: true` when `arrival` is
`"late"` or `"absent"`.

**The legacy enum (`status`).** One column, five values, kept in sync by every
writer so that pre-split PocketBase queries and reports keep working during
the migration window:

`deriveStatus(arrival, justified) → status`

| `arrival` | `justified` | → `status` |
|---|---|---|
| `null` | either | `null` |
| `"present"` | **either** | `"present"` |
| `"late"` | `false` | `"late"` |
| `"late"` | `true` | `"jLate"` |
| `"absent"` | `false` | `"absent"` |
| `"absent"` | `true` | `"jAbsent"` |

`splitStatus(status) → { arrival, justified }` is the inverse, and is total —
any unrecognised or `null` input yields `{ arrival: null, justified: false }`.
Round-tripping is lossless in one direction only: `deriveStatus(splitStatus(s))
=== s` for all five enum values, but `splitStatus(deriveStatus(a, j))` loses
`justified: true` when `a === "present"`, because there is no `jPresent`.

```ts
deriveStatus(arrival: ArrivalStatus | null, justified: boolean): AttendanceStatus | null
splitStatus(status: AttendanceStatus | null): { arrival: ArrivalStatus | null; justified: boolean }
```

`splitStatus` is also used as a read-side fallback: aggregation code that finds
`arrival === null` but `status` set treats the legacy column as authoritative
for that row, so records never touched since the migration still count.

## Time thresholds

Every threshold is a named constant in `packages/pb-client/src/constants.ts`
(`TIME_THRESHOLDS`), imported here. **All comparisons use the host machine's
local time** via `Date.prototype.getHours()` / `getMinutes()`, not UTC. On the
dashboard that is the operator's laptop clock; on the firmware it is NTP time
with a configured offset.

| Constant | Value | Governs |
|---|---|---|
| `LATE_HOUR` / `LATE_MINUTE` | `10` / `1` | Present/late boundary. First tap at **≥ 10:01:00.000** local → `arrival: "late"`; anything earlier, including 10:00:59, → `"present"`. |
| `LUNCH_START_HOUR` | `13` | Lunch window opens (inclusive). |
| `LUNCH_END_HOUR` | `14` | Lunch window closes (**exclusive** — the window is 13:00:00–13:59:59.999). |
| `LUNCH_LATE_HOUR` / `LUNCH_LATE_MINUTE` | `14` / `1` | Nominally the "returned from lunch late" boundary. See the dead-branch note below. `LUNCH_LATE_HOUR` alone (14) is also the floor for the late-lunch-return step. |
| `CHECKOUT_HOUR` / `CHECKOUT_MINUTE` | `16` / `59` | Non-Friday check-out opens at 16:59, with no upper bound. |
| `FRIDAY_CHECKOUT_HOUR` / `FRIDAY_CHECKOUT_MINUTE` | `14` / `0` | Friday check-out opens at 14:00. Fridays are short days. |
| `ABSENT_HOUR` / `ABSENT_MINUTE` | `10` / `30` | Auto-absent sweep cutoff — 29 minutes of grace past the late boundary before the dashboard writes anyone off. |

> [!WARNING]
> **`lunch_status` can never be set to `"late"` from inside the lunch window.**
> Step 2 only runs when `hour < LUNCH_END_HOUR` (14), and the "late return"
> comparison inside it is `now >= 14:01`. Those two conditions are mutually
> exclusive, so the branch that would write `lunch_status: "late"` there is
> unreachable and the lunch window always writes `"present"`. A `"late"`
> lunch status can only come from the `late_lunch_return` action or from
> check-out closing an open lunch — both of which hard-code `"late"`. The C++
> port reproduces the same dead branch. This is described here as observed
> behaviour, not endorsed; whether 14:01 was meant to be compared against
> `LUNCH_END_HOUR` instead is not recoverable from the repo.

## `computeCheckInAction(state, now)`

```ts
computeCheckInAction(state: AttendanceState, now: Date): CheckInAction
```

Pure. Given today's record for one learner and the current time, returns the
action to take and the exact PocketBase fields to write. **It performs no
writes** — the caller persists `action.fields`.

`AttendanceState` is the input snapshot. It contains only what the decision
needs, which is worth noting for a reason that bites later:

```ts
interface AttendanceState {
  time_in: string | null;
  time_out: string | null;
  lunch_events: LunchEvent[] | null;   // [{ type: "out" | "in", time: ISO }, …]
  lunch_out: string | null;            // legacy, pre-lunch_events
  lunch_in: string | null;             // legacy, pre-lunch_events
  status: AttendanceStatus | null;     // the legacy enum
  lunch_status: AttendanceStatus | null;
}
```

There is **no `arrival` and no `justified` field on the input.** The state
machine reads prior justification out of the legacy `status` enum, and can
never write `justified`. That is the mechanism behind the trap at the end of
this section.

### Decision table

Conditions are evaluated strictly top to bottom; the first match returns.

| # | Condition | Action | Fields written |
|---|---|---|---|
| 1 | `!state.time_in` | `check_in` | `time_in`, `arrival`, `status` |
| 2 | `13 <= hour < 14` | `lunch_event` | `lunch_events`, plus `lunch_status` if this tap is a return |
| 3 | at/after check-out time **and** `!state.time_out` | `check_out` | `time_out`, plus `lunch_events` + `lunch_status: "late"` if mid-lunch |
| 4 | `hour >= 14` **and** currently at lunch | `late_lunch_return` | `lunch_events`, `lunch_status: "late"` |
| 5 | otherwise | `no_action` | none — `{ reason: "All check-ins complete for today" }` |

"Check-out time" in row 3 is 14:00 on Friday (`now.getDay() === 5`), 16:59
otherwise. Row 3 is deliberately ahead of row 4: a learner who walked out at
lunch and never came back, then taps on their way out the door, gets a **single
combined write** — lunch closed as `late` *and* `time_out` set — instead of
needing two taps.

"Currently at lunch" (rows 3 and 4) is true when either the last entry in
`lunch_events` has `type: "out"`, **or** the legacy pair has `lunch_out` set
with no `lunch_in`. Both formats are consulted so pre-`lunch_events` rows still
resolve.

### What each action means

**`check_in`** — the first tap of the day, whenever it happens. There is no
morning bound: a learner whose first tap is at 15:00 still gets `check_in`,
with `arrival: "late"`.

```ts
{ type: "check_in", fields: { time_in: string; arrival: ArrivalStatus; status: AttendanceStatus } }
```

`arrival` is `"late"` if `now >= 10:01:00` local, else `"present"`. Two
consequences worth knowing:

- A learner the sweep already wrote off as `absent` who then walks in gets
  `arrival` flipped back to `present`/`late`. They showed up; `absent` no
  longer holds. `time_in` being `null` is what makes this reachable — the sweep
  writes `arrival` but not `time_in`.
- Prior justification is preserved through the derived `status`: if the record's
  legacy `status` was `jLate` or `jAbsent`, the new `status` is derived with
  `justified: true`, so a guide's excusal survives the learner turning up.

**`lunch_event`** — a tap inside 13:00–13:59. Toggles: if the last recorded
event was `"in"` (or there are none), the next is `"out"`; otherwise `"in"`.
Multiple out/in pairs on one day are supported — an errand plus a real lunch
break. `lunch_events` is written as a **JSON string**, because PocketBase
stores that column as JSON.

```ts
{ type: "lunch_event", fields: { lunch_events: string; lunch_status?: AttendanceStatus } }
```

`lunch_status` is only present when the tap is a return (`"in"`), and in
practice is always `"present"` — see the dead-branch warning above.

**`late_lunch_return`** — from 14:00 up to (but not including) check-out time,
for a learner still marked out for lunch. Appends a synthetic `"in"` event and
marks the lunch late.

```ts
{ type: "late_lunch_return", fields: { lunch_events: string; lunch_status: "late" } }
```

**`check_out`** — end of day. Only fires while `time_out` is still null, so
repeat taps cannot overwrite a departure time.

```ts
{ type: "check_out", fields: { time_out: string; lunch_events?: string; lunch_status?: "late" } }
```

**`no_action`** — everything expected has already been recorded. Reachable in
three real situations, all of which are silent no-ops rather than errors:

- checked in, before 13:00
- checked in, 14:00–16:58, not at lunch (this is the window the firmware
  rejects outright and the TS rule ignores)
- checked in and checked out, not at lunch

> [!WARNING]
> **`check_in` can leave `status` and the split fields disagreeing.**
> When a guide has marked a learner `jAbsent` and the learner then taps in, the
> action writes `arrival: "late"` and `status: "jLate"` — but `AttendanceState`
> has no `justified` field, so the state machine cannot write it, and the
> dashboard caller (`checkLearnerIn` in `apps/nfc-attender/src/app/utils/utils.ts`)
> writes `action.fields` verbatim through a raw `attendance` update rather than
> through `batchUpdateAttendance`. The row ends up
> `arrival: "late"`, `justified: false`, `status: "jLate"`.
> Because `summarizeAttendance` prefers the split fields, that day is then
> counted as an unjustified `late`, while any legacy consumer reading `status`
> sees `jLate`. Not verifiable from the repo: whether this was intended as
> "the excusal is advisory until re-confirmed" or is simply a missed field.

## `findLearnersToMarkAbsent(records, learners, now)`

```ts
findLearnersToMarkAbsent(
  records: AttendanceRecord[],       // all of today's records — zero or one per learner
  learners: Pick<Learner, "id">[],   // every learner the caller cares about
  now: Date,
): string[]                          // learner ids to flip to arrival: "absent"
```

Pure decision half of the auto-absent sweep. Returns ids only; the caller
writes. Consumed by `useAutoAbsentSweep` in the dashboard
(`apps/nfc-attender/src/app/hooks/useAutoAbsentSweep.ts`) — this is a
dashboard-side timer, **not** a server-side job, so nobody is marked absent on
a day the dashboard was never opened. The firmware does not run this at all.

Rules, in order:

1. Before `10:30` local → return `[]`. The 29-minute gap past the 10:01 late
   boundary is grace for a slow morning; writing people off at 10:01 would
   collide with the arrival rush the boundary itself creates.
2. Saturday or Sunday (`getDay()` 6 or 0) → return `[]`. There is no
   holiday/term calendar at this layer, so term breaks and public holidays are
   treated as ordinary school days and *will* be swept.
3. A learner is a candidate only if **all** of these hold on their record (or
   they have no record at all):
   - no `time_in`
   - `arrival` is `null`/`undefined`
   - legacy `status` is falsy

Conditions 3b and 3c are what make the sweep idempotent and safe to run on a
timer: re-running never overwrites a guide's manual call, and never re-marks
someone already absent. 3c is the pre-migration fallback — a row with a legacy
`status` but no `arrival` counts as "a guide already handled this".

## Aggregation and reporting

Pure roll-ups used by the dashboard's history and admin views. No network; the
caller loads records however it likes.

| Export | Signature | Notes |
|---|---|---|
| `summarizeAttendance` | `(records: AttendanceRecord[], options?: SummarizeOptions) => AttendanceSummary` | Does not assume the records share a learner. |
| `summarizeByLearner` | `(records: AttendanceRecord[], options?: SummarizeOptions) => Map<string, AttendanceSummary>` | Buckets by the `learner` FK, then summarises each bucket. |
| `emptySummary` | `(expectedDays?: number) => AttendanceSummary` | For a learner with zero records in the range. Pass `expectedDays` so they register as 100% absent rather than 0-of-0. |
| `computeAttendanceRates` | `(counts: AttendanceCounts, expectedDaysInput: number) => { expectedDays, missingRecords, onTimePct, attendancePct, absentPct }` | Factored out so per-learner and cohort totals use identical math, and so the rate rules are testable without building records. |
| `formatMinutesOfDay` | `(min: number \| null) => string` | Minutes-past-midnight → `"H:MM AM/PM"`. Returns `"—"` for `null`. |

`SummarizeOptions`:

| Field | Default | Purpose |
|---|---|---|
| `expectedDays` | `records.length` | School days the learner/cohort was expected. Defaulting to the record count yields records-only math, where a day with no row silently vanishes; passing an explicit value (e.g. `countWeekdays(from, to)`) rolls those days into `missingRecords` instead. |
| `today` | local `todayDateStr()` | Reference date for the `missingCheckouts` rule. Exposed so tests can pin it. |

`AttendanceSummary`:

| Field | Meaning |
|---|---|
| `daysTracked` | Records considered (`records.length`). |
| `expectedDays` | `max(expectedDaysInput, daysTracked)`. |
| `missingRecords` | `max(0, expectedDays − daysTracked)` — days with no row at all. |
| `present` / `late` / `absent` / `jLate` / `jAbsent` | Day counts. Read from `arrival` + `justified` when `arrival` is set, else from the legacy `status`. |
| `avgCheckInMinutes` / `avgCheckOutMinutes` | Mean minutes past local midnight, rounded. `null` when no record had the field. |
| `totalLunchMinutes` | Sum of paired out→in durations. |
| `lateLunches` | Records with `lunch_status === "late"`. |
| `missingCheckouts` | `time_in` set, `time_out` missing, **and** `date < today`. Today is excluded — the learner may simply not have left yet. |
| `onTimePct` | `present / eligibleDays` |
| `attendancePct` | `(present + late + jLate) / eligibleDays` |
| `absentPct` | `(absent + missingRecords) / eligibleDays` |

The rate rules, all of which exist to stop a specific nonsense number from
reaching a report:

- `expectedDays` is floored at `daysTracked`, so a Saturday scan inside the
  range cannot produce a rate above 100%.
- `eligibleDays = max(0, expectedDays − jAbsent)` — **justified absences leave
  the denominator entirely**, so an excused day never hurts any rate. This is
  the single most consequential line in the reporting math.
- `eligibleDays === 0` short-circuits all three rates to `0` rather than
  dividing by zero.
- Every rate is rounded and then clamped to `0…100`.
- A day with no record is counted as unaccounted-for absence
  (`absentPct` includes `missingRecords`), not as neutral.

Total lunch minutes ignore an unpaired trailing `"out"` — a learner who never
returned would otherwise contribute an open-ended duration. Legacy
`lunch_out`/`lunch_in` are used only when `lunch_events` is empty.

---

## `calendar.ts` — `expandEvents`

```ts
expandEvents(records: CalRecord[], year: number, month: number): Record<string, CalEvent[]>
```

Turns raw `calendar` rows into a map from `"YEAR-M-D"` date keys (see
`makeDateKey` — **month is 1-based in the key, 0-based in the argument**) to
display-ready `CalEvent[]` for one month.

| Input shape | Behaviour |
|---|---|
| One-off (`recurrence !== "weekly"` and `recurrence_days` empty) | Included only if `start` falls in the requested year+month. `id === recordId`. |
| Weekly | Every day of the requested month is tested against `recurrence_days`; matches are emitted. `id` is `` `${recordId}-${dateKey}` `` so each occurrence has a stable unique key for React and for targeted mutations, while `recordId` still points at the row to mutate. |

Two details that cause bugs if missed:

- **Weekday indices differ between the database and JavaScript.**
  `recurrence_days` is Monday-first (`0 = Mon … 6 = Sun`); `Date.getDay()` is
  Sunday-first (`0 = Sun … 6 = Sat`). The conversion is
  `monFirst = jsDay === 0 ? 6 : jsDay - 1`.
- **A record counts as weekly if `recurrence === "weekly"` *or*
  `recurrence_days` is non-empty.** Belt and suspenders: a row with days set
  but `recurrence` left at `"none"` still expands.

`recurrence_end`, when set, is an inclusive upper bound — occurrences strictly
after it are skipped. `expandEvents` does **no access-control filtering
whatsoever**; it expands every record handed to it. Both this function's
docstring and `fetchCalendarEvents` in `pb-client` assert that privacy and
programme filtering are enforced by the hosted PocketBase collection List rule.
Not verifiable from the repo: the hosted PocketBase schema and rules are not in
version control here, and the `calendar` collection's rules are not written
down anywhere in the repo either. See
[`packages/pb-client/README.md`](../pb-client/README.md#calendar) for the full
discrepancy.

## `date-utils.ts`

PocketBase serialises datetimes as `"2026-04-01 09:00:00.000Z"` — **a space,
not a `T`**. That is not valid ISO 8601, and iOS JavaScriptCore refuses to
parse it, returning `Invalid Date`. It parses fine in V8, so the failure is
invisible on the dashboard and on Android and shows up only in the Expo app on
a real iPhone. Every PB timestamp must therefore go through `parsePBDate`, not
`new Date(…)`.

| Export | Signature | Behaviour |
|---|---|---|
| `parsePBDate` | `(iso: string) => Date` | Replaces the first space with `T`, then `new Date`. The one correct way to read a PB timestamp. |
| `formatTimeRange` | `(startIso: string, endIso: string) => string` | `"09:00 AM – 10:30 AM"`, `en-US`, 12-hour. Note the separator is an en dash. |
| `makeDateKey` | `(year: number, month: number, day: number) => string` | `"YYYY-M-D"`, **not** zero-padded. `month` is 0-indexed on the way in, 1-indexed in the output. Used as in-memory calendar map keys. |
| `toOccurrenceDate` | `(year: number, month: number, day: number) => string` | `"YYYY-MM-DD"`, zero-padded. `month` 0-indexed. Distinct from `makeDateKey` because `event_rsvps.occurrence_date` is a sortable text column and needs fixed width. |
| `dateKeyToOccurrenceDate` | `(dateKey: string) => string \| null` | Bridges the two formats. `null` on malformed input. |
| `prettyTimestamp` | `(val?: string \| null) => string` | Relative-ish display: same day → time only; within 7 days → `"Mon 2:30 PM"`; older → `"Apr 10, 2026 2:30 PM"`. `"—"` for nullish; returns the input unchanged if unparseable. |
| `todayDateStr` | `() => string` | `"YYYY-MM-DD"` for today. |
| `countWeekdays` | `(from: string, to: string) => number` | Mon–Fri days in the inclusive range. `0` for malformed or reversed ranges. Holidays are unknown at this layer and counted as weekdays. |

Two sharp edges in this file:

- **`prettyTimestamp` does not use `parsePBDate`.** It calls `new Date(val)`
  directly, so a raw PB timestamp passed to it will hit the iOS
  JavaScriptCore problem the rest of the module exists to avoid. Its NaN guard
  means the symptom is the raw string appearing in the UI rather than a crash.
- **`todayDateStr` is UTC, despite the rest of the module being local-time.**
  It is `new Date().toISOString().split("T")[0]`, and `toISOString` is always
  UTC. West of Greenwich after 00:00 UTC — i.e. any evening in the Americas —
  it returns tomorrow's date. `summarizeAttendance` uses it only as the
  `missingCheckouts` cutoff, where being a day early makes today's open record
  count as a missing checkout. `pb-client` has its own identical `todayStr`
  helper whose comment claims local time; that comment was wrong and has been
  corrected.

`countWeekdays` exists to be the denominator for attendance percentages, so
that a day nobody scanned still counts against the rate instead of disappearing
from the arithmetic.

## `roles.ts`

Three roles, stored on the `users` collection as `role`:

| Role | Who | Predicate |
|---|---|---|
| `learner` | A student. Has a `learner` FK to the `learners` collection. | `isLearner(role)` |
| `lg` | **Learning guide** — the staff role. Not an abbreviation of anything else. | `isGuide(role)` |
| `admin` | Full access. | `isAdmin(role)`, and also `isGuide(role)` |

```ts
isGuide(role: UserRole | null | undefined): boolean    // role === "lg" || role === "admin"
isAdmin(role: UserRole | null | undefined): boolean    // role === "admin"
isLearner(role: UserRole | null | undefined): boolean  // role === "learner"
```

`isGuide` returning `true` for `admin` is the load-bearing part: guide-level UI
gates can call `isGuide` alone without every call site remembering to also
check for admin. There is no "admin is not a guide" case anywhere in the
product. All three accept `null`/`undefined` (the unauthenticated case) and
return `false`, so callers do not need to null-check first.

These are client-side gates for *rendering*. Actual authorisation is the hosted
PocketBase collection rules — see [`pb_hooks/README.md`](../../pb_hooks/README.md).

## `rsvp.ts`

Pure capacity/waitlist logic for calendar events. The server-side hook
(`pb_hooks/event_rsvps.pb.js`) is what actually enforces capacity atomically;
this module is the same rule in client-side form, used for optimistic UI and
for the dashboard's own writes.

| Export | Signature |
|---|---|
| `computeRsvpAction` | `(input: ComputeRsvpInput) => RsvpDecision` |
| `promoteFromWaitlist` | `(remaining: RsvpEntry[], capacity: number \| null) => RsvpPromotion[]` |
| `countRsvps` | `(entries: RsvpEntry[], capacity: number \| null) => RsvpCounts` |

```ts
interface RsvpEntry  { id: string; user: string; status: "going" | "not_going" | "waitlisted"; position: number | null }
interface RsvpRules  { capacity: number | null; allowWaitlist: boolean; deadline: string | null }
interface ComputeRsvpInput { current: RsvpEntry[]; actorUserId: string; choice: "going" | "not_going"; rules: RsvpRules; now: Date }

type RsvpDecision =
  | { accepted: true;  status: "going" | "not_going" | "waitlisted"; position: number | null }
  | { accepted: false; reason: "deadline_passed" | "full_no_waitlist" }

interface RsvpPromotion { id: string; status: "going" | "waitlisted"; position: number | null }
interface RsvpCounts    { going: number; waitlisted: number; notGoing: number; spotsRemaining: number | null; full: boolean }
```

`computeRsvpAction`, first match wins:

| # | Condition | Result |
|---|---|---|
| 1 | `now > deadline` (parsed with `parsePBDate`; unparseable deadlines are ignored) | rejected, `"deadline_passed"` |
| 2 | `choice === "not_going"` | accepted, `not_going`, `position: null` — always succeeds, even past capacity |
| 3 | `capacity === null` | accepted, `going` — unlimited |
| 4 | `goingCount < capacity` | accepted, `going` |
| 5 | full and `allowWaitlist` | accepted, `waitlisted`, `position = max(existing positions) + 1` (1 when nobody is waitlisted) |
| 6 | full and `!allowWaitlist` | rejected, `"full_no_waitlist"` |

**The actor's own existing row is excluded from `goingCount` and from the
max-position scan.** Without that, re-submitting `going` would count you
against yourself, and re-submitting while waitlisted would shove you to the
back of the queue you are already in.

`promoteFromWaitlist` runs after a `going` user leaves. `remaining` must be the
list **after** the departure is already reflected. It returns a minimal patch
list: the first `capacity − goingCount` waitlisters become `going` with
`position: null`, and whoever is left is renumbered from 1 — but a renumber
patch is emitted only if the position actually changed. `capacity === null`
returns `[]`, since an uncapped event has nothing to promote into.

`countRsvps` is a display roll-up: counts per status, `spotsRemaining`
(`null` when uncapped, else floored at 0), and `full` (`capacity !== null &&
going >= capacity`).

---

## How this package is checked

> [!WARNING]
> **This package defines no `test` script.** `pnpm test` at the repo root runs
> `pnpm -r test`, which finds test scripts in `apps/nfc-attender` and
> `apps/ll-calendar` only. `packages/shared` is never invoked directly by it.

| Check | Command (from repo root) | What it actually covers |
|---|---|---|
| Types | `pnpm typecheck` → `pnpm -r --filter "./packages/*" typecheck` | The only check that targets this package directly. Runs in CI in both `.github/workflows/calendar-test.yml` and `.github/workflows/nfc-test-build.yml`. |
| Behaviour, main | `pnpm --filter nfc-attender test` (vitest) | `attendance-state-machine.test.ts`, `attendance-summary.test.ts`, `date-utils.test.ts`, `expand-events.test.ts`, `rsvp.test.ts` — all import `@learnlife/shared` directly. This is where essentially all behavioural coverage of this package lives, and it lives in another package. |
| Behaviour, incidental | `pnpm --filter ll_calendar test` (jest, `TZ=UTC`) | `__tests__/calendar-utils.test.ts` reaches `expandEvents` / `makeDateKey` / `formatTimeRange` through `apps/ll-calendar/lib/calendar-utils.ts`, which re-exports them. |

Both app suites resolve `@learnlife/shared` to `packages/shared/src/index.ts`
by path mapping (jest `moduleNameMapper` in `apps/ll-calendar/package.json`;
vitest/tsconfig aliases in `apps/nfc-attender`), so they test the source, not a
build artefact.

The practical consequence: **deleting `apps/nfc-attender` would silently remove
almost all test coverage of the repository's core domain logic.**

## Consumers

| Consumer | Uses |
|---|---|
| `apps/nfc-attender` (dashboard) | `computeCheckInAction`, `deriveStatus`, `splitStatus`, `findLearnersToMarkAbsent`, the whole aggregation surface, `countWeekdays` |
| `apps/ll-calendar` (Expo app) | `expandEvents`, `parsePBDate`, `formatTimeRange`, `makeDateKey`, `dateKeyToOccurrenceDate`, `computeRsvpAction`, `promoteFromWaitlist`, `countRsvps` |
| `apps/nfc-attender-fw` (ESP32) | Nothing at runtime — it is C++. It carries a hand-written port of `computeCheckInAction` and `deriveStatus`. |

## Related

- [`packages/pb-client/README.md`](../pb-client/README.md) — where `TIME_THRESHOLDS`, the collection types, and the duplicate `deriveStatus` live
- [`docs/POCKETBASE.md`](../../docs/POCKETBASE.md) — the backend reference: collections, fields, API rules, and what cannot be verified from the repo
- [`docs/MONOREPO_ARCHITECTURE.md`](../../docs/MONOREPO_ARCHITECTURE.md)
- [`docs/GLOSSARY.md`](../../docs/GLOSSARY.md)
- [`apps/nfc-attender-fw/README.md`](../../apps/nfc-attender-fw/README.md) — the third implementation
- [`pb_hooks/README.md`](../../pb_hooks/README.md) — server-side rules and hooks
