# Testing

This firmware has 13 Unity suites and **181 test cases**, and every one of them
runs on your laptop with no ESP32 plugged in. That is not an accident of the
code being simple — it is the reason the code is shaped the way it is. The
interesting failures in an attendance terminal are a power cut halfway through
a queue compaction, a corrupt line left by that power cut, a 404 for a row a
guide deleted, a chunked HTTP response that arrives in three pieces. All of
those are trivial to construct in a host test and close to impossible to
provoke on demand at a school front desk. So the behaviour was moved off the
hardware, into pure modules, and the Arduino files were reduced to adapters
thin enough not to need testing.

This document is how to run the suites, what each one covers, how the host
build is possible at all, how the shared cross-language attendance fixture
works, and — most importantly — the one trap that will silently swallow a new
test.

Per-module detail, including which suite covers which module:
[`SOURCE_MAP.md`](SOURCE_MAP.md).

## Running the suites

All commands run **from `apps/nfc-attender-fw/`**.

```bash
# Everything — 13 suites, 181 cases
pio test -e native

# One suite
pio test -e native -f test_queue_core

# Several (comma-separated, or repeat -f)
pio test -e native -f test_queue_core -f test_queue_format
```

Requirements: PlatformIO and a host C++ compiler. No ESP32, no toolchain
download — the `native` environment pulls only ArduinoJson and Unity, so a cold
cache warms in seconds. (The `esp32dev` environment, by contrast, is a
several-hundred-megabyte xtensa toolchain.)

