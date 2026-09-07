# Source map

Per-module reference for every file in [`../src/`](../src/). The
[README's source map](../README.md#source-map) is the two-line orientation
version — which half a module lives in, and one sentence about what it does.
This file is the layer below it: for each module, the exported API, which test
suite covers it, and the invariants that are not obvious from the signatures.

It exists because `src/` is 46 files across 26 modules, and the interesting
question when you come back to this in six months is never "what does
`fields.cpp` do" — it is "if I change this, what breaks, and is there a test
that will tell me". So every entry names its test suite, or says plainly that
there is none.

## The split, and why it is the organising principle

Every module is on exactly one side of a line:

| | Pure logic | Hardware/network |
|---|---|---|
| Compiles on | host (`native`) **and** device | device only |
| Excluded by | — | `#ifndef LLATTENDER_NATIVE_BUILD` |
| Tested by | `pio test -e native` | on-device checks only |
| Allowed to `#include` | C++ stdlib, ArduinoJson | anything |
| Count | 14 modules, 24 files | 12 modules plus `line_store.cpp`, 22 files |

The rule the codebase follows: **every non-trivial decision lives in a pure
module with tests, and the Arduino file is a thin adapter with no branching in
it.** `queue_core` versus `queue.cpp` is the clearest example — caps, ordering,
dead-lettering and corrupt-line recovery are all in the pure half; `queue.cpp`
supplies a filesystem and a mutex and nothing else. That is what makes "power
cut mid-compaction" a host test instead of a hardware session.

Mechanics of the split, and how to add to it: [`TESTING.md`](TESTING.md).
Runbook for a device in service: [`OPERATIONS.md`](OPERATIONS.md).

---

# Pure logic

## `state_machine`

`state_machine.h` · `state_machine.cpp` · pure · **`test_state_machine`** (15 cases)

The attendance rule. A C++ port of `computeCheckInAction` in
`packages/shared/src/attendance.ts`, with the thresholds from
`packages/pb-client/src/constants.ts`.

```
const char* status_to_str(Status)
Status      status_from_str(const char*)          // None on unknown
Status      derive_status(Status arrival, bool justified)
CheckInAction compute_check_in_action(const AttendanceState&,
                                      const std::tm& local_now,
                                      std::time_t now_unix)
std::string format_iso8601(std::time_t)           // JS Date.toISOString() shape
```

Thresholds, all in **school-local time**:

| Boundary | Value | Effect |
|---|---|---|
| Late | 10:01 | `arrival` becomes `Late` at or after |
| Lunch window | 13:00–13:59 | taps append a `LunchEvent` |
| Late lunch return | 14:00+ | returning from an open `out` is `LateLunchReturn`, `lunch_status=late` |
| Locked window | 14:00–16:59 | non-Friday, already checked in, not at lunch → `Locked` |
| Check-out | 17:00 | 14:00 on Friday (`tm_wday == 5`) |

Invariants and gotchas:

- **`local_now` must be local time, `now_unix` must be the real instant.** The
  thresholds read `tm_hour`/`tm_min`/`tm_wday`; the ISO strings written into
  PocketBase come from `now_unix`. `time_sync::now_local()` /
  `now_unix()` supply exactly this pair, including under a `t HH:MM` override.
- **Step order is load-bearing.** Check-in comes first, so a learner with no
  `time_in` checks in at any hour — including inside the locked window. Step 4
  (check-out) precedes step 4.5 (lock), which is why Friday's 14:00 check-out
  is not swallowed by the 14:00 lock.
- **A prior excusal survives a late arrival.** `status ∈ {jLate, jAbsent}` on
  the existing row makes the new check-in `jLate`; arriving on time drops it,
  because `derive_status` never justifies `Present`.
- **This is one of three implementations of the same rule** — the TS original,
  the hand-duplicated `deriveStatus` in
  `packages/pb-client/src/queries/attendance.ts`, and this port. Nothing in CI
  compares them. Changing a threshold means changing all three.

## `fields`

`fields.h` · `fields.cpp` · pure · **`test_fields`** (9 cases)

Serialises a `CheckInAction` into the JSON body of the PocketBase PATCH.

```
std::string serialize_action(const CheckInAction&)   // "" for NoAction/Locked
std::string serialize_lunch_events_array(const std::vector<LunchEvent>&)
std::string json_escape(const std::string&)          // no surrounding quotes
```

- Hand-rolled emitter, not ArduinoJson, deliberately: the field set is small
  and fixed, and this keeps a JSON library out of the pure build for one
  object. `json_escape` handles `"`, `\`, `\b\f\n\r\t` and `\u00xx` for other
  control characters.
- **`lunch_events` goes on the wire as a *string* containing a JSON array**, not
  as an array. That matches what the TS client writes, so a row looks identical
  regardless of which client produced it. Getting this wrong produces rows the
  dashboard silently mis-renders.
- `NoAction` and `Locked` return `""`; `processor_task` skips both before
  reaching here, so those arms are unreachable today. They exist so the
  `switch` stays exhaustive and `-Wswitch` fires if a new `ActionType` appears.
- `pb_request.cpp` reuses `json_escape`; it is not private to this module.

## `pb_request`

`pb_request.h` · `pb_request.cpp` · pure · **`test_pb_request`** (11 cases)

URL and request-body construction for every PocketBase call. The HTTPS call
itself is in `pb_client.cpp`; splitting them is what makes URL encoding and
filter syntax testable on the host.

```
std::string percent_encode(const std::string&)       // RFC 3986 unreserved set
std::string canonical_base(const std::string&)       // strips one trailing '/'
std::string login_url / login_body(identity, password)
std::string list_learners_url(base, page, per_page)
std::string find_today_attendance_url(base, learner_id, date)
std::string list_attendance_for_date_url(base, date, page, per_page)
std::string list_attendance_updated_since_url(base, date, since, page, per_page)
std::string create_attendance_url / create_attendance_body(learner_id, date)
std::string patch_attendance_url(base, attendance_id)
```

- Every URL goes through `canonical_base`, so a provisioned `pb_url` with a
  trailing slash does not produce `//api/...`.
- Filters are built raw and then percent-encoded whole — `learner = "<id>" &&
  date ~ "<date>"`. Encoding the pieces separately would double-encode the
  quotes and the `&&`.
- `list_attendance_updated_since_url` sorts by `updated` **ascending** on
  purpose: a truncated multi-page delta still advances the watermark
  monotonically. Reversing the sort would let a partial page skip rows forever.
- `since` must come from a value PocketBase returned, never from device time —
  see the watermark note under `pb_client`.

## `pb_response`

`pb_response.h` · `pb_response.cpp` · pure · **`test_pb_response`** (19 cases)

JSON parsing for PocketBase responses, in two flavours: streaming (used on
device for list pages) and whole-string (used for small single records and by
every test).

```
struct PageMeta { int page, total_pages, total_items; }
using AttendanceRowSink = std::function<bool(pb_client::AttendanceRow&&)>;
using LearnerRowSink    = std::function<bool(pb_client::LearnerRow&&)>;

bool stream_attendance_page(ByteSource&, PageMeta&, const AttendanceRowSink&)
bool stream_learners_page  (ByteSource&, PageMeta&, const LearnerRowSink&)

bool parse_login(json, out_token)
bool parse_learners_page(json, LearnersPage&)
bool parse_attendance_search(json, AttendanceRow&)   // empty items → true, id empty
bool parse_attendance_page(json, AttendancePage&)
bool parse_attendance_record(json, AttendanceRow&)
```

- **The streaming path is the OOM fix.** The old code read the body into a
  `std::string` and handed it to ArduinoJson, which built a second full copy in
  its arena; at 61 rows with TLS already holding ~40 KB that exceeded the
  heap. Streaming parses off the socket and hands each row to a sink, so no
  vector of rows ever exists.
- A `DeserializationOption::Filter` names exactly the fields the device reads,
  so `collectionId`, `collectionName`, `created` and `expand` are parsed and
  discarded without allocating. `items[0]` in a filter means "every element of
  items" — ArduinoJson's array-filter idiom, not an index.
- **`meta` is populated before the first sink call**, because PocketBase emits
  `page`/`perPage`/`totalItems`/`totalPages` ahead of `items`. Pagination
  decisions inside a sink are therefore safe. `test_stream_attendance_meta_available_before_rows`
  pins this.
- Returning `false` from a sink stops the parse early. Rows are moved in, so a
  sink that keeps one pays no copy.
- The PocketBase column is **`NFC_ID`**, uppercase, and `lunch_out`/`lunch_in`
  are the legacy columns mapped onto `lunch_*_legacy`. An empty page is `true`
  with no rows, not an error.
- `parse_attendance_page` still materialises a vector — the exact allocation
  pattern that OOMed. It survives for the tests and small responses; the device
  prefetch calls `stream_attendance_page` directly. Do not reach for it on the
  device path.

## `attendance_adapter`

`attendance_adapter.h` · `attendance_adapter.cpp` · pure · **`test_attendance_adapter`** (7 cases)

Converts a `pb_client::AttendanceRow` into the `AttendanceState` the state
machine consumes.

```
void state_from_row(const pb_client::AttendanceRow&, AttendanceState& out)
```

- `out` is fully reset first, so a reused struct cannot leak a previous
  learner's state.
- Presence is derived from emptiness: `has_time_in = !row.time_in.empty()`.
  PocketBase returns unset datetimes as empty strings, and `pb_response`
  normalises JSON `null` to empty too.
- ISO→unix conversion is hand-written because `timegm` is absent on newlib and
  `mktime` would apply the local offset to what is a UTC input. Failure returns
  `0` and keeps the original ISO string, so the event still round-trips and only
  downstream date arithmetic is affected.
- Malformed `lunch_events` JSON is swallowed, not fatal — a bad column must not
  make a learner's card stop working
  (`test_malformed_lunch_events_json_does_not_crash`). Events with an
  unrecognised `type` are skipped individually.

## `queue_format`

`queue_format.h` · `queue_format.cpp` · pure · **`test_queue_format`** (7 cases)

On-disk line format for `/queue.jsonl`.

```
constexpr char kDelimiter = '|';
constexpr const char* kVersion = "v1";
std::string serialize(const queue::PendingScan&)
bool parse(const std::string& line, queue::PendingScan& out)
```

Line shape: `v1|<learner_id>|<attendance_id>|<ts_unix>|<fields_json>`

- **Pipe-delimited despite the `.jsonl` filename.** All four data fields are
  machine-generated — PocketBase ids are 15-char alphanumeric, `ts_unix` is a
  decimal integer, and `fields_json` is `fields::serialize_action` output which
  by construction never contains a literal `|`. So one pass splitting on `|`
  recovers the fields uniquely, and the parser stays trivial.
- `parse` rejects a line with anything other than exactly 4 delimiters, a
  version tag other than `v1`, or an empty `learner_id`. An empty
  `attendance_id` is **valid** — that is the first scan of the day, before a
  row exists.
- The `v1` prefix is the forward-compatibility hook: a later firmware can parse
  `v2` lines while still draining `v1` entries left over from a previous boot.

## `roster_format`

`roster_format.h` · `roster_format.cpp` · pure · **`test_roster_format`** (12 cases)

On-disk line format for `/roster.txt`, deliberately the same idiom as
`queue_format` so there is one format convention in the codebase, not two.

```
constexpr char kDelimiter = '|';
constexpr const char* kVersion = "v1";
std::string serialize(const pb_client::LearnerRow&)
bool parse(const std::string& line, pb_client::LearnerRow& out)
std::string normalize_uid(const std::string&)        // lowercase
```

Line shape: `v1|<id>|<nfc_id>|<program>|<name…>`

- **`name` is last, and parsed as "everything after the 4th delimiter".** It is
  the only human-typed field, so it is the only one that can contain a `|`. A
  learner called `Ana | Sofía` therefore round-trips instead of corrupting the
  line and being silently dropped — a failure that would present as that one
  learner's card never working, with no error anywhere.
- The four machine fields are sanitised of `|`, CR and LF; `name` is stripped of
  CR/LF only. A newline inside any field would split one record into two.
- UTF-8 passes through untouched: the parser only looks for ASCII `|`, which
  cannot occur inside a multi-byte sequence.
- **A row with an empty `nfc_id` is accepted** — PocketBase legitimately holds
  learners with no card issued. They never match a scan, because
  `roster::lookup_by_uid` refuses to match on empty.
- `normalize_uid` lowercases on **both** write and lookup. `nfc.cpp` emits
  lowercase, but `NFC_ID` is free text in the dashboard, so a guide pasting an
  uppercase UID would otherwise create a card that never matches with nothing
  to explain why.

## `queue_core`

`queue_core.h` · `queue_core.cpp` · pure · **`test_queue_core`** (14 cases)

All offline-queue behaviour: caps, ordering, dead-lettering, corrupt-line
recovery, compaction. Talks to storage only through `LineStore`.

```
constexpr size_t kMaxEntries = 400;
constexpr size_t kMaxBytes   = 64 * 1024;
using Writer = std::function<WriteOutcome(const queue::PendingScan&)>;

class Queue {
  Queue(LineStore& live, LineStore& dead);
  bool load(int& out_skipped);
  bool append(const queue::PendingScan&, int& out_dropped);
  int  drain(const Writer&);                       // returns count written
  size_t size() const;  bool empty() const;
  const std::vector<queue::PendingScan>& entries() const;
};
```

The caps are derived, not chosen: ~80 learners × up to five taps each
(check-in, lunch out/in, late return, check-out) is ~400 entries for a fully
offline day, and a `v1` line is ~120–200 B, so 400 entries is ~64 KB. LittleFS
is 896 KB (`hardware/partitions.csv`), so the queue tops out at ~7% of the
filesystem — it must never be the thing that fills the disk and takes the
roster cache down with it. The 400-entry peak is ~80 KB of heap, reachable only
while offline, when no `WiFiClientSecure` is allocated, so it does not stack
with the ~40 KB TLS handshake peak.

Invariants — each is a test:

| Invariant | Why | Test |
|---|---|---|
| A corrupt line is skipped and counted, not fatal | A truncated tail (power cut mid-append) must not strand every entry behind it | `test_corrupt_line_is_skipped_not_fatal` |
| `load` rewrites the file when anything was skipped | Otherwise the corrupt line is re-read and re-skipped on every boot forever | same |
| Caps drop the **oldest** first, and report it | An old unsent scan is likelier already stale; check-outs matter more than check-ins | `test_entry_cap_drops_oldest_and_reports_it` |
| Dropping is never silent | Losing attendance data quietly is the failure this module exists to prevent | `test_dropping_is_never_silent` |
| `RetryLater` **stops** the drain | Order must hold: a check-in has to land before the check-out | `test_retry_later_stops_and_preserves_order` |
| `PermanentFail` moves to dead and continues | One deleted row must not wedge every scan behind it | `test_permanent_fail_moves_to_dead_and_continues` |
| A failed compaction costs nothing | The old contents must survive | `test_failed_compaction_leaves_live_store_intact` |
| Survives a reboot | The whole point | `test_survives_reboot` |

## `line_store` (interface and in-memory double)

`line_store.h` · pure (the `LittleFsLineStore` declaration is `#ifndef`-gated) · exercised via **`test_queue_core`**

```
class LineStore {                                   // abstract
  virtual bool append(const std::string& line);
  virtual bool read_all(std::vector<std::string>& out);
  virtual bool replace_all(const std::vector<std::string>& lines);  // atomic
  virtual size_t size_bytes() const;
  virtual bool clear();
};

class InMemoryLineStore : public LineStore {        // header-only test double
  bool fail_next_append, fail_next_replace;
  int  append_calls,     replace_calls;
  const std::vector<std::string>& lines() const;
};
```

- The interface exists so the interesting cases — a corrupt tail, a cap
  dropping the oldest entry, a compaction that fails halfway — are host tests
  rather than hardware sessions. LittleFS only exists on the device, which is
  exactly where these are hardest to provoke.
- `read_all` returns a truncated final line **as-is**. Only the caller knows
  the format, so only the caller can decide whether it parses.
- `replace_all`'s contract is: either the old contents or the new ones survive a
  power cut, never a mixture, and **never nothing**. That last clause is why the
  device implementation is a two-phase rename — see `line_store.cpp` below.
- `InMemoryLineStore::replace_all` leaves the old contents intact when
  `fail_next_replace` is set, matching what a real atomic write-then-rename
  gives. Tests assert on that.
- The header comment used to name "queue_core, roster" as the pure modules
  behind this interface; `roster.cpp` is in fact Arduino-gated with no host
  test, and the comment now says so. See the gap note under `roster`.

## `chunked_source`

`chunked_source.h` · `chunked_source.cpp` · pure · **`test_chunked_source`** (11 cases)

A `ByteSource` decorator that strips HTTP `Transfer-Encoding: chunked` framing.

```
class ChunkedByteSource : public ByteSource {
  explicit ChunkedByteSource(ByteSource& inner);
  int read() override;
  size_t readBytes(char*, size_t) override;
  bool complete() const;    // saw the 0-length terminating chunk
  bool malformed() const;   // bad length line, or stream ended mid-chunk
};
```

- Needed because the streaming parse reads `HTTPClient::getStream()`, which
  hands back the **raw** socket. `HTTPClient` de-chunks only inside
  `getString()` and `writeToStream()` — the two methods being avoided, because
  they are what allocate a full copy of the body. PocketHost sits behind
  Cloudflare (responses carry `cf-cache-status`), so chunked framing on the
  HTTP/1.1 leg is a real possibility, and chunk headers fed to a JSON parser
  produce garbage.
- Wrap when `http.getSize() < 0`, which is how `HTTPClient` reports "no
  Content-Length". `pb_client::ResponseSource` does exactly that.
- **`complete()` and `malformed()` are distinct on purpose.** EOF mid-chunk sets
  `malformed_` rather than reporting a clean end, so a truncated response cannot
  be parsed as a valid-but-short document.
- Handles multi-digit and uppercase hex lengths, `;ext=value` chunk extensions,
  and trailer headers after the terminator (ignored — nothing reads past it).

## `json_source`

`json_source.h` · header-only · **`test_json_source`** (5 cases)

The seam that lets one parser read from a socket on device and a string in
tests.

```
class ByteSource {                                  // abstract
  virtual int read() = 0;                           // -1 at end
  virtual size_t readBytes(char* buffer, size_t length) = 0;
};

class StringByteSource : public ByteSource {        // pure; every test uses it
  explicit StringByteSource(const std::string&);
  size_t consumed() const;                          // tests assert early stop
};

#ifndef LLATTENDER_NATIVE_BUILD
class StreamByteSource : public ByteSource {        // device only
  explicit StreamByteSource(Stream&);               // HTTPClient::getStream()
};
#endif
```

- The two methods are exactly what ArduinoJson's generic `Reader` requires.
  That reader stores a **pointer** and calls through it — documented as "a
  simple wrapper for Readers that are not copyable" — so an abstract base with
  virtual `read`/`readBytes` works: nothing slices, nothing is copied, and the
  calls dispatch virtually. `test_json_source` verifies precisely this, and is
  deliberately the first test in the area: the whole streaming design rests on
  it.
- Consequence: `pb_response` needs no `#ifdef` at all. One code path, both
  worlds.
- `StringByteSource` **holds a reference** to the string. Do not hand it a
  temporary.

## `clock_gate`

`clock_gate.h` · header-only, pure · **`test_clock_gate`** (4 cases)

Whether the device is allowed to record attendance yet.

```
inline bool may_write_attendance(bool ntp_synced, bool override_active) {
  return ntp_synced || override_active;
}
```

- One `inline` function gets its own header because it is a **policy decision**,
  and policy needs a name, one home, and tests, rather than being an `if` buried
  in a FreeRTOS task where it cannot be reached.
- Why it exists: there is no RTC, so at power-on the ESP32 believes it is
  1970-01-01 until NTP succeeds. Every state-machine threshold is time-of-day
  based, so acting on that clock silently marks everyone `present` and stamps
  PocketBase rows with a 1970 date, which then has to be unpicked by hand.
  Being visibly unavailable for the first thirty seconds is cheaper than being
  confidently wrong all morning.
- It is also a hard prerequisite for TLS pinning: with a CA configured, mbedTLS
  enforces `notBefore`, and a 1970 clock fails every handshake. Pinning could
  not land before this did.
- **The serial override counts as trusted**, deliberately. `t 09:30` means "I,
  the operator, am asserting the time", which is the assurance the gate wants,
  and it must keep working with no network.
- Header-only, so it needs no `build_src_filter` entry — only a `test_filter`
  one.

## `pb_result`

`pb_result.h` · header-only, pure · **`test_pb_result`** (8 cases)

HTTP status → retry policy.

```
enum class WriteOutcome { Ok, RetryLater, PermanentFail };
inline WriteOutcome classify_http_status(int code);
```

| Code | Outcome | Reason |
|---|---|---|
| `< 0` | `RetryLater` | `HTTPClient` transport errors: refused, timeout, TLS failure |
| 200, 201, 204 | `Ok` | written |
| 400 | `PermanentFail` | malformed body — our bug; retrying cannot fix it |
| 403 | `PermanentFail` | collection rules reject this device account |
| 404 | `PermanentFail` | row deleted server-side, or a bad id |
| 401 | `RetryLater` | token expired; worth one re-login, so keep the entry |
| 408, 429 | `RetryLater` | timeout; PocketHost's 1000/hour per IP |
| anything else | `RetryLater` | 5xx and unknown — assume the server might recover |

- Why classification exists at all: treating every failure as retryable means a
  PATCH for a deleted row 404s on every cycle forever, and because a failed
  drain stops at the head of the queue, **one deleted row wedges the whole
  queue** and quietly burns the request budget.
- The default direction is deliberate. A retried write is wasted effort; a
  discarded one is attendance data that silently never existed.

## `jwt`

`jwt.h` · `jwt.cpp` · pure · **`test_jwt`** (12 cases)

Extracts the `exp` claim so `pb_client` can decide whether a cached token is
worth trying.

```
bool extract_exp(const std::string& token, std::time_t& out_exp);
bool base64url_decode(const std::string& in, std::string& out);   // RFC 4648 §5
bool is_usable(const std::string& token, std::time_t expires_at,
               std::time_t now, std::time_t skew_seconds = 300);
```

- **It does not verify the signature, on purpose.** The device is not making an
  authorization decision — it is asking "is the token I hold worth trying, or
  should I log in first?" A forged token is simply rejected by PocketBase, and
  the 401 path handles that. Verifying would mean shipping the server's signing
  key to a device on a front desk: a real secret traded for no benefit.
- Every failure mode returns `false`, meaning "log in again", which is always
  safe.
- `is_usable` also returns `false` when `now <= 0` — an unknown clock refuses
  rather than guessing.
- The 5-minute default skew covers a token expiring between the check and the
  request, which would otherwise produce a 401 the caller has to recover from.
- Payload parse uses an ArduinoJson filter of just `exp`, so a large token
  (PocketBase can embed the whole user record) allocates only the one number.
- Caching the token removes a full TLS login round-trip per boot — the slowest
  thing between power-on and the first usable tap — and sends the account
  password over the wire far less often.

---

# Hardware and network

Device only. All of these are wrapped in `#ifndef LLATTENDER_NATIVE_BUILD` (or
are headers included only from files that are), none appear in
`build_src_filter`, and **none has a host test**. What verification exists is
the on-device checklist in the [README](../README.md#verification) and
[`OPERATIONS.md`](OPERATIONS.md).

## `main.cpp`

`main.cpp` · device only · device-verified only · 806 lines

Bootstrap, the four FreeRTOS tasks, and the whole serial console. `loop()`
stays empty of real work — it only runs the console.

### The four tasks

| Task | Core | Prio | Stack | Job |
|---|---|---|---|---|
| `nfc` | 0 | 5 | 4096 | `nfc::poll_uid` on a 50 ms loop, push `ScanMsg` to `g_scan_q` |
| `proc` | 1 | 4 | 8192 | UID → learner, clock gate, state machine, cache update, queue append |
| `ui` | 1 | 3 | 4096 | Drain `g_ui_q` into `ui::show` + `buzzer::cue`, then `ui::tick()` |
| `net` | 0 | 3 | 8192 | WiFi edges, NTP retry, OTA pump, queue drain, delta poll |

Three inter-task queues, all created in `setup()` before any task starts:

| Queue | Depth | Payload | Note |
|---|---|---|---|
| `g_scan_q` | 32 | `ScanMsg` (24 B `uid_hex`) | 32, not 8: the ~80-learner arrival rush can burst faster than `proc` runs the state machine. Under 1 KB total |
| `g_ui_q` | 16 | `UiMsg` (event + 64 B name) | |
| `g_flush_signal` | 4 | `int64_t` | Any-value wake for `net`, so a tap drains within milliseconds instead of waiting out the 5 s timeout |

**The tap path never touches the network.** `proc` reads the today-cache only
(`pb_client::lookup_today_row`, which does no I/O) and appends to the durable
queue; `net` creates rows, recomputes cache-miss entries against the
authoritative row, and PATCHes. At ~80 learners the morning rush is ~80
consecutive cache misses, and a synchronous handshake per tap (~2 s for a GET
plus a POST) would overrun `g_scan_q` and drop taps silently.

A dropped tap is never silent: `xQueueSend` with a 0 timeout that fails logs
`[nfc] scan queue full — tap dropped` and posts `ScanBusy`, because a learner
who gets no feedback walks away believing they signed in.

### `setup()` boot order

Each step, in order, with what it prints:

| # | Step | Boot log |
|---|---|---|
| 1 | `Serial.begin(115200)`, 200 ms settle | `[boot] LearnLife NFC Attender starting` |
| 2 | Version + build stamp | `[boot] version 1.0.0 (build …)` |
| 3 | `esp_reset_reason()` | `[boot] reset reason: power-on` |
| 4 | Create the three inter-task queues | — |
| 5 | `LittleFS.begin(formatOnFail=true)` | `[fs] LittleFS mounted` or `[fs] LittleFS mount failed — persistence disabled` |
| 6 | `nfc::probe_i2c_lines()` | `[i2c] line pullups: …`, then on failure a GPIO sweep and a 10 s watch window |
| 7 | `ui::init()` | `[ui] SSD1306 init ok` / `not found at 0x3C — running headless` |
| 8 | `nfc::scan_i2c()` | `[i2c] scanning bus...`, `[i2c] 0x24 (PN532)`, `[i2c] 0x3C (SSD1306)` |
| 9 | `buzzer::init()` + startup chirp | `[buzzer] init ok (pin 25)` |
| 10 | `time_sync::init()` — sets `TZ`, does **not** set the clock | `[time] init (TZ=Europe/Madrid)` |
| 11 | `config::check_factory_reset_command()` — 2 s window | `[config] type 'RESET' within 2s to factory-reset` |
| 12 | `config::load` | — |
| 13 | If unprovisioned: `config::run_provisioning()` — **never returns** | the setup banner |
| 14 | `nfc::init()` | `[nfc] PN532 firmware N` or `[nfc] PN532 not found…` + `ui::set_reader_error(true)` |
| 15 | `roster::init()` — from LittleFS, before WiFi | `[roster] loaded N learners from disk (offline-ready)` |
| 16 | `queue::init()` — restore pending scans from disk | `[queue] init ok — N pending on disk` |
| 17 | `ui::set_pending_count(queue::size())` | — |
| 18 | `WiFi.mode(WIFI_STA)`, bracketed by two prints | `[wifi] powering radio` / `[wifi] radio up` |
| 19 | `WiFi.begin` if an SSID is saved | `[wifi] associating with '…'` |
| 20 | `pb_client::init()` — creates the state mutex | `[pb] FATAL: …` only on failure |
| 21 | `xTaskCreatePinnedToCore` ×4 | `[boot] tasks running` |

### The four ordering constraints that are load-bearing

1. **`probe_i2c_lines()` (6) must precede `ui::init()` (7).** The first
   `Wire.begin()` hands SDA/SCL to the I2C peripheral and enables the ESP32's
   internal pull-ups. The probe measures whether anything *external* holds each
   line high; internal pull-ups would mask exactly that, and every run would
   report healthy wiring.

2. **`scan_i2c()` (8) must precede `nfc::init()` (14).** A failed PN532 probe
   leaves the ESP32 I2C peripheral wedged; after that nothing ACKs. A scan taken
   on the failure path would report an empty bus and blame the shared
   SDA/SCL/3V3/GND wiring for a fault confined to the PN532. Running the scan
   here also puts it *before* provisioning (13), which never returns — so the
   bus inventory is visible on exactly the devices being set up for the first
   time. `ui::init()` has already brought `Wire` up by then.

3. **`roster::init()` and `queue::init()` (15, 16) must precede WiFi (18).** The
   roster loads from LittleFS, so a cold boot on a slow-router morning still
   resolves every card to a name. Previously the roster was RAM-only and
   populated solely on the offline→online edge, which made all 61 cards read
   "Unknown card" during the exact fifteen minutes when everyone arrives. The
   queue restore is the same argument for durability.

4. **`pb_client::init()` (20) must precede task creation (21).** It creates the
   recursive mutex guarding the bearer token, the config snapshot and the
   today-cache — state reachable from `proc` (core 1), `net` (core 0) **and**
   the Arduino loop task running the console. `std::map` and `std::string` are
   not thread-safe, and two of those paths also write `/today.json`. Unguarded
   concurrent access corrupts the heap, which surfaces as an unexplained reboot
   minutes later — the kind of fault that gets blamed on the power supply.

The `WiFi.mode()` bracketing (18) is also deliberate: a marginal supply dies
inside `WiFi.mode()` when the RF front-end powers up, long before a frame is
sent. Without a line either side, that is indistinguishable from a WiFi
problem. See the `brownout` row in
[`../hardware/README.md`](../hardware/README.md#troubleshooting).

### `network_task` cycle

Per iteration:

1. **WiFi state change?** On the offline→online edge: `sync_ntp()`,
   `ota::init()` (idempotent), then `ensure_token()` + `fetch_roster()` +
   `roster::replace()`, then today-cache from `/today.json` if its date matches,
   else a network prefetch. `ui::set_network_error(!online)` on either edge.
2. **Pump OTA** 50 times at 2 ms, so an upload attempt is not left waiting up
   to 5 s for the queue timeout. While `ota::in_progress()`, the task yields the
   whole cycle to the transfer.
3. **Block** on `g_flush_signal` for up to 5 s.
4. **NTP retry** if online and still untrusted, every `kNtpRetryMs` = 30 s.
   Without this, the only attempt is the one on the WiFi edge, so a single
   failed sync (slow DHCP, UDP/123 dropped for the first few seconds) would
   leave the device refusing every tap until a power cycle. On success it
   forces an idle repaint so the real time appears without waiting for a tap.
5. **Drain the queue** if online and non-empty (see below).
6. **Delta poll** every `kDeltaPollMs` = 30 s, preceded by a
   `[heap] free … min …` line — the evidence that the streaming parse fixed the
   OOM rather than moving it. If there is no watermark yet, fall back to a full
   prefetch. If rows changed, repaint idle so a guide sees the reset landed.

`kDeltaPollMs = 30000` is arithmetic, not taste: PocketHost allows 1000
requests/hour per IP and both devices plus the dashboard share the school's
NAT. At 10 s that is 720/h idle — 72% of budget. At 30 s it is 240/h. The cost
is latency: a guide who presses "Reset day" and walks to the reader sees it
within 30 s instead of 10, which is still faster than the walk.

### The drain writer — the subtlest code in the file

The lambda passed to `queue::drain_ex` handles two kinds of entry:

- **`attendance_id` non-empty** — queued against a warm cache, so the fields
  were computed against the authoritative row. Replay them unchanged.
- **`attendance_id` empty** — computed on a cache *miss*, i.e. against an empty
  state, so it cannot have seen a `jLate`/`jAbsent` excusal or a `time_in`
  written by another client. Re-derive the date from `ts_unix` (so an entry that
  survived a midnight rollover still hits its original date), `ensure_today_row`,
  then **recompute** against the authoritative row. If the recomputed action is
  `NoAction` or `Locked`, return `Ok` to drop the entry — the precondition no
  longer holds, and dropping beats overwriting an existing `time_in`.

Then: `patch_attendance_status`, and on 401 `clear_token()` before classifying
(401 is `RetryLater`, so the entry stays). **The cache is updated only after the
write lands.** An optimistic update followed by a `RetryLater` would leave the
cache claiming a `time_in` that was never written, and the retry would then
recompute to `NoAction` and *drop* the check-in.

### Serial console

Full command reference with worked examples:
[`OPERATIONS.md`](OPERATIONS.md#serial-console-reference). Mechanics: `loop()`
reads Serial character by character, echoes each one (`pio device monitor` does
no local echo), accepts `\r` or `\n` as terminator, handles backspace/delete,
and clears the buffer past 64 characters. Commands: `?`/`h`/`help`, `t HH:MM [W]`,
`t off`, `c`, `heap`, `i2c`, `q`, `r`, `tap <uid>`, `ota`, `v`, `w`,
`wifi <ssid>|<pw>`.

`tap <uid>` pushes onto `g_scan_q` exactly as `nfc_task` does, so the injected
scan takes the identical path — roster lookup, clock gate, state machine, queue,
network. The reader is the only part it bypasses, which is what makes it usable
while the hardware is broken.

Module-level state worth knowing: `g_last_learner_id` (the most recently
resolved learner, so `w` can wipe today's row without typing an id) and
`g_nfc_ok` (reported by `v`, because on a unit with no OLED the boot line
scrolls away and the fault glyph has nowhere to render).

## `nfc`

`nfc.h` · `nfc.cpp` · device only · device-verified only

PN532 wrapper and the I2C diagnostics.

```
bool init();                        // false on probe failure
void scan_i2c();                    // enumerate responding addresses
void probe_i2c_lines();             // MUST run before any Wire.begin()
bool poll_uid(std::string& out_uid_hex);
```

- `Adafruit_PN532` is constructed with `irq=-1, reset=-1`. The IRQ line is wired
  to nothing in this build, so **polling is the only path**, not a placeholder
  for an interrupt.
- `poll_uid` uses a **1500 ms time-based debounce keyed on the UID**, not
  absent→present edge detection. The PN532 occasionally returns "no target" for
  one poll while a card is still on the reader; an edge-only debounce counted
  the next detection as a fresh tap and produced duplicates. Same-UID emissions
  inside the window are suppressed regardless of any "not present" blips.
- UIDs are emitted as **lowercase hex**, matching `hex::encode` in the Rust
  Tauri reader and what `roster_format::normalize_uid` expects.
- `readPassiveTargetID` gets a 50 ms timeout, short enough that the task stays
  responsive.
- `probe_i2c_lines` is three escalating checks:
  `line_has_pullup` (drive low, release as no-pull input, look — an external
  4.7 k into ~100 pF recovers in ~470 ns, a floating line stays low for
  milliseconds, so 10 µs is ~20 time constants of margin one way and nowhere
  near enough the other); `line_rises_on_internal_pullup` to separate an open
  circuit from a line held low by a short or reversed power; then
  `sweep_pullups` across every safely drivable GPIO, which catches a DevKit
  seated offset in the breakout by naming which GPIOs the module's pull-ups
  actually landed on. Finally `watch_lines(10000)` holds a 10 s window open and
  reports every transition, so "wiggle the header and watch" becomes a valid
  test for a cold joint — the one-shot probe samples ~700 ms into boot, far too
  early to press and reset simultaneously.
  Excluded from the sweep: 34/35/36/39 (input-only, can never be discharged),
  1/3 (UART0 — driving them destroys this very log), 6–11 (SPI flash), and 0
  (its onboard boot-button pull-up always reads as present).
- **`init()` runs once with no retry.** A failed probe means `nfc_task` polls a
  wedged bus forever and nothing clears `ui::set_reader_error`. See
  [`OPERATIONS.md`](OPERATIONS.md#known-gaps).

## `ui`

`ui.h` · `ui.cpp` · device only · device-verified only

SSD1306 OLED rendering and the display state machine.

```
enum class Event { Boot, Idle, CheckInPresent, CheckInLate, LunchOut, LunchIn,
                   LunchInLate, CheckOut, AlreadyDone, AlreadyIn, ScanLocked,
                   UnknownCard, ScanBusy, WaitingClock, Queued, NetworkError };
bool init();
void show(Event, const char* learner_name = nullptr);
void set_network_error(bool);
void set_reader_error(bool);
void set_pending_count(int);
void show_provisioning(const std::string& ssid, const std::string& password);
void tick();                        // from ui_task; cheap when nothing changed
```

Six internal modes — `Boot`, `Idle`, `Action`, `Unknown`, `WaitingClock`,
`Provisioning`. Action feedback lasts `kFeedbackMs` = 2000 ms then reverts to
idle; the boot splash lasts 1500 ms; `Provisioning` is persistent
(`mode_until_ms = 0`) because it must stay readable for as long as it takes
someone to type the password into a phone.

- **`init()` probes `0x3C` itself before trusting the driver.**
  `Adafruit_SSD1306::begin()` never touches the bus to check — it returns false
  only if the framebuffer malloc fails, then blind-writes the init sequence with
  no ACK check. Left alone it reports "init ok" with no display attached, which
  is worse than silence: it certifies the I2C bus as healthy and sends whoever
  is debugging the PN532 to the wrong end of it. A failed probe means
  `g_have_oled = false` and the device runs headless — every render is a no-op,
  and Serial is the only surface.
- **`set_reader_error` is deliberately not a reuse of `set_network_error`.**
  `network_task` clears the network flag on every WiFi state change, so a device
  whose PN532 never came up showed a clean screen within seconds of boot. A dead
  reader is the one fault that makes the device completely useless while looking
  completely fine. The reader glyph is drawn top-**left**, steady, before the
  network early-return, so a network outage can never hide it; the WiFi glyph is
  top-right and blinks, because connectivity comes back by itself.
- **The pending count replaces the date line**, not squeezed in beside it. The
  date is decoration; scans sitting undelivered is the thing a guide must see,
  because a device that records but never uploads looks exactly like one that is
  working. `READER FAULT` outranks it in words, because undelivered scans arrive
  late whereas a dead reader records nothing at all.
- **Idle shows `--:--` / "Waiting for clock" until `time_sync::is_synced()`.**
  Rendering the 1970 clock as a confident `01:00` would give a guide no reason
  to suspect anything.
- ASCII only — the SSD1306 classic font has no em dash. Verdict text is drawn at
  size 2 up to 10 characters (12 px each, 120 of 128 px) and drops to size 1
  beyond that; 11 characters at size 2 clipped.
- `Event::NetworkError` passed to `show()` returns immediately — it is routed
  through `set_network_error` instead. `Event::Queued` only sets the
  `(offline)` sticky flag.
- Header comment referenced a plan file outside the repo; corrected to point at
  this document.

## `buzzer`

`buzzer.h` · `buzzer.cpp` · device only · device-verified only

```
bool init();                        // pin 25, chirps once to prove the path
void beep(int freq_hz, int duration_ms);    // blocking — UI task only
void cue(ui::Event);                        // no-op for silent events
```

- GPIO 25, driven by Arduino `tone()`, which works for both passive (PWM makes
  the sound) and active (PWM gates the internal oscillator) buzzers.
- Three tones chosen to be told apart by ear: 2000 Hz OK, 1200 Hz mid,
  600 Hz problem. Late is a double 1200 Hz chirp; `ScanLocked` is a double
  600 Hz buzz, distinct from the single 600 Hz of `UnknownCard`.
- `UnknownCard`, `ScanBusy` and `WaitingClock` share the same 250 ms low buzz.
  From the learner's point of view all three mean "that tap did not count";
  what matters is that it is unmistakably *not* a success cue.
- Every cue **blocks** its caller (`tone` + `delay` + `noTone`), which is why it
  runs only from `ui_task`. The line is pulled low afterwards so an active
  buzzer does not hum on residual charge.

## `time_sync`

`time_sync.h` · `time_sync.cpp` · device only · device-verified only

```
bool init();                        // sets TZ; does NOT set the clock
bool sync_ntp();                    // configTime + up to 2 s wait
std::time_t now_unix();
std::tm     now_local();            // tm_wday populated
bool is_synced();                   // latches true
void set_time_override(int hour, int minute, int wday = -1);
void clear_time_override();
bool has_time_override();
```

- **There is no DS3231.** The timebase is NTP plus the ESP32's internal clock;
  `clock_gate` covers the boot window by refusing to record until the clock is
  trustworthy. Header comments claiming an RTC source of truth were stale and
  have been corrected.
- `is_synced()` returns true once `::time(nullptr) > 1700000000`
  (2023-11-14 — comfortably after 1970 and before this device existed) and then
  **latches**. A later NTP failure means slight drift, not a reversion to 1970,
  and refusing to work over a transient failure would be worse.
- It deliberately reads `::time()` rather than `now_unix()`: it asks whether the
  *real* clock is set, and `now_unix()` applies the override shift, which would
  let `t 09:30` on a 1970 clock look like a genuine sync. The override is
  accounted for separately, in `clock_gate`.
- **The timezone is compiled in**: `CET-1CEST,M3.5.0,M10.5.0/3` (Europe/Madrid),
  set in `init()` and re-applied after every `configTime()` because
  `configTime` resets `TZ` to UTC. Without a `TZ`, `localtime()` returns UTC and
  every threshold shifts an hour, letting late tappers through. A second site in
  another timezone is a firmware rebuild — see
  [`OPERATIONS.md`](OPERATIONS.md#known-gaps).
- `sync_ntp` polls `pool.ntp.org` and `time.google.com`, then waits up to
  20 × 100 ms for the clock to become plausible.
- `now_unix()` under an override shifts the **epoch** by the difference between
  real and overridden local time-of-day, so the ISO timestamps written to
  PocketBase reflect the simulated clock rather than real wall time. `now_local`
  additionally forces `tm_wday` when a weekday was given — the one piece that
  cannot be derived from a shifted unix time, and what makes the Friday
  check-out rule testable on a Monday.

## `config`

`config.h` · `config.cpp` · device only · device-verified only

NVS-persisted device configuration and the provisioning flows.

```
struct DeviceConfig { wifi_ssid, wifi_pw, pb_url, pb_email, pb_password,
                      device_id, device_name, ota_password, token,
                      token_expires };
std::string derive_device_id();     // last 4 hex of MAC, lowercase
bool load(DeviceConfig& out);
bool save(const DeviceConfig&);
bool is_provisioned();              // wifi_ssid AND pb_email non-empty
bool run_provisioning();            // blocks; reboots from inside
bool wipe_nvs();
void check_factory_reset_command(); // 2 s Serial watch for "RESET"
```

NVS namespace `llattender`, via `Preferences`. Keys are abbreviated where the
struct field is longer (`dev_name`, `ota_pw`, `tok_exp`) — NVS keys have a
15-character limit. NVS keeps its offset across a repartition, so
**provisioning survives a reflash**.

- Two provisioning paths. `run_provisioning()` prints a banner and waits 3 s: any
  keystroke on Serial drops into `run_serial_provisioning_fallback()`, otherwise
  it enters `run_web_provisioning()`, which **never returns** — it reboots from
  inside on save or on the 10-minute timeout.
- **The AP is password-protected with a per-boot random password.** This AP
  accepts the PocketBase device account password over plain HTTP; left open on a
  school WiFi it would be the weakest link in the system. 8 characters from a
  56-character alphabet is ~46 bits, and WPA2 rate-limits handshakes anyway. A
  shoulder-surfed password is useless after the next restart.
- `random_password` uses `esp_random()`, not `random()`. `random()` without an
  explicit seed produces the **same sequence on every boot of every device**; a
  predictable AP password would be no better than an open one. The alphabet
  omits `0/O` and `1/l/I` because this gets read off a 0.96" OLED and typed into
  a phone, and a password nobody can transcribe gets replaced with something
  weak.
- **The OTA password is generated once and displayed exactly once**, on the
  confirmation page (or the serial equivalent). It is never shown again — not on
  the OLED, not by `ota`, not over serial. Losing it means re-provisioning.
- The serial fallback also fills `device_id` and `ota_password`. Without those
  two lines the unit gets `ota::init` bailing out and its hostname degrading to
  `ll-attender-unknown`, recoverable only by re-provisioning — and the serial
  path is the bring-up escape hatch, which is exactly when a permanently
  USB-only device hurts most.
- The setup form and confirmation page are inline `PROGMEM` strings, not files
  on LittleFS, because provisioning has to work on a unit whose filesystem
  failed to mount — which is exactly when the setup page matters.
- A catch-all `DNSServer` on port 53 plus a 302-everything `onNotFound` makes
  iOS/Android/Windows captive-portal detection land on the form.
- **`/save` validates only that fields are non-empty and never
  test-authenticates the PocketBase credentials.** A typo surfaces much later as
  a repeating `[pb] login HTTP 400`, with nothing on the UI. See
  [`OPERATIONS.md`](OPERATIONS.md#known-gaps).

## `pb_client`

`pb_client.h` · `pb_client.cpp` · device only · device-verified only · 705 lines

Every HTTPS call to PocketBase, the bearer token, and the today-cache.

```
struct LearnerRow    { id, name, nfc_id, program };
struct AttendanceRow { id, learner_id, date, time_in, time_out,
                       lunch_events_json, status, lunch_status,
                       lunch_out_legacy, lunch_in_legacy, updated };

void init();                        // create the mutex — from setup() only
bool login();
bool ensure_token();                // prefer this: reuses NVS token
void clear_token();
bool fetch_roster(std::vector<LearnerRow>& out);
bool prefetch_today_attendance(const std::string& date);
bool refresh_today_delta(const std::string& date, int& out_changed);
bool load_today_cache_from_disk(const std::string& date);
void clear_today_cache();
bool ensure_today_row(learner_id, date, AttendanceRow& out, bool& created);
bool lookup_today_row(learner_id, date, AttendanceRow& out);   // cache only
bool patch_attendance(id, fields_json);
int  patch_attendance_status(id, fields_json);                 // HTTP status
void update_today_cache_after_action(learner_id, const CheckInAction&);
```

Module state, all behind one recursive mutex: `g_token` + `g_token_exp`,
`g_cfg` + `g_cfg_loaded`, `g_today_rows` (`std::map` keyed by `learner_id`),
`g_today_date`, `g_updated_watermark`.

- **`lookup_today_row` performs no network I/O.** That is its contract, and it
  is what lets `processor_task` run without ever blocking on TLS. A miss means
  no row existed server-side as of the last delta poll (≤30 s old), and
  `network_task` creates it during drain.
- **The watermark is fixed-width lexicographic.** PocketBase datetimes are
  `YYYY-MM-DD HH:MM:SS.sssZ`, so string comparison is chronological and needs no
  parsing. It advances **only** from values PocketBase returned — never from
  device time, because the device clock can lag the server's and a locally-set
  watermark would permanently skip every row modified inside that gap. It is
  cleared on a day change, since carrying yesterday's across midnight would make
  the new day's first delta poll return nothing.
- **Provisional cache rows have an empty `id`.** They are inserted by
  `update_today_cache_after_action` on a cache miss so the learner's *second*
  tap reads the predicted state instead of re-missing and queueing a duplicate
  check-in. They are skipped by `persist_today_cache`, and `ensure_today_row`
  falls through past them to the GET/POST — both its callers need a real record
  id.
- Pages are fetched at **`perPage=25`, not 500**, in `fetch_roster`,
  `prefetch_today_attendance` and `refresh_today_delta`. With ~61 rows that is
  three requests instead of one, traded against keeping the parser's working set
  small. Deliberate.
- **TLS is pinned** via `client.setCACert(kPocketHostRootCA)` in `open_https`.
  Timeouts: 8 s connect, 8 s request, 15 s handshake — the handshake is the slow
  part of a pinned connection, and the default is tighter than an ESP32 chain
  verification on a congested network needs.
- `read_body` (via `getString()`) is used only for login and single records.
  List pages go through `ResponseSource`, which constructs both a
  `StreamByteSource` and a `ChunkedByteSource` and hands out whichever
  `http.getSize() < 0` selects. Both members are constructed either way because
  `ChunkedByteSource` is a few bytes of bookkeeping — cheaper than the branchy
  alternative.
- `patch_attendance_status` returns `-1` when not logged in (transient, matching
  `HTTPClient`'s negative convention) and `400` for an empty id, so such an
  entry is dead-lettered rather than retried forever.
- **A failed mutex creation prints `[pb] FATAL` and continues unlocked, by
  design** — `Lock` tolerates a null mutex because the right behaviour for a
  device on a front desk is to keep working rather than hard-fault. See
  [`OPERATIONS.md`](OPERATIONS.md#known-gaps).

## `queue`

`queue.h` · `queue.cpp` · device only · behaviour covered by **`test_queue_core`**

Arduino wiring for the durable queue: two `LittleFsLineStore`s, one
`queue_core::Queue`, one recursive mutex. No decisions.

```
struct PendingScan { learner_id, attendance_id, fields_json, ts_unix };
bool init();
bool append(const PendingScan&);
int  drain_ex(const std::function<WriteOutcome(const PendingScan&)>&);
int  size();
void debug_dump(int max_entries = 5);   // backs `q`
```

- `/queue.jsonl` live, `/queue.dead.jsonl` dead-letter.
- The mutex is required because `append` runs on `processor_task` (core 1) while
  `drain` runs on `network_task` (core 0), and both mutate the same in-memory
  vector and the same file.
- A cap-induced drop logs `[queue] FULL — dropped N oldest … These scans are
  LOST.` with the caps spelled out. The old in-RAM queue dropped the oldest
  entry with a single `println` and no count.
- Skipped lines at load log `[queue] dropped N unparseable line(s) — likely a
  power cut mid-write`. That count is the only evidence that will ever exist
  that a scan was lost.
- `debug_dump` also reports dead-letter **bytes**, not entries — there is no
  parse of that file, and no command to read or clear it. See
  [`OPERATIONS.md`](OPERATIONS.md#known-gaps).

## `roster`

`roster.h` · `roster.cpp` · device only · **no test at all**

In-memory + `/roster.txt`-backed cache of the learners list.

```
bool init();                        // load from disk, before WiFi
bool replace(const std::vector<pb_client::LearnerRow>& items);
const pb_client::LearnerRow* lookup_by_uid(const std::string& uid_hex);
bool ready();
int  count();
std::time_t age_seconds();          // -1 if never loaded
void debug_dump(int max_items = 5); // backs `r`
```

- **`replace` refuses an empty roster.** A permissions change or an empty page
  would otherwise wipe the cache and leave the device unable to identify
  anyone — worse than a slightly stale copy.
- If `replace_all` fails, RAM is still correct so the device works today; it logs
  `WARNING: cached N learners in RAM but failed to persist` because the state
  will not survive a reboot.
- `lookup_by_uid` normalises both sides through `roster_format::normalize_uid`
  and **refuses to match an empty UID**, so a learner with no card issued can
  never be handed back for an empty scan.
- Recursive mutex, because `lookup_by_uid` runs on `processor_task` and
  `replace` on `network_task`.
- **Two real gaps here.** (1) There is no host test at all: `roster.cpp` is
  Arduino-gated, so refuse-empty-replace, UID normalisation on lookup, and
  never-match-empty-UID are all unexercised.
  (2) `g_loaded_at` is stamped from `time_sync::now_unix()` in `init()`, which
  runs *before* NTP, so the age reported by `r` is meaningless until the clock
  is trusted. Both in [`OPERATIONS.md`](OPERATIONS.md#known-gaps).
- The header comment used to say "refreshed once per day"; the actual trigger
  is the offline→online WiFi edge only, and the comment now says so.

## `ota`

`ota.h` · `ota.cpp` · device only · device-verified only

ArduinoOTA over the local network.

```
bool init(const std::string& device_id, const std::string& password);
void tick();                        // from network_task; cheap when idle
bool in_progress();
std::string hostname();             // ll-attender-<device_id>
```

- **Fails closed.** An empty password logs `[ota] no OTA password provisioned —
  OTA disabled` and returns false without opening the port. An unauthenticated
  OTA port on a school network is remote code execution for anyone who runs a
  port scan; being un-updatable is the lesser problem.
- ArduinoOTA is given `setPasswordHash(md5(password))`, so the plaintext is held
  only briefly during `init()` rather than living in a static for the process
  lifetime.
- LAN-only by design — the device never fetches updates from the internet.
- mDNS advertises `_arduino._tcp` on 3232 as `ll-attender-<id>.local`, so the
  uploader finds the device by name instead of chasing a DHCP address. An mDNS
  failure logs and falls back to "use the IP address".
- `in_progress()` is checked by `processor_task`, which drops scans during a
  flash: a tap acknowledged on the OLED and then wiped by the reboot is worse
  than not reading the card. `onEnd` deliberately does **not** clear the flag —
  the device reboots from there, and clearing it would briefly let scans
  through.
- Progress repaints only every 5%: the OLED shares the I2C bus with the NFC
  reader, and redrawing hundreds of times during a flash would slow the transfer
  for no benefit.
- `U_SPIFFS` in the start log means a **filesystem** image, which wipes the queue
  and roster; a firmware image does not. Worth distinguishing.
- It shipped before CA pinning on purpose: if PocketHost ever changes issuer, a
  device with a pinned CA and no OTA has to be physically opened.

## `line_store.cpp`

`line_store.cpp` · device only · **no direct test** (behaviour mirrored by `InMemoryLineStore` in `test_queue_core`)

`LittleFsLineStore` — the filesystem adapter. Deliberately thin: all the
branching lives in `queue_core`.

- **`replace_all` is a two-phase rename, not remove-then-rename.** LittleFS
  refuses to rename over an existing file, and the obvious workaround — remove
  the target first — leaves an instant in which the only complete copy of the
  queue sits under a temp name nothing looks for on boot. A power cut there
  loses every undelivered scan, which is exactly what `line_store.h` promises
  cannot happen. Sequence: write `<path>.tmp` → rename `<path>` to `<path>.old`
  → rename `<path>.tmp` to `<path>` → remove `<path>.old`. Every crash point
  leaves at least one complete copy under a name `recover()` knows.
- A failed second rename rolls back from `.old`, so a failed compaction costs
  nothing. If the rollback itself fails, both files are left in place
  deliberately — they are all that remains.
- **`recover()` is called lazily from every public method**, not once from
  `setup()`, and does its work on the first call per boot. A recovery step that
  has to be wired in by hand is one that gets forgotten the day a third store is
  added. Its three cases: live file present → both leftovers are stale, drop
  them; no live file but `.old` present → crashed between the renames, restore
  `.old` (the choice needing no assumption about how far the new write got); 
  neither → discard an orphan `.tmp`, since "the old contents survive" is
  trivially satisfied when they were empty.
- `read_all` treats an absent file as empty rather than an error, strips `\r`,
  skips blank lines, and returns a newline-less final line as-is.
- A short write logs "disk full?" plainly — a silent short write here means a
  scan is acknowledged on screen and never reaches PocketBase.
- `.tmp`/`.old` suffixes keep every path inside LittleFS's 31-character name
  limit (`/queue.dead.jsonl.tmp` is the longest at 21).

## `pb_ca.h`

`pb_ca.h` · device only (included from `pb_client.cpp`) · device-verified only

```
inline const char* kPocketHostRootCA;   // PEM, NUL-terminated
```

The pinned root for `https://learnlife.pockethost.io`: **GTS Root R4**,
self-signed, SHA-256 `34:9D:FA:40:…:3C:7D`, valid until 2036-06-22, fetched
from `https://i.pki.goog/r4.crt` rather than scraped from the connection.

- Before pinning, `pb_client` called `setInsecure()` — the device would hand its
  PocketBase account password to anything that answered on the right host,
  including a laptop running a rogue AP named after the school WiFi. A
  fifteen-minute attack with a €30 device.
- **It is Google Trust Services, not Let's Encrypt.** Pinning ISRG X1 — the
  reflexive choice for a small hosted service — would have failed every
  handshake. The chain as served is
  `*.pockethost.io` ← `GTS WE1` ← `GTS Root R4` ← `GlobalSign Root CA`
  (cross-sign); R4 is a trust anchor here, so the chain terminates there and the
  cross-sign is unnecessary. Confirmed with
  `openssl verify -CAfile r4.pem -untrusted chain.pem leaf.pem`.
- **Operational risk:** if PocketHost changes CA, every device goes offline
  until reflashed. That is why OTA shipped first. Diagnosis command and the
  clock dependency are in
  [`OPERATIONS.md`](OPERATIONS.md#symptom-to-cause).

## `version.h`

`version.h` · header-only · not tested

```
inline constexpr const char* kFirmwareVersion = "1.0.0";
```

Bumped **by hand**. There is no release pipeline — the deployment flow is a
local `pio run` plus a USB or LAN OTA push, so a generated version would have
nothing to generate from. Printed in the boot banner and by `v`, and recorded in
the device register at assembly
([`../hardware/README.md`](../hardware/README.md) step 11). Header-only, so it
needs no `build_src_filter` entry.
