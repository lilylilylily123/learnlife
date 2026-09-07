# nfc-attender-fw

Standalone ESP32 firmware for LearnLife NFC attendance. Replaces the Mac/Tauri
kiosk in `apps/nfc-attender` with a self-contained desk device that talks
straight to PocketBase — no computer in the loop.

The Tauri app remains the **dashboard**: history, justifications, bulk edits,
CSV export. This device is the **tap terminal**.

---

## Quick start

```bash
# Native unit tests (no hardware needed) — 181 cases
pio test -e native

# Build
pio run -e esp32dev

# Flash over USB + watch the log
pio run -e esp32dev -t upload
pio device monitor

# Flash over WiFi, once a device is provisioned and in the field
pio run -e esp32dev_ota -t upload \
    --upload-port ll-attender-a1b2.local \
    --upload-flags --auth=<ota-password>
```

All `pio` commands in this file run from `apps/nfc-attender-fw/`.

⚠️ **First flash of any device must be over USB.** The custom partition table
(`hardware/partitions.csv`) cannot be applied over the air. See
[Deployment](#deployment).

## Documentation

| Doc | What's in it |
|---|---|
| [`docs/SOURCE_MAP.md`](docs/SOURCE_MAP.md) | Per-module reference for all 46 files in `src/`: exported API, pure/hardware side, covering test suite, invariants. Includes the `main.cpp` boot order and its load-bearing ordering constraints |
| [`docs/TESTING.md`](docs/TESTING.md) | How to run the 13 suites, what each covers, how the host build works, and the procedure for adding a pure module without it being silently skipped |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Runbook for a device in service: provisioning, the boot log line by line, the full console reference, OTA, factory reset, factory-image recovery, symptom-to-cause, and the known gaps |
| [`hardware/README.md`](hardware/README.md) | BOM, wiring table, assembly runbook, and the wiring/I²C troubleshooting table |
| [`hardware/enclosure/README.md`](hardware/enclosure/README.md) | Parametric OpenSCAD case, test prints, print settings |

---

## Hardware

| Part | Interface | Notes |
|---|---|---|
| ESP32-WROOM-32 DevKit V1, **30-pin**, USB-C | — | ELEGOO. 30-pin, not the 38-pin DevKitC |
| 30-pin screw-terminal breakout | — | The DevKit plugs into it; it bolts to the case |
| PN532 V3 NFC module | I²C `0x24` | DIP switches: 1=ON, 2=OFF |
| SSD1306 0.96" OLED, 128×64 | I²C `0x3C` | |
| Piezo buzzer | GPIO 25 | |

**Pin map** — I²C on GPIO 21 (SDA) / 22 (SCL), the Arduino defaults, never set
explicitly. Moving them would require `Wire.begin(sda, scl)` in both
`nfc.cpp` and `ui.cpp`.

Full BOM, wiring table and assembly runbook: [`hardware/README.md`](hardware/README.md).

**Not fitted, deliberately:** DS3231 RTC and RGB status LED. Both appeared in
earlier versions of this file and neither was ever implemented. The RTC's
absence is handled in firmware — see [Clock trust](#clock-trust) — and
`hardware/enclosure/params.scad` keeps parametric hooks (`include_rtc`,
`include_rgb_led`) so adding either later is a re-render, not a redesign.

---

## Architecture

Four pinned FreeRTOS tasks, so the NFC reader keeps responding while the
network task is blocked on TLS:

| Task | Core | Priority | Job |
|---|---|---|---|
| `nfc` | 0 | 5 | Poll the PN532 every 50 ms, debounce, emit UIDs |
| `proc` | 1 | 4 | Resolve UID → learner, run the state machine, queue the write |
| `ui` | 1 | 3 | Drive the OLED and buzzer |
| `net` | 0 | 3 | WiFi, NTP, PocketBase, OTA, queue drain |

A scan flows: `nfc` → scan queue → `proc` (roster lookup → clock gate → state
machine) → UI event + durable queue append → `net` drains to PocketBase.

### Source map

**Pure logic** (compiles and is tested on the host, no Arduino):

| Module | Responsibility |
|---|---|
| `state_machine` | Port of `computeCheckInAction` from `packages/shared/src/attendance.ts` |
| `fields` | Serialises an action into the PocketBase PATCH body |
| `pb_request` / `pb_response` | URL + body construction; streaming JSON parsing |
| `attendance_adapter` | PocketBase row → state-machine input |
| `queue_format` / `roster_format` | On-disk line formats |
| `queue_core` | Queue behaviour: caps, ordering, dead-lettering, recovery |
| `line_store` | Storage interface + in-memory test double |
| `chunked_source` / `json_source` | HTTP chunked decoding; the ByteSource seam |
| `clock_gate` | Whether the clock is trustworthy enough to record |
| `pb_result` | HTTP status → retry policy |
| `jwt` | Token expiry extraction |

**Hardware/network** (device only, excluded from the native build by
`LLATTENDER_NATIVE_BUILD`):

`main` · `nfc` · `ui` · `buzzer` · `time_sync` · `config` · `pb_client` ·
`queue` · `roster` · `ota` · `line_store.cpp` · `pb_ca.h` · `version.h`

The split is deliberate: every non-trivial decision lives in a pure module with
tests, and the Arduino files are thin adapters. That's what makes a power cut
mid-compaction or a corrupt queue line testable at all.

**Per-module reference — API, covering test suite, invariants, and the
`main.cpp` boot order: [`docs/SOURCE_MAP.md`](docs/SOURCE_MAP.md).**

---

## Behaviour worth knowing

### Clock trust

There is no RTC, so at power-on the ESP32 believes it is 1970 until NTP
succeeds. Since **10:01 is the present/late boundary**, acting on that clock
would silently mark everyone `present` with a 1970 timestamp.

So the device **refuses to record anything** until the clock is trusted. The
OLED shows `--:--` / "Waiting for clock", and a tap gets "NOT RECORDED".
NTP retries every 30 s while untrusted.

The serial time override (`t 09:30`) also counts as trusted — that's the
operator asserting the time, and it must keep working offline.

### Offline behaviour

- **Roster** loads from `/roster.txt` *before* WiFi starts, so a cold boot on a
  slow-router morning still resolves every card to a name.
- **Scans** queue to `/queue.jsonl` and survive a power cut. The idle screen
  shows "N waiting to send" whenever the queue is non-empty.
- **Permanent failures** (a row deleted server-side → 404) move to
  `/queue.dead.jsonl` instead of blocking the queue head forever.

### Staying in sync with the dashboard

Every 30 s the device asks PocketBase for rows changed since its watermark
(`updated > …`), so a guide's "Reset day" reaches the device without a reboot.

The interval is derived, not chosen: PocketHost allows **1000 requests/hour per
IP**, and both devices plus the dashboard share the school's NAT. At 10 s that
would be 720/h idle — 72% of budget. At 30 s it's 240/h.

#### Request budget at ~80 learners, two terminals

| Source | Requests/hour |
|---|---|
| Delta sync, 30 s, both devices, always on | 240 |
| Morning rush: ~80 first taps × (GET + POST + PATCH) | ~240, in the arrival hour |
| Lunch window: ~80 × 2 taps, cache hit + PATCH | ~160 |
| Dashboard | negligible — realtime SSE, one long-lived connection, not polling |

**Peak is the arrival hour at ~500/hour against 1000** — about 2× headroom.
That headroom is the binding constraint on a third terminal, which would add
120/h of delta sync plus its own share of taps. **Raise `kDeltaPollMs`
(`main.cpp`) to 60000 before adding one.**

Check the real figure in PocketBase → Settings → Logs after the first live
morning. Expect ~500; investigate above ~800.

---

## Serial console

115200 baud. Type `?` for help.

| Command | Effect |
|---|---|
| `t HH:MM [W]` | Override the clock (W: 0=Sun…6=Sat). Exercises the state machine without waiting for real time |
| `t off` | Clear the override |
| `c` | Clear the local today-cache |
| `q` | Queue depth, pending entries, dead-letter size |
| `r` | Roster size and age |
| `heap` | Free / minimum-ever / largest-block heap |
| `i2c` | Scan the I²C bus and name what answers. The same scan the boot log prints |
| `tap <uid>` | Inject a scan as if a card were read. Takes the identical path — roster lookup, clock gate, state machine, queue, network — so the whole pipeline is exercisable with a broken or absent reader |
| `ota` | OTA hostname and upload command |
| `v` | Firmware version, build stamp, device id/name, PocketBase URL, and whether the PN532 came up |
| `w` | Wipe today's PocketBase row for the last-scanned learner |
| `wifi <ssid>\|<pw>` | Update WiFi credentials and reboot |
| `RESET` (within 2 s of boot) | Wipe NVS and re-enter provisioning |

`heap` is how you verify the streaming parser is holding: watch **min ever**
across several 30 s polls. If it stops falling, memory is stable.

Worked detail for every command, plus the boot log line by line:
[`docs/OPERATIONS.md`](docs/OPERATIONS.md).

---

## Testing

```bash
pio test -e native        # all 181
pio test -e native -f test_queue_core
```

Covers pure logic only. Anything touching Arduino, WiFi or LittleFS is compiled
out — those paths are verified on-device (see [Verification](#verification)).

47 of those 181 cases come from the shared-fixture harness — 41 entries in
`packages/shared/fixtures/attendance-state-machine.json` plus six guard and
report cases. That fixture is the same file the Vitest suite in
`apps/nfc-attender` reads. The attendance rule is implemented
four times across this repo, and the copies had already drifted; a case both
harnesses run is now a case where drift fails a build. Known TS/C++
divergences are pinned rather than hidden — they report `KNOWN DIVERGENT`
instead of failing. Six are recorded, including one (D5) that reproduces on
the device path a self-contradicting write the dashboard was just fixed to
stop making. See [`docs/TESTING.md`](docs/TESTING.md#the-cross-language-attendance-fixture).

⚠️ `build_src_filter` and `test_filter` in `platformio.ini` are **explicit
allow-lists**. A new pure module missing from both is silently never compiled
and never run — it won't fail, it just won't exist.

CI (`.github/workflows/nfc-fw.yml`) runs the tests, builds the firmware with a
size gate against the app partition, and renders every enclosure part headless
to catch a non-manifold mesh before it costs a makerspace booking.

What each of the 13 suites covers, and the procedure for adding a pure module
without it being silently skipped: [`docs/TESTING.md`](docs/TESTING.md).

---

## Deployment

### PocketBase account

One `users` record **per device**, role **`lg`** — required, because `learners`
and `attendance` restrict reads to `lg`/`admin` (see
[`../../pb_hooks/README.md`](../../pb_hooks/README.md)).

Separate accounts per device so a lost unit can be revoked without
re-provisioning the other, and so PocketBase logs distinguish them. If the
collection has *"Forbid authentication for unverified users"* enabled, verify
these accounts manually or `auth-with-password` fails confusingly.

### First flash — USB only

```bash
pio run -e esp32dev -t upload
```

This applies `hardware/partitions.csv` (1536 KB app slots, needed for OTA).
It **cannot** be done over the air.

**Migration warning:** repartitioning reformats LittleFS. `nvs` keeps its
offset so provisioning survives, but `/queue.jsonl` does not — **bring the
device online and confirm `q` reports 0 pending before reflashing a unit that
has been in service.**

### Factory image — reflashing without the PlatformIO project

CI publishes only `firmware.bin` + `firmware.elf`, which is **not** enough to
flash a virgin board: the bootloader and the partition table have to be laid
down too. The `esptool merge_bin` recipe that produces a single recoverable
image, and the warning that flashing it erases NVS, are in
[`docs/OPERATIONS.md`](docs/OPERATIONS.md#factory-image--recovering-a-device-from-a-machine-with-only-esptool).

### Provisioning

1. Power on unprovisioned → the device starts an AP `LL-Attender-XXXX`.
2. The **OLED shows the SSID and a random per-boot password**.
3. Join it; the setup page opens automatically.
4. Fill in WiFi, PocketBase URL, device account, and a device name.
5. **Write down the OTA hostname and password shown on the confirmation
   page — that is the only time either is displayed.**

Setup mode times out after 10 minutes and reboots.

There is also a serial-prompt fallback for when AP mode itself is broken: press
any key within 3 s of the setup banner. Both paths, step by step, in
[`docs/OPERATIONS.md`](docs/OPERATIONS.md#provisioning).

### Updating a deployed device

```bash
pio run -e esp32dev_ota -t upload \
    --upload-port ll-attender-<id>.local \
    --upload-flags --auth=<password>
```

OTA is disabled entirely if no password was provisioned — it fails closed.

Failure modes, and what to do when the password is lost:
[`docs/OPERATIONS.md`](docs/OPERATIONS.md#ota-updates).

---

## Verification

On-device checks the host tests can't cover:

| What | How |
|---|---|
| Clock gate | Boot with WiFi off → "Waiting for clock", taps refused. `t 09:30 1` → taps work |
| Memory | `heap` across several polls; **min ever** should stop falling |
| Live sync | "Reset day" in the dashboard → tap within 30 s → device reflects it |
| **Durability** | Pull WiFi → tap 3 cards → "3 waiting to send" → **pull power** → repower → queue survived → restore WiFi → all 3 land in PocketBase |
| Offline roster | Boot with WiFi off → cards resolve to names, not "Unknown card" |
| TLS pinning | Normal operation works; a deliberately wrong CA fails |
| OTA | `pio run -e esp32dev_ota -t upload` with the lid closed |

The durability test is also the demo.

⚠️ The clock-gate and offline-roster checks need an **already provisioned**
device. `nfc::init()` runs after `config::run_provisioning()`, which never
returns on an unprovisioned unit — so a fresh board has no reader and no tap
path at all. Provision first. This and eight other verified gaps are listed in
[`docs/OPERATIONS.md`](docs/OPERATIONS.md#known-gaps).

---

## Known limitations

- **Card cloning.** UID-only auth is trivially cloneable. See
  [`docs/SECURITY.md`](../../docs/SECURITY.md) at the repo root (audit H-2) —
  unchanged from the Tauri app.
- **Credentials in NVS are plaintext.** Anyone with physical access and
  `esptool` can read the PocketBase device password. Mitigated by per-device
  accounts (revoke one without touching the other); see
  [`docs/SECURITY.md`](../../docs/SECURITY.md).
- **Power cut + router down together.** The device boots in seconds, the router
  takes minutes; during that window taps are refused rather than mis-recorded.
  An RTC would close this.
- **Deleted rows aren't caught by delta sync.** `updated >` can't see a
  deletion. Acceptable because `resetAttendance` updates rather than deletes,
  and the boot/day-change full prefetch repairs any drift.

---

## Layout

```
src/                     firmware — 46 files (docs/SOURCE_MAP.md)
test/                    13 Unity suites, 181 cases, native only
docs/
  SOURCE_MAP.md          per-module reference
  TESTING.md             how to run and extend the suites
  OPERATIONS.md          runbook for a device in service
hardware/
  partitions.csv         flash layout — USB-only, read the warnings
  README.md              BOM, wiring, assembly, wiring troubleshooting
  enclosure/             parametric OpenSCAD case + test prints
.github/workflows/nfc-fw.yml   (at repo root) tests, build, size gate
```