`pio test` prints a per-suite pass/fail block and a final summary. **Read the
case count**, not just the colour — see [the allow-list trap](#the-allow-list-trap).

CI runs exactly `pio test -e native` in
[`.github/workflows/nfc-fw.yml`](../../../.github/workflows/nfc-fw.yml), as a
separate job from the firmware build. That workflow is firmware-specific
because the two older `nfc-*.yml` workflows are path-filtered to
`apps/nfc-attender/**`, and that glob does not match `apps/nfc-attender-fw/`.

## The `native` environment

```ini
[env:native]
platform = native
build_flags = -std=gnu++17 -I src -DLLATTENDER_NATIVE_BUILD
lib_deps = bblanchon/ArduinoJson@^7.2.0
build_src_filter = -<*> +<state_machine.cpp> +<fields.cpp> …
test_build_src = yes
test_filter = test_state_machine, test_fields, …
```

Four things make it work:

| Setting | What it does |
|---|---|
| `platform = native` | Builds with the host compiler, no cross-toolchain, no Arduino core |
| `-DLLATTENDER_NATIVE_BUILD` | The switch every hardware file is wrapped in. `#ifndef LLATTENDER_NATIVE_BUILD` around the whole body means those translation units compile to nothing on the host instead of failing to find `Arduino.h` |
| `build_src_filter` | Allow-list of the `src/*.cpp` files that *are* compiled |
| `test_build_src = yes` | Compiles `src/` alongside the test files. Without it the tests fail to link the symbols they reference |

**Why the pure/impure split makes host testing possible at all.** ArduinoJson is
the only shared dependency, and it is header-only and platform-agnostic, so it
builds on the host unchanged. Everything else Arduino — `Wire`, `WiFi`,
`LittleFS`, `HTTPClient`, `Preferences`, FreeRTOS primitives — appears only
inside `#ifndef LLATTENDER_NATIVE_BUILD` blocks or only in files excluded from
`build_src_filter`. No mocks, no HAL, no fake Arduino shim: the pure modules
genuinely have no Arduino dependency to mock.

Where a pure module *does* need to reach hardware, it takes an interface instead
and the device supplies the implementation:

| Interface | Device implementation | Host double |
|---|---|---|
| `LineStore` (`line_store.h`) | `LittleFsLineStore` (`line_store.cpp`) | `InMemoryLineStore`, header-only, with `fail_next_append` / `fail_next_replace` |
| `ByteSource` (`json_source.h`) | `StreamByteSource` over `HTTPClient::getStream()` | `StringByteSource` over a `std::string` |

Those two seams are why "compaction fails halfway" and "the response is
chunked" are ordinary unit tests. `InMemoryLineStore::replace_all` leaves the
old contents intact when its failure flag is set, matching what a real atomic
write-then-rename gives — so a test can assert that a failed compaction cost
nothing.

Test files are plain Unity with an explicit `main`:

```cpp
#include <unity.h>
#include "clock_gate.h"

void setUp(void) {}
void tearDown(void) {}

void test_blocks_before_ntp_sync() { /* TEST_ASSERT_* */ }

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_blocks_before_ntp_sync);
  return UNITY_END();
}
```

One directory per suite, one `.cpp` inside it, named `test_<module>`. Every
`RUN_TEST` line has to be added by hand — there is no auto-discovery.

## The allow-list trap

> `build_src_filter` and `test_filter` are **explicit allow-lists.** A new pure
> module missing from **both** is silently never compiled and never run. It does
> not fail. It does not warn. It just does not exist.

`build_src_filter` starts with `-<*>`, which excludes everything, and then
re-adds named files. `test_filter` names the test directories to run. Neither
has a wildcard, so:

| You forgot | Symptom |
|---|---|
| `build_src_filter` entry | Link error when the suite references the symbol — **noisy, you will notice**. But a header-only module links fine, so you will not |
| `test_filter` entry | The suite is skipped entirely. Green run, one fewer suite in the summary. **This is the silent one** |
| Both | Total silence. The module and its tests may as well not be in the repo |

The reason it is set up this way: the filter cannot be a wildcard, because most
of `src/` genuinely cannot compile on the host. An allow-list is the honest
representation of "these ten files are pure". The cost is that it must be
maintained by hand, which is what this section exists to survive.

`platformio.ini` carries the same warning inline, and so does the CI workflow's
test step. Three copies, because forgetting is the default.

### Adding a pure module and its test

From `apps/nfc-attender-fw/`:

1. **Write `src/<name>.h` and `src/<name>.cpp`.** No `Arduino.h`, no `Wire.h`,
   no `WiFi.h`, no `LittleFS.h`, no FreeRTOS. C++ stdlib and ArduinoJson only.
   If it needs hardware, take an interface parameter — see `LineStore` and
   `ByteSource` above.

2. **Add the `.cpp` to `build_src_filter`** in `[env:native]`:

   ```ini
   build_src_filter = -<*> +<state_machine.cpp> … +<name.cpp>
   ```

3. **Create `test/test_<name>/test_<name>.cpp`** using the Unity shape above.
   One directory per suite; the directory name is what `test_filter` matches.

4. **Add the directory to `test_filter`** in the same `[env:native]` block:

   ```ini
   test_filter = test_state_machine, … , test_<name>
   ```

5. **Run it alone and read the count:**

   ```bash
   pio test -e native -f test_<name>
   ```

   If the output says the filter matched nothing, step 4 is wrong. If it says
   the suite ran 0 cases, a `RUN_TEST` line is missing.

6. **Run the whole set** and confirm the summary went up:

   ```bash
   pio test -e native
   ```

**Header-only modules need only step 4.** `clock_gate.h`, `pb_result.h` and
`json_source.h` have no `.cpp`, so there is nothing for `build_src_filter` to
add — and both `clock_gate.h` and `version.h` say so in a comment, so the
absence reads as deliberate rather than as an oversight. Their tests still need
a `test_filter` entry like any other.

**Helper `.cpp` files inside an already-listed `test_*` directory need no entry
in either list.** The whole directory is compiled as one binary, which is why
`test_state_machine/fixture_runner.cpp` works without appearing anywhere in
`platformio.ini`. Only `src/` modules and test *directories* are allow-listed.
`platformio.ini` records this next to the warning.

**Also update** the pure-logic table in [the README's source map](../README.md#source-map)
and the module entry in [`SOURCE_MAP.md`](SOURCE_MAP.md). A module with tests
nobody can find is only half-covered.

## What each suite covers

| Suite | Cases | Covers |
|---|---:|---|
| `test_state_machine` | 62 | **15 hand-written** — present before 10:01, late at 10:01, `jLate`/`jAbsent` excusal inheritance, on-time arrival dropping an excusal, no-action mid-morning, lunch out at 13:00, lunch in after out, late lunch return, 17:00 weekday check-out, Friday 14:00 check-out, the 14:00–16:59 lock including at 16:59, lunch-return beating the lock, no double check-out. **Plus 47 from the shared fixture** — see [below](#the-cross-language-attendance-fixture) |
| `test_pb_response` | 19 | Login token extraction; learner and attendance page parsing; bad JSON rejection; rows without an `id` skipped; the "no match is not an error" contract; legacy `lunch_out`/`lunch_in` propagation; and five streaming cases — 61 rows without OOM, the field filter dropping unread keys, a sink stopping early, a truncated body returning false, and `meta` being populated before the first row |
| `test_queue_core` | 14 | Queue behaviour: append/size, survives a reboot, drain-all empties, `RetryLater` stopping and preserving order, `PermanentFail` moving to dead and continuing, a corrupt line skipped not fatal, the entry cap dropping oldest and reporting it, dropping never silent, a failed compaction leaving the live store intact, a failed append reported, an empty store loading clean, the dead-letter store being append-only, full field round-trip, and the empty-`attendance_id` first-scan case |
| `test_jwt` | 12 | `exp` extraction from a realistic token; the base64url alphabet; padded and unpadded payloads; and every rejection path — missing `exp`, non-numeric `exp`, negative or zero `exp`, not-a-JWT, invalid base64, payload that is not JSON. Plus `is_usable` honouring the skew and rejecting missing inputs |
| `test_roster_format` | 12 | Round-trip; a `\|` inside a learner's name surviving; UTF-8 accents; UID lowercasing on both write and read; `normalize_uid` directly; a learner with no card kept; an empty name accepted; rejection of a wrong version, too few fields, and an empty id; CR/LF stripped on write; a `\|` in a machine field stripped |
| `test_chunked_source` | 11 | Single chunk, multiple chunks concatenating, uppercase and multi-digit hex lengths, `;ext=` extensions ignored, trailer headers after the terminator ignored, `readBytes` spanning a chunk boundary, a JSON document parsing straight through the framing, truncation mid-chunk flagged malformed, a missing terminator not reported complete, garbage length malformed, and an empty body that is just the terminator |
| `test_pb_request` | 11 | Percent-encoding of the unreserved set and of special characters; trailing-slash stripping; login URL and a body that escapes the password; the learners URL; filter encoding on find-today; create URL and body; patch URL; and the delta URL, including with a trailing-slash base |
| `test_fields` | 9 | PATCH bodies for check-in present, check-in late, late-and-justified, check-out, lunch-out-only, lunch-in present, late lunch return; `NoAction` returning empty; and `json_escape` on special characters |
| `test_pb_result` | 8 | The retry policy: 2xx as `Ok`, a deleted row (404) as permanent, other 4xx as permanent, 401 as retryable, 429/408 as retryable, 5xx as retryable, negative transport errors as retryable, and unknown codes defaulting to retry |
| `test_attendance_adapter` | 7 | An empty row yielding empty state, `time_in` setting the flag, status strings mapping to the enum, `lunch_events` array parsing, unknown event types skipped, legacy lunch fields setting their flags, and malformed `lunch_events` JSON not crashing |
| `test_queue_format` | 7 | Round-trip of a check-in; an empty `attendance_id` (first scan of the day) accepted; rejection of a wrong version, too few fields, too many fields, and an empty `learner_id`; and JSON brace characters preserved inside the fields column |
| `test_json_source` | 5 | The load-bearing one: ArduinoJson deserialising through a virtual `ByteSource`, and through an abstract-base reference specifically; a filter applying while streaming; truncated input reporting an error rather than crashing; and the `read`/`readBytes` end-of-input semantics |
| `test_clock_gate` | 4 | Blocked before NTP; allowed after; allowed on an override with no NTP; allowed when both hold |
| **Total** | **181** | |

Counting method, because it is no longer uniform: twelve suites are one
`RUN_TEST` per case, countable by grepping `test/*/*.cpp`. `test_state_machine`
is 15 `RUN_TEST` calls plus 47 cases that `fixture_runner.cpp` drives through
`UnityDefaultTestRun` in a loop, so grep undercounts it by 47 and reports 134
for the repo. The 47 breaks down as 41 fixture entries (`cases` in the fixture
JSON) plus six fixed cases: `fixture/loaded`, `fixture/thresholds`,
`fixture/guard_D2a_mask`, `fixture/report_D5_unported`,
`fixture/report_D4_unported` and `fixture/report_divergences`.

If you add a case, this table and the three counts in
[the README](../README.md) go stale — they are maintained by hand.

`test_json_source` is worth its own note. It exists because the entire
streaming-parse design rests on an assumption about a third-party library:
ArduinoJson's generic `Reader` stores a **pointer** to the source and calls
through it, which is what makes an abstract base with virtual
`read()`/`readBytes()` work — nothing slices, nothing is copied, and the calls
dispatch virtually. That is documented behaviour, but it is documented behaviour
this firmware cannot function without, so it is pinned by a test rather than
trusted.

## The cross-language attendance fixture

The attendance rule is implemented **four** times in this repo:

| Implementation | Role | Guarded by the fixture? |
|---|---|---|
| `packages/shared/src/attendance.ts` | The specification | Yes |
| `apps/nfc-attender-fw/src/state_machine.cpp` | C++ port for this reader | Yes |
| `packages/pb-client/src/queries/attendance.ts` | Duplicated `deriveStatus` | **No** |
| `packages/pb-client/scripts/backfill-arrival.ts` | Duplicated `splitStatus` | **No** |

They had already drifted. `packages/shared/fixtures/attendance-state-machine.json`
is the structural fix: one committed JSON file of cases, read by **two**
harnesses that must agree with it —
`apps/nfc-attender/src/__tests__/attendance-fixture.test.ts` (Vitest) and
`test/test_state_machine/fixture_runner.cpp` (this suite). A case both harnesses
run is a case where drift fails a build.

**Scope, precisely:** the fixture pins `computeCheckInAction` across the spec
and this port. Neither `pb-client` copy is on that path — `deriveStatus` there
is a duplicate of a four-line pure mapping and `splitStatus` is its inverse —
so nothing in this harness constrains them. They remain unguarded, and changing
a threshold still means changing all four by hand.

### How the C++ side works

- `test_state_machine.cpp`'s `main()` calls `llattender_fixture::run_all()`
  after the 15 hand-written `RUN_TEST` lines, between `UNITY_BEGIN()` and
  `UNITY_END()`. The runner drives Unity itself via `UnityDefaultTestRun`,
  emitting one named case per fixture entry (`fixture/<id>`).
- The fixture path arrives as `-DLL_ATTENDANCE_FIXTURE` in `[env:native]`'s
  `build_flags`. **`fixture_runner.cpp` `#error`s if that define is missing**,
  so the harness can never silently run zero cases — which is the same class of
  failure as [the allow-list trap](#the-allow-list-trap), closed deliberately.
  If the file is present but unreadable or unparseable, `run_all` emits a single
  failing `fixture/load` or `fixture/parse` case and returns, so the rest of the
  suite still reports.
- **Both harnesses pin `TZ=UTC`.** Both implementations read local wall-clock
  fields (`Date.getHours`, `std::tm.tm_hour`), so a host timezone with a DST
  transition inside a case's date could renormalise the hour and surface as a
  phantom divergence. The C++ side calls `setenv("TZ","UTC",1)` + `tzset()` in
  `main` before any `mktime`, so it holds however the binary is invoked rather
  than depending on the runner's environment. Each harness then re-reads
  hour/minute/weekday back off the clock it built and fails with an explicit
  message if it does not match the fixture — asserting on a shifted time would
  be worse than failing.
- The JSON is a **generated file, not hand-edited.** Regenerate deliberately
  with `pnpm gen:attendance-fixture` and commit the diff;
  `pnpm check:attendance-fixture` fails when it is stale. Neither test suite
  runs the generator.

### Known divergences are pinned, not hidden

Cases carrying a `divergence` block assert against the **recorded C++
behaviour** and report `KNOWN DIVERGENT` instead of failing. That keeps both
behaviours pinned while the product decision is outstanding, rather than
deleting the case or letting the suite go red permanently. The registry holds
**six entries under five numbered IDs** — D1, D2, D2a, D3, D4, D5, where D2a is
a distinct defect filed under D2's number because D2 masks it. All are
`UNDECIDED`:

| ID | Divergence | Observable today? |
|---|---|---|
| **D1** | Non-Friday check-out: TS says **16:59**, this port says **17:00**. For the whole of 16:59 the dashboard checks a learner out while the reader refuses the tap | Yes |
| **D2** | Ordering: TS evaluates check-out **before** late-lunch-return, this port evaluates late-lunch-return **first**. A learner who never returned from lunch is checked out by the dashboard and left checked in by the device | Yes |
| **D2a** | This port's `CheckOut` branch writes `time_out` only — it never closes an open lunch, where TS sets `lunch_events` plus `lunch_status='late'` in the same write. Silent data loss, distinct from D2's ordering question | No — **masked by D2**: the late-lunch-return step catches every at-lunch state from 14:00 onward, and both check-out cutoffs are at or after 14:00, so the branch is never reached with an open lunch. Fixing D2 by reordering would unmask it, which is what `fixture/guard_D2a_mask` exists to catch |
| **D3** | The 14:00–17:00 no-scan window (`ActionType::Locked`) has no TS equivalent — TS falls through to no-action. Every stray afternoon tap is a silent no-op on one side and a visible rejection on the other | Yes |
| **D4** | `findLearnersToMarkAbsent` was never ported. The device can never mark anyone absent; the fixture's `absence_sweep` cases run against the spec only, and this harness reports them unported via `fixture/report_D4_unported` | No |
| **D5** | This port **neither reads nor writes the `justified` column.** Two halves, needing different fixes. **WRITE:** `fields.cpp`'s `CheckIn` arm PATCHes only `time_in`, `arrival` and `status`, while the spec's `check_in` also emits `justified` — so a device tap on a justified learner leaves that column at whatever it held and the row contradicts itself. That is the same defect the TypeScript side was just fixed to stop producing, against the same PocketBase collection. **READ:** `state_machine.h`'s `AttendanceState` has no `justified` field, so prior justification can only be decoded from the legacy `status` enum; an excusal recorded *only* in the column is invisible and this port derives `late` where the spec derives `jLate` | Yes |

There is also one **shared defect**, recorded but deliberately *not* marked as a
divergence because both implementations have it: inside the lunch window
`lunch_status` is computed as `now >= 14:01 ? late : present`, but that branch
only runs while `hour < 14`, so the late arm is unreachable and the window
always writes `present`. Two fixture cases pin the current behaviour.

Note that D1 means the check-out threshold in this port (17:00, documented under
`state_machine` in [`SOURCE_MAP.md`](SOURCE_MAP.md)) is **not** the same as the
dashboard's. Do not "fix" one side without a decision on both.

### How a partially-ported field is compared

D5 would otherwise turn every `check_in` case divergent, which would hide all
the fields that *do* agree. Instead the harness reads a `cpp_skips_field` key
off the divergence registry (`"justified"` for D5) and skips exactly that one
key when comparing, reporting D5 once via `fixture/report_D5_unported`. Every
other field on those cases stays compared. The READ half is pinned separately,
per-case, by `check_in/modern_justified_column_without_derived_status`.

The comparator also has an **unknown-key guard**: a fixture key it does not
compare is a hard failure with an actionable message, not a silent skip. Without
it, `cpp_skips_field` would be a hole — a new field added to the spec would be
quietly ignored by the C++ side and the harness would still pass, which is
exactly the drift this fixture exists to stop.

**The D5 fix is known and deliberately not applied.** It is the same shape as
the TypeScript one — add `justified` to the C++ `AttendanceState` and
`CheckInAction`, read it alongside the enum, emit it from `fields.cpp` — but
changing what the device writes ships to physical hardware, so it is recorded
rather than dropped.

## What is not covered

Everything in the hardware half. None of the following has a host test, and
none is compiled by the `native` environment:

| Module | Untested behaviour that matters |
|---|---|
| `main.cpp` | Task creation and pinning, boot ordering, the drain writer's recompute path, the whole serial console |
| `nfc.cpp` | PN532 probe, UID debounce window, all three I2C line diagnostics |
| `ui.cpp` | Every render path, mode timeouts, the reader/network indicator precedence |
| `buzzer.cpp` | Every cue |
| `time_sync.cpp` | NTP, the `is_synced` latch, the timezone string, the override epoch shift |
| `config.cpp` | NVS round-trip, both provisioning flows, password generation, the 10-minute timeout |
| `pb_client.cpp` | Every HTTPS call, TLS pinning, the today-cache, the watermark, provisional rows |
| `queue.cpp` | Only the wiring; the behaviour it wraps is covered by `test_queue_core` |
| `roster.cpp` | **See below** |
| `ota.cpp` | The whole OTA lifecycle |
| `line_store.cpp` | The two-phase rename and all three `recover()` cases |

Some of this is fine — `buzzer::cue` is a `switch` over an enum, and a test
would restate the source. Some of it is a real hole, most obviously
`pb_client.cpp` at 705 lines and `main.cpp` at 806.

### `roster.cpp` specifically

`line_store.h` used to name "queue_core, roster" as the pure modules that talk
to the `LineStore` interface, which was **wrong about `roster`** — the comment
now records the exception explicitly. `roster.cpp` is
wrapped in `#ifndef LLATTENDER_NATIVE_BUILD`, is absent from
`build_src_filter`, and has no `test_roster` directory. It is Arduino-gated for
two reasons that are both incidental to its logic: it uses FreeRTOS
`xSemaphoreCreateRecursiveMutex` directly, and it instantiates a
`LittleFsLineStore` as a file-static rather than taking a `LineStore&`.

Three behaviours are therefore unexercised, and all three are correctness
behaviours with a stated rationale:

- **Refuse-empty-replace.** `replace()` rejects an empty item list so a
  permissions change or an empty page cannot wipe the cache and leave the device
  unable to identify anyone.
- **UID normalisation on lookup.** `lookup_by_uid` lowercases the incoming UID
  before comparing, so an uppercase `NFC_ID` pasted into the dashboard still
  matches. (`roster_format::normalize_uid` itself *is* tested, in
  `test_roster_format`. What is untested is that `lookup_by_uid` calls it.)
- **Never match an empty UID.** A learner with no card issued must never be
  returned for an empty scan.

Closing this would mean taking `LineStore&` in the constructor and moving the
lock behind a seam, at which point the module joins the pure half. Until then
these three are on the honest list of things nothing will catch.

### On-device verification

The counterpart to this document is the on-device checklist in
[the README](../README.md#verification) — clock gate, heap low-water mark, live
sync, the durability test, offline roster, TLS pinning, OTA — and the
operational procedures in [`OPERATIONS.md`](OPERATIONS.md). Wiring faults are
covered by [`../hardware/README.md`](../hardware/README.md#troubleshooting).

One caveat on that checklist, verified against `setup()`: `nfc::init()` runs
*after* `config::run_provisioning()`, which never returns on an unprovisioned
unit. So a fresh board has no `[nfc]` line and no tap path at all until it is
provisioned, which makes the clock-gate and offline-roster checks impossible to
perform on it. Provision first, then run them.
