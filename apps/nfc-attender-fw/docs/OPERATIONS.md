# Operations runbook

Everything needed to bring a device into service, keep it there, diagnose it
when it misbehaves, and recover it when it is bricked — without reading any
source. It is assembled from procedures that were scattered across the
[README](../README.md), plus the boot log and console reference that existed
only in the code.

Two tables here are the ones worth bookmarking:
[the boot log](#reading-the-boot-log), because every line is a checkpoint and
the *absence* of a line is usually the diagnosis; and
[symptom to cause](#symptom-to-cause), for faults that are operational rather
than electrical. Wiring and I2C faults are a different table, in
[`../hardware/README.md`](../hardware/README.md#troubleshooting) — this
document does not duplicate it.

Read alongside: [`SOURCE_MAP.md`](SOURCE_MAP.md) for what a module does,
[`TESTING.md`](TESTING.md) for what is and is not verified.

Unless stated otherwise, `pio` commands run **from `apps/nfc-attender-fw/`**
and the serial console is **115200 baud**.

---

## Before a device exists: the PocketBase account

One `users` record **per device**, with role **`lg`**. The role is required, not
optional: the `learners` and `attendance` collections restrict reads to
`lg`/`admin` (see [`../../../pb_hooks/README.md`](../../../pb_hooks/README.md)),
so a device account without it authenticates fine and then 403s on every read.

Separate accounts per device, so a lost unit can be revoked without
re-provisioning the other, and so the PocketBase logs distinguish them.

If the collection has *"Forbid authentication for unverified users"* enabled,
verify these accounts manually or `auth-with-password` fails in a way that looks
like a wrong password.

---

## Provisioning

A device with no `wifi_ssid` or no `pb_email` in NVS is unprovisioned and enters
setup from `setup()`. **`config::run_provisioning()` never returns** — it
reboots from inside, either on save or on its 10-minute timeout.

### Captive portal (the normal path)

1. Power on. The boot log prints a banner and waits **3 seconds** for a
   keystroke on Serial (that keystroke selects the serial fallback below).
2. The device starts an access point named `LL-Attender-XXXX`, where `XXXX` is
   the last two bytes of its MAC in uppercase hex.
3. **The OLED shows the SSID and a random per-boot password.** That password is
   also printed to Serial. It is regenerated on every boot, so a
   shoulder-surfed one is useless after a restart.
4. Join the AP from a phone. The setup page opens automatically — a catch-all
   DNS server plus a redirect-everything handler makes iOS, Android and Windows
   captive-portal detection land on the form. If it does not appear, browse to
   the IP printed in the log (typically `192.168.4.1`).
5. Fill in: WiFi network and password, PocketBase URL (defaults to
   `https://learnlife.pockethost.io`), the device account email and password,
   and a device name (shown on the boot screen; helps tell two units apart).
6. **Write down the OTA hostname and password from the confirmation page.**
   That is the only time either is displayed — not on the OLED, not by the `ota`
   command, not over serial. Losing the password means re-provisioning to
   generate a new one.
7. The device saves to NVS and reboots.

Setup mode logs a minute-by-minute countdown and reboots after 10 minutes. The
bound is deliberate: a device that drops into setup and is then forgotten would
otherwise sit advertising an access point on a school network for as long as it
stays powered, and rebooting retries the saved credentials, which is usually
what a stuck device needs.

### Serial fallback (when AP mode itself is broken)

Press any key on the serial console within the **3-second** window after the
setup banner. The device then prompts for each field in turn:

```
WiFi SSID:
WiFi password:
PB URL [https://learnlife.pockethost.io]:
PB device email:
PB device password:
```

An empty SSID aborts and boots in degraded mode. On success it prints the same
write-this-down block the web page shows:

```
[config] ── WRITE THESE DOWN — shown only once ──
[config] OTA host:     ll-attender-a1b2.local
[config] OTA password: <12 chars>
[config] ─────────────────────────────────────────
```

The fallback fills in `device_id` and `ota_password` exactly as the web path
does. Without those, OTA would be disabled and the hostname would degrade to
`ll-attender-unknown`, recoverable only by re-provisioning — and the serial path
is the bring-up escape hatch, so that is precisely when it would hurt most.

### After provisioning

`pio device monitor`, then walk the [boot log](#reading-the-boot-log). Then the
end-to-end checks in [the README](../README.md#verification): tap a card,
confirm the name and verdict, confirm the row in the dashboard, then the
durability test (pull WiFi → tap three cards → pull power → repower → restore
WiFi → all three land).

---

## Reading the boot log

Every line in order, with what it tells you. A missing line is as informative
as a present one.

| Line | Meaning |
|---|---|
| `[boot] LearnLife NFC Attender starting` | Serial is up |
| `[boot] version 1.0.0 (build <date> <time>)` | Firmware version (hand-maintained) and compile stamp. Confirms *which* image is running after an OTA |
| `[boot] reset reason: power-on` | Why it restarted. `power-on` / `software` / `external pin` are normal. **`brownout` means the supply or cable cannot hold the rail** (see the hardware table). `panic`, `int watchdog`, `task watchdog` mean a firmware fault — the coredump partition holds the dump |
| `[fs] LittleFS mounted` | Filesystem is up. Durable queue, roster cache and today-cache all work |
| `[fs] LittleFS mount failed — persistence disabled` | **The device boots anyway**, with queue and roster in RAM only. A power cut then loses every undelivered scan. See [known gaps](#known-gaps) |
| `[i2c] line pullups: SDA(D21)=present SCL(D22)=present` | Electrical check before the I2C peripheral claims the pins. `ABSENT` triggers an escalating diagnostic — open-circuit vs held-low, a sweep of every safe GPIO, then a 10-second watch window for wiggling headers. All of that is decoded in the [hardware table](../hardware/README.md#troubleshooting) |
| `[ui] SSD1306 init ok` | OLED found at `0x3C` and initialised |
| `[ui] SSD1306 not found at 0x3C — running headless` | No display. **The device still works** — every render is a no-op and Serial is the only surface. `v` is then the only way to ask whether the reader is alive |
| `[i2c] scanning bus...` then `[i2c] 0x24 (PN532)`, `[i2c] 0x3C (SSD1306)` | Bus inventory. This runs *before* provisioning and *before* the PN532 probe, deliberately, so it is visible on a device being set up for the first time and is not taken on a wedged bus |
| `[i2c] no devices — check SDA=D21, SCL=D22, 3V3, GND` | Nothing ACKs. Note it also reads this when nothing at all is plugged in |
| `[buzzer] init ok (pin 25)` + one chirp | Audio path proven. No chirp with this line present means the buzzer or its wiring |
| `[time] init (TZ=Europe/Madrid)` | Timezone applied. **The clock is not set yet** — this line says nothing about NTP |
| `[config] type 'RESET' within 2s to factory-reset` | The factory-reset window is open |
| *(setup banner)* | Device is unprovisioned. **Everything below this point never prints** — provisioning does not return |
| `[nfc] PN532 firmware <N>` | Reader is alive |
| `[nfc] PN532 not found on I2C bus — see the scan above` + `[boot] NFC init failed…` | Reader is dead. The OLED shows a steady card-with-X glyph and `READER FAULT`; nothing will ever be recorded. There is **no retry** — see [known gaps](#known-gaps) |
| `[roster] loaded <N> learners from disk (offline-ready)` | Cards resolve to names without any network. This is why roster load precedes WiFi |
| `[roster] no cached roster on disk — cards will not resolve until WiFi comes up` | First boot, or the filesystem was wiped. Expected exactly once per device |
| `[roster] skipped <N> unparseable line(s)` | Corrupt roster lines, dropped |
| `[queue] init ok — <N> pending on disk` | `N > 0` means scans survived a power cut and are waiting. The idle screen says so from boot |
| `[queue] dropped <N> unparseable line(s) — likely a power cut mid-write` | `N` scans were lost. **This count is the only evidence that will ever exist** |
| `[store] recover: …` | An interrupted `replace_all` was rolled forward or back. Normal after a power cut mid-compaction |
| `[wifi] powering radio` / `[wifi] radio up` | Bracketed on purpose: a marginal supply dies *inside* `WiFi.mode()` when the RF front-end powers up, before any frame is sent. Dying between these two lines points at the board, not the network |
| `[wifi] associating with '<ssid>'` | Credentials present and association started |
| `[pb] FATAL: could not create state mutex` | Should never appear. The device continues **unlocked** by design — see [known gaps](#known-gaps) |
| `[boot] tasks running` | `setup()` complete; the four tasks are live |

Then, once WiFi comes up (order can interleave):

| Line | Meaning |
|---|---|
| `[time] clock trusted (NTP acquired)` | **The device can now record.** Until this (or a `t` override) every tap is refused with "NOT RECORDED" |
| `[time] NTP sync failed — clock still untrusted` | Retried every 30 s while online. Usually UDP/123 blocked |
| `[net] clock still untrusted — retrying NTP` | The 30-second retry firing |
| `[ota] ready at ll-attender-<id>.local (password required)` | OTA is listening |
| `[ota] no OTA password provisioned — OTA disabled` | Fails closed. Re-provision to generate one |
| `[ota] mDNS failed — use the IP address instead` | Upload by IP rather than hostname |
| `[pb] reusing cached token from NVS (no login needed)` | The fast path: no login round-trip this boot |
| `[pb] login ok — token cached, valid ~<N> min` | Fresh login succeeded |
| `[pb] login HTTP <code>` | Authentication failed. See [symptom to cause](#symptom-to-cause) |
| `[pb] fetched <N> learners` then `[roster] cached <N> learners (memory + disk)` | Roster refreshed. **This happens only on the offline→online edge** |
| `[roster] refusing to replace cache with an empty roster` | A fetch returned nothing; the good cache was kept deliberately |
| `[pb] loaded <N> cached rows from disk for <date>` | Today-cache restored from `/today.json`, no network prefetch needed |
| `[pb] prefetched <N> attendance rows for <date> (watermark …)` | Full prefetch ran. Every learner's first tap of the day is now a cache hit |
| `[heap] free <N> min <N> (pre-poll)` | Printed before every 30-second delta poll. **`min` is the number that matters**: if it keeps falling poll after poll, something is growing |
| `[pb] delta: <N> row(s) changed server-side` | A dashboard edit reached the device |

---

## Serial console reference

115200 baud. `pio device monitor`. Type `?` for the built-in list. The console
echoes each character (`pio device monitor` does no local echo), accepts `\r` or
`\n`, handles backspace, and clears the line past 64 characters.

| Command | Effect |
|---|---|
| `?` / `h` / `help` | List the commands |
| `t HH:MM [W]` | Override the clock. `W` is the weekday, `0`=Sunday … `6`=Saturday; omit it to keep the real one. **Counts as a trusted clock**, so it also unblocks recording with no network. PocketBase timestamps are shifted to match, so test rows do not look wrong in the admin UI. This is how you exercise 10:01, 13:00, 14:00, Friday check-out and the locked window without waiting for real time |
| `t off` | Clear the override |
| `c` | Clear the local today-cache, memory and `/today.json`. The PocketBase rows are untouched, so the next tap re-fetches and may still see an existing `time_in`. For a genuinely clean slate, also delete the row server-side |
| `q` | Queue depth, byte size on disk, the first 5 pending entries with learner/attendance ids and their field JSON, and the **dead-letter file size in bytes** if non-zero |
| `r` | Roster size, age in seconds, ready flag, and the first 5 learners with their UIDs. The UIDs are what `tap` wants. **The age is meaningless until the clock is trusted** — see [known gaps](#known-gaps) |
| `heap` | Free heap, minimum-ever, and largest allocatable block. Watch **min ever** across several 30-second polls: if it stops falling, the streaming parser is holding |
| `i2c` | Re-run the bus scan. Same output as the boot log |
| `tap <uid>` | Inject a scan as if a card had been read. Takes the **identical** path — roster lookup, clock gate, state machine, cache update, queue append, network drain. The reader is the only thing bypassed, which is what makes the whole pipeline exercisable with a broken or absent PN532. Get UIDs from `r` |
| `ota` | OTA hostname and the upload command. **Does not print the password** — that was shown once at provisioning |
| `v` | Version and build stamp, device id and name, PocketBase URL, and whether the PN532 came up. On a headless unit this is the only way to ask about the reader |
| `w` | Wipe today's PocketBase row for the **last-scanned** learner: blanks `time_in`, `time_out`, `lunch_events`, `status`, `lunch_status`, then clears the today-cache. Requires a tap first |
| `wifi <ssid>\|<pw>` | Replace the saved WiFi credentials and reboot. Note the `\|` separator, not a space. Useful when the network changed but everything else is still valid — and, as a side effect, it forces the roster refresh that only happens on a WiFi edge |
| `RESET` | **Only within 2 seconds of boot**, at the `[config] type 'RESET' within 2s` prompt. Wipes the NVS namespace and reboots into provisioning |

---

## OTA updates

For a device already in the field, in a screwed-shut enclosure. LAN-only by
design — the device never fetches updates from the internet, so someone has to
be on the school network and know the password.

```bash
pio run -e esp32dev_ota -t upload \
    --upload-port ll-attender-<id>.local \
    --upload-flags --auth=<password>
```

- `<id>` is `device_id` from NVS. `ota` on the console prints the full hostname.
- The password was displayed **once**, at provisioning. The device stores only
  its MD5. If it is lost, re-provision (`RESET` at boot) to generate a new one.
- Credentials are deliberately not committed. Pass them on the command line, or
  put them in a git-ignored `platformio_override.ini`.
- `esp32dev_ota` builds the identical firmware as `esp32dev`; only the transport
  differs.
- **Scans are dropped for the duration.** A tap acknowledged on the OLED and
  then wiped by the reboot is worse than not reading the card. The OLED shows
  `Updating N%`, repainting every 5% because it shares the I2C bus with the
  reader.
- If the log says `update starting (filesystem)` rather than `(firmware)`, you
  are pushing a filesystem image — that **wipes the queue and the roster**.
  Drain the queue first.
- Common failures: `auth failed (wrong password)`;
  `begin failed (image too big for the slot?)`, which means the image outgrew
  the 1536 KB app slot — CI's size gate warns at 85% and fails at 95% ahead of
  this; `end failed (bad image?)`.

After an update, confirm the new build stamp with `v`.

---

## Factory reset

Wipes the whole `llattender` NVS namespace — WiFi credentials, PocketBase
account, device id, device name, OTA password, cached token — and reboots into
provisioning. **The OTA password is regenerated, so the old one stops working.**

1. `pio device monitor`
2. Reset or power-cycle the device.
3. Within **2 seconds**, at the `[config] type 'RESET' within 2s to
   factory-reset` prompt, type `RESET` and press Enter. It is case-insensitive.
4. `[config] factory reset confirmed — wiping NVS` confirms it, then the device
   reboots into setup.

LittleFS is **not** touched: `/queue.jsonl`, `/roster.txt` and `/today.json`
survive. So a device that is re-provisioned to the same PocketBase instance
still has its pending scans and can still resolve cards offline.

---

## Reflashing over USB

```bash
pio run -e esp32dev -t upload
pio device monitor
```

**The first flash of any device must be over USB.** It is what applies the
custom partition table in
[`../hardware/partitions.csv`](../hardware/partitions.csv) — 1536 KB app slots,
needed so OTA has room — and a partition table cannot be changed over the air,
because the running firmware lives inside the layout it would be rewriting.

`pio run -t upload` **preserves NVS**, so provisioning survives. Prefer it over
a factory image for any device already in service.

### Partition-table migration warning

Repartitioning moves the filesystem partition, so LittleFS is reformatted on
first boot (`main.cpp` mounts with `formatOnFail=true`).

| Partition | Survives a repartition? | Consequence |
|---|---|---|
| `nvs` (0x9000) | **Yes** — same offset, same size | Provisioning is intact. No captive portal needed |
| `spiffs` (the LittleFS partition) | **No** — it moves, and is reformatted | `/roster.txt`, `/today.json` and `/queue.jsonl` are all destroyed |

The roster and today-cache re-fetch automatically; no action needed. **The queue
does not.** Any scans still waiting to reach PocketBase are gone.

> Before repartitioning a device that has been in service: bring it online and
> confirm `q` reports **0 pending**.

---

## Factory image — recovering a device from a machine with only `esptool`

CI publishes `firmware.bin` and `firmware.elf`, which is **not** enough to flash
a virgin board: the bootloader and the partition table have to be laid down too.
Merge the four images into one file so a unit can be recovered from a machine
that has nothing but `esptool.py`.

```bash
pio run -e esp32dev

ESPTOOL=~/.platformio/packages/tool-esptoolpy/esptool.py
BOOT_APP0=~/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin
BUILD=.pio/build/esp32dev

python3 "$ESPTOOL" --chip esp32 merge_bin -o factory-1.0.0.bin \
    --flash_mode dio --flash_freq 40m --flash_size 4MB \
    0x1000  "$BUILD/bootloader.bin" \
    0x8000  "$BUILD/partitions.bin" \
    0xe000  "$BOOT_APP0" \
    0x10000 "$BUILD/firmware.bin"

# Flash it:
python3 "$ESPTOOL" --chip esp32 --port /dev/cu.usbserial-XXXX \
    write_flash 0x0 factory-1.0.0.bin
```

- `merge_bin` writes a single image starting at offset `0x0`, so `write_flash`
  takes **`0x0`**, not `0x1000`.
- The four offsets match `partitions.csv`: bootloader at `0x1000`, partition
  table at `0x8000`, `otadata` at `0xe000` (which is what `boot_app0.bin`
  initialises), `app0` at `0x10000`.
- **Flashing a factory image erases NVS.** Provisioning is lost and the unit
  re-enters setup mode, which also means a new OTA password. Use
  `pio run -t upload` instead for a device already in service.
- The offsets and `--flash_freq` are taken from what PlatformIO itself would
  use. Re-confirm with `pio run -e esp32dev -v`, which prints the exact
  `write_flash` argument list, if the board or framework version changes. `40m`
  is the DevKit V1 default.

---

## Symptom to cause

Operational faults. **Wiring, I2C and power faults are a separate table** in
[`../hardware/README.md`](../hardware/README.md#troubleshooting) — including
`brownout`, every `[i2c]` diagnostic, `[nfc] PN532 not found`,
`[ui] SSD1306 not found`, and the "no `[nfc]` line at all" case.

| Symptom | Cause and fix |
|---|---|
| `[pb] login HTTP 400` repeating, every cycle, nothing on the OLED | Wrong PocketBase email or password. **Provisioning never test-authenticates them** — the form only checks the fields are non-empty — so a typo surfaces here and nowhere else. Verify the account in PocketBase, then `RESET` at boot and re-provision, or use the serial fallback |
| `[pb] login HTTP 400` on an account you are sure of | The `users` collection has *"Forbid authentication for unverified users"* enabled and this account is unverified. Verify it manually |
| Login succeeds, then `HTTP 403` on reads; roster never populates | The device account lacks role **`lg`**. `learners` and `attendance` restrict reads to `lg`/`admin` |
| OLED shows `--:--` / `Waiting for clock`; taps say `NOT RECORDED` | The clock is untrusted. NTP retries every 30 s while online; the usual cause is UDP/123 firewalled. **Workaround that keeps the device recording: `t HH:MM W` on the console**, which counts as a trusted clock and works offline |
| Idle screen shows `N waiting to send` and `N` keeps climbing | Recording works, delivery does not. Check `q` for the dead-letter size, check `[pb]`/`[net]` lines for the HTTP code, confirm the account still has role `lg`. This is the one operational signal a guide can act on, which is why it replaces the date line |
| `[net] giving up on scan for learner … (HTTP 404) — moved to dead-letter file` | The attendance row was deleted server-side, so the PATCH can never succeed. Correct behaviour — the entry is parked instead of wedging the queue. The scan is lost and the dead-letter file is the only record; there is no command to read it (see [known gaps](#known-gaps)) |
| Every card reads `Unknown card`, `r` says `roster: never loaded` | The roster has never been fetched and there is no disk cache. Needs one successful online boot |
| One learner's newly issued card reads `Unknown card`; everyone else is fine | The roster refreshes **only on the offline→online WiFi edge**, so a continuously-online device never picks up a mid-day change. Force it: `wifi <ssid>\|<pw>` on the console (reboots), or power-cycle |
| A dashboard edit ("Reset day", a justification, a manual time fix) has not reached the device | Wait 30 s — that is the delta-poll interval. If it still has not, look for `[pb] delta page N HTTP …` or `[pb] delta parse failed`. Deletions are invisible to delta sync by design (`updated >` cannot see a deleted row); a reboot or a day change repairs it |
| All PocketBase calls fail with negative codes or `http.begin failed`, and the clock **is** trusted | Suspect the pinned CA. If PocketHost changed certificate issuer, every device goes offline until reflashed. Check first: `openssl s_client -connect learnlife.pockethost.io:443 -servername learnlife.pockethost.io -showcerts \| grep "^ *i:"` — the chain must terminate at GTS Root R4. If it changed, update `src/pb_ca.h` and push by OTA |
| `[fs] LittleFS mount failed — persistence disabled`, and the queue resets on every reboot | The filesystem could not mount and could not be formatted. The device runs with queue and roster in RAM only. Reflash over USB to reformat; if it recurs, suspect flash wear or a partition-label mismatch (the LittleFS partition **must** be labelled `spiffs`) |
| Unexplained reboots | Read `[boot] reset reason:`. `brownout` → supply or cable. `panic` / `int watchdog` / `task watchdog` → firmware fault; the `coredump` partition holds the dump, readable with `esp-coredump` |
| `heap` min-ever keeps falling across successive 30-second polls | Something is growing. The streaming parse exists to prevent exactly this; a steady min-ever is the pass condition |
| `[queue] FULL — dropped N oldest entries … These scans are LOST.` | The device has been offline long enough to reach 400 entries / 64 KB. Those scans are gone. Restore connectivity and drain before it recurs |
| `[queue] dropped N unparseable line(s) — likely a power cut mid-write` at boot | `N` scans were lost to a power cut mid-append. Nothing to fix; the count is the only record |
| `[roster] WARNING: cached N learners in RAM but failed to persist` | The roster works today but will be empty after a reboot. Filesystem problem — check free space, then reflash |
| OTA `auth failed (wrong password)` | Wrong or lost OTA password. `RESET` at boot and re-provision to generate a new one |
| OTA `[ota] no OTA password provisioned — OTA disabled` | NVS holds no `ota_pw`. Both current provisioning paths generate one, so this means the unit was provisioned by an earlier firmware or had NVS partially written. Re-provision |
| `t 09:30` has no effect on the verdict | The state machine reads local time-of-day, and the override applies to `now_local()`. Check with `v`/`r` that a tap is reaching `proc` at all — if the reader is dead, use `tap <uid>` instead |

---

## Known gaps

All of these are real, verified against the source, and none is a bug report in
disguise — they are the honest map. Anyone diagnosing a device should read this
list before concluding something is broken.

### Provisioning does not validate PocketBase credentials

`config.cpp`'s `/save` handler checks only that `ssid`, `email` and `password`
are non-empty. It never attempts an `auth-with-password` against the URL it was
given. A typo in either field is accepted, the device reboots looking healthy,
and the only symptom is a repeating `[pb] login HTTP 400` on the serial console
— **with no signal on the OLED at all**. A guide standing at the device sees a
working clock and a normal idle screen.

Practical consequence: after provisioning, always watch the serial log through
one successful `[pb] login ok` or `[pb] reusing cached token` before closing the
enclosure.

### The timezone is compiled in

`time_sync.cpp` hard-codes `CET-1CEST,M3.5.0,M10.5.0/3` (Europe/Madrid), with a
"reconfigurable from NVS in a later phase" note that has not been actioned.
Every state-machine threshold — 10:01 late, the 13:00–14:00 lunch window, the
14:00–17:00 lock, 17:00 check-out, 14:00 on Friday — is **local** time. So a
second site in another timezone is a firmware rebuild, not a configuration
change, and there is no field where an operator could get it wrong-but-visible.

### The roster refreshes only on the offline→online edge

Attendance rows are delta-polled every 30 s. The roster is not: it is fetched in
`network_task`'s `online != last_online` branch and nowhere else. A learner
added or re-carded mid-day therefore **never reaches a device that has stayed
online** — their card reads `Unknown card` until a WiFi flap or a reboot. Forced
refresh: `wifi <ssid>|<pw>` on the console, or a power cycle.

### The dead-letter file has no cap, no rotation, and no console command

`/queue.dead.jsonl` is append-only and unbounded. `q` reports its **size in
bytes** and nothing else — there is no command to list its contents, export it,
or clear it. Reading it means mounting the filesystem, and the entries in it are
attendance data that will otherwise never exist anywhere. In practice it should
stay near-empty (it only fills on 400/403/404), but nothing enforces that.

### `nfc::init()` runs once, with no retry

A failed PN532 probe sets the reader-fault indicator and that is the end of it.
`nfc_task` then polls a wedged I2C bus forever at 50 ms intervals, and nothing
ever clears `ui::set_reader_error` — the fault is as permanent as the flag,
which is deliberate for the *indicator* but means a reader that would have come
up on a second attempt never gets one. Recovery is a power cycle.

### A LittleFS mount failure is not fatal

`setup()` prints `[fs] LittleFS mount failed — persistence disabled` and boots
on. The device then runs with the queue and the roster in RAM only: taps are
acknowledged, delivered while online, and **silently lost on any power
interruption**. The idle screen looks completely normal. This is the right
tradeoff (a device that records-but-fragile beats a device that refuses to
start) but it is invisible after the boot log scrolls away.

### A failed mutex creation continues unlocked, by design

`pb_client::init()` prints `[pb] FATAL: could not create state mutex` and
returns. `Lock` tolerates a null mutex and runs unlocked, because the intended
behaviour for a device on a front desk is to keep working rather than
hard-fault. The consequence if it ever happens: `g_today_rows`, `g_token` and
`/today.json` are touched concurrently from three contexts, and heap corruption
surfaces as an unexplained reboot minutes later. It should never occur — the
mutex is created at boot with plenty of heap — but the failure mode is silent
degradation, not a stop.

### `r`'s roster age is meaningless until the clock is trusted

`roster.cpp` stamps `g_loaded_at` from `time_sync::now_unix()` inside `init()`,
which runs **before** NTP. On a device that has not yet synced, that stamp is a
1970 value, so the age `r` prints is the seconds since the epoch, not the
seconds since load. Once the clock is trusted the number becomes plausible again
but is still measured from a 1970 baseline until the next `replace()`. Treat the
age as trustworthy only after a `[roster] cached N learners` line.

### There is no tap path at all on an unprovisioned device

`nfc::init()` runs **after** `config::run_provisioning()`, which never returns
on an unprovisioned unit. So a fresh board prints no `[nfc]` line, never
initialises the reader, and has no scan path whatsoever.

This makes two of the README's bring-up checks impossible to perform on a fresh
unit: the **clock gate** check ("boot with WiFi off → taps refused → `t 09:30 1`
→ taps work") and the **offline roster** check ("boot with WiFi off → cards
resolve to names"). Both need a provisioned device. Provision first — over the
serial fallback if there is no network to give it — then run them.

The I2C line probe and the bus scan *do* run before provisioning, deliberately,
so the wiring is still diagnosable on a device that has never been set up. That
is the case the [hardware troubleshooting table](../hardware/README.md#troubleshooting)
covers under "No `[nfc]` line at all in the boot log".
