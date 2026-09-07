# Testing

This firmware has 13 Unity suites and **134 test cases**, and every one of them
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
build is possible at all, and — most importantly — the one trap that will
silently swallow a new test.

Per-module detail, including which suite covers which module:
[`SOURCE_MAP.md`](SOURCE_MAP.md).

## Running the suites

All commands run **from `apps/nfc-attender-fw/`**.

```bash
# Everything — 13 suites, 134 cases
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

**Also update** the pure-logic table in [the README's source map](../README.md#source-map)
and the module entry in [`SOURCE_MAP.md`](SOURCE_MAP.md). A module with tests
nobody can find is only half-covered.

## What each suite covers

| Suite | Cases | Covers |
|---|---:|---|
| `test_state_machine` | 15 | The attendance rule end to end: present before 10:01, late at 10:01, `jLate`/`jAbsent` excusal inheritance, on-time arrival dropping an excusal, no-action mid-morning, lunch out at 13:00, lunch in after out, late lunch return, 17:00 weekday check-out, Friday 14:00 check-out, the 14:00–16:59 lock including at 16:59, lunch-return beating the lock, and no double check-out |
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
| **Total** | **134** | |

Counts are `RUN_TEST` invocations, verified by counting them in
`test/*/*.cpp`. If you add a case, this table and the two counts in
[the README](../README.md) go stale — they are maintained by hand.

`test_json_source` is worth its own note. It exists because the entire
streaming-parse design rests on an assumption about a third-party library:
ArduinoJson's generic `Reader` stores a **pointer** to the source and calls
through it, which is what makes an abstract base with virtual
`read()`/`readBytes()` work — nothing slices, nothing is copied, and the calls
dispatch virtually. That is documented behaviour, but it is documented behaviour
this firmware cannot function without, so it is pinned by a test rather than
trusted.

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
