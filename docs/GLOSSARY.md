# Glossary

Every other document in this repo assumes these terms. Read this first if you
are new, and skim it if you are returning — several words here mean something
narrower than they sound like, and two of them (`lg`, `arrival`) are the ones
people get wrong.

Terms are grouped by where they come from: the school's own vocabulary, the
attendance rules, the PocketBase backend, and the ESP32 device.

---

## The product

| Term | Meaning |
|---|---|
| **Learner** | A student. The school's own word for it, used everywhere in the code as a role name (`learner`) and a collection name (`learners`). Not a synonym for "user" — a learner is a person the system tracks attendance *for*, and may or may not have a login. |
| **Guide** / **LG** | A staff member. `lg` stands for *learning guide* and is the literal role string stored in PocketBase, which is why it appears in code far more often than the spelled-out word. `isGuide()` (`packages/shared/src/roles.ts`) returns true for **both** `lg` and `admin` — it means "has staff privileges", not "has exactly the lg role". Use `isAdmin()` when you mean admin specifically. |
| **Program** | Which of the school's three tracks a learner belongs to. Stored as a short code, not the display name: `chmk` = Changemaker, `cre` = Creator, `exp` = Explorer (`packages/pb-client/src/constants.ts`). |
| **Tap terminal** | The thing a learner physically taps their card on. Since the ESP32 firmware exists, this is `apps/nfc-attender-fw` running on a standalone desk device. It used to be the Mac running `apps/nfc-attender`. |
| **Dashboard** | The staff-facing surface: history, justifications, bulk edits, CSV export. This is `apps/nfc-attender` (Next.js + Tauri). It is **no longer** the tap terminal, and the distinction matters — several behaviours (notably the auto-absent sweep) only happen while the dashboard is open. |
| **Justification** | A guide marking a learner's absence or lateness as excused. Tracked *separately* from whether they actually arrived — see `arrival` below. |

---

## The attendance rules

The complete specification lives in `packages/shared/src/attendance.ts` and is
documented in [`../packages/shared/README.md`](../packages/shared/README.md).
These are the terms it uses.

| Term | Meaning |
|---|---|
| **`arrival`** | The **fact**: did the learner show up on time, late, or not at all? One of `present`, `late`, `absent`. This is the source of truth. |
| **`status`** | The **legacy combined enum**: `present`, `late`, `absent`, `jLate`, `jAbsent`. It folds arrival together with justification, so `jAbsent` means "absent, but excused". Written alongside `arrival` so older consumers keep working. |
| **The split status model** | Why both fields exist: justification is tracked separately so that *the underlying arrival fact survives a guide marking the day excused*. Collapsing them would destroy the record of what actually happened. `deriveStatus()` composes the two into the legacy enum; `splitStatus()` decodes it back. |
| **`computeCheckInAction()`** | The state machine at the heart of the product. Given a learner's current attendance record plus the current time, it returns exactly one action: `check_in`, `lunch_event`, `late_lunch_return`, `check_out`, or `no_action` (with a reason). Pure — no I/O, no clock of its own; the caller passes `now` in. |
| **Present/late boundary** | **10:01 local time.** A tap before it is `present`, at or after it is `late` (`LATE_HOUR`/`LATE_MINUTE`). This single number is why the device refuses to act on an untrusted clock — see *clock gate*. |
| **Lunch window** | 13:00–14:00 local. A tap in this window is a `lunch_event` rather than a check-in or check-out. |
| **Late lunch return** | A return from lunch at or after 14:01 (`LUNCH_LATE_HOUR`/`LUNCH_LATE_MINUTE`), recorded as `lunch_status: "late"`. |
| **Locked window** | 14:00–17:00, during which a tap is rejected outright rather than recorded. The device shows "Locked". |
| **Checkout** | 16:59 on a normal day, **14:00 on Friday** (`FRIDAY_CHECKOUT_HOUR`). The Friday exception is a real school-calendar rule, not a bug. |
| **Auto-absent sweep** | Any active learner with no check-in by **10:30** on a weekday gets flipped to `arrival = absent`. Implemented by `findLearnersToMarkAbsent()`. **Nothing runs this server-side** — see the warning below. |

> **The auto-absent gap.** The sweep runs only from
> `apps/nfc-attender/src/app/hooks/useAutoAbsentSweep.ts`, on a 1-minute timer,
> and only while a guide has the dashboard open. PocketBase cron is not
> available in this hosting setup. So in a device-only deployment nobody marks
> absences and a learner who never taps keeps `arrival = null` indefinitely.
> This is the largest known functional hole in the system.

> **The rule exists three times.** `packages/shared/src/attendance.ts` is the
> specification. `deriveStatus` is hand-duplicated in
> `packages/pb-client/src/queries/attendance.ts` under a MUST-STAY-IN-SYNC
> banner with no test asserting the two agree. And
> `apps/nfc-attender-fw/src/state_machine.cpp` is a C++ port of
> `computeCheckInAction` for the device. **Nothing in CI compares them.** A rule
> change means three edits.

---

## The backend

Full reference: [`POCKETBASE.md`](POCKETBASE.md).

| Term | Meaning |
|---|---|
| **PocketBase** | The backend: a single-binary Go app providing collections, REST, auth, realtime, and JS hooks. **It is not in this repo.** |
| **PocketHost** | The hosting provider running our PocketBase instance at `https://learnlife.pockethost.io/`. Source of the request budget below. |
| **Collection** | A PocketBase table. The ones that matter: `users`, `learners`, `attendance`, `calendar`, `messages`/`conversations`, `invites`, `event_rsvps`, `audit_log`. |
| **API rules** | PocketBase's per-collection access control, configured in the admin UI. **Mostly not captured in this repo**, which is the project's biggest reproducibility hole: the device's `attendance` write permission exists only as admin-UI state. |
| **Hooks** | Server-side JS in `pb_hooks/`, uploaded to PocketHost **by hand**. Not covered by CI, not tested, not linted — a regression is only discoverable in production. |
| **Request budget** | PocketHost allows **1000 requests/hour per IP**. Both devices and the dashboard share the school's single NAT address, so they share one budget. This is not a guideline — it is the constraint that *derives* the device's 30 s delta-sync interval and caps the number of terminals. |
| **Delta sync** | The device asking for rows changed since a **watermark** (`updated > <timestamp>`) rather than re-fetching everything. Cheap enough to run every 30 s; the full re-fetch it replaced ran the device out of memory at 61 rows. Cannot see deletions, which is acceptable because the reset flow updates rather than deletes. |
| **`audit_log`** | Collection that `apps/nfc-attender/src/lib/audit.ts` writes to non-blockingly for CSV exports and bulk edits. `pb_hooks/README.md` calls it optional — if it was never created, that auditing silently does nothing. |

---

## The device

Full reference: [`../apps/nfc-attender-fw/README.md`](../apps/nfc-attender-fw/README.md).

| Term | Meaning |
|---|---|
| **UID** | The card's unique identifier, read over NFC and used to resolve a learner. Lowercase hex. Note: UID-only authentication is trivially cloneable — see [`SECURITY.md`](SECURITY.md). |
| **PN532** | The NFC reader module, on I²C at address `0x24`. Its DIP switches select the interface, and it **latches them at its own power-up** — so changing them and resetting the ESP32 does nothing; the USB cable has to come out. |
| **Clock gate** | The device has no RTC, so at power-on it believes it is 1970. Because 10:01 is the present/late boundary, acting on that clock would silently mark everyone present with a 1970 timestamp. So the device **refuses to record anything** until NTP succeeds or an operator asserts the time over serial. `src/clock_gate.h`. |
| **Roster cache** | A copy of the learner list on the device's flash (`/roster.txt`), loaded *before* WiFi starts so a cold boot on a slow-router morning still resolves cards to names. |
| **Durable queue** | Scans appended to `/queue.jsonl` before they reach PocketBase, so a power cut loses nothing. This is the system's stated durability boundary. |
| **Dead-letter** | `/queue.dead.jsonl`, where permanently unwritable entries (a row deleted server-side, so a 404 forever) go, instead of blocking the head of the queue. Currently has no cap and no purge command. |
| **Provisioning** | First-time setup: the device raises a WiFi AP, serves a captive-portal form for WiFi and PocketBase credentials, then reboots. A serial fallback exists. On an unprovisioned unit this **never returns**, which is why nothing after it in `setup()` runs. |
| **OTA** | Over-the-air firmware update, once a device is provisioned and reachable. Fails closed: disabled entirely if no OTA password was provisioned. The **first** flash of any board must be over USB, because the custom partition table cannot be applied over the air. |
| **NVS** | ESP32 non-volatile key-value storage, holding provisioning data. Survives `pio run -t upload` and repartitioning; erased by a factory image or a `RESET` at boot. |
| **LittleFS** | The device's filesystem, holding the roster and the queue. **Reformatted by repartitioning** — drain the queue before reflashing a unit that has been in service. |

---

## Repo mechanics

| Term | Meaning |
|---|---|
| **`nfc-attender` vs `nfc-attender-fw`** | Two different apps whose names differ by a suffix. `nfc-attender` is the TypeScript dashboard; `nfc-attender-fw` is the C++ firmware. CI path filters exploit the difference deliberately, so `apps/nfc-attender/**` does **not** match the firmware. |
| **The workspace boundary** | `apps/nfc-attender-fw` is explicitly excluded from the pnpm workspace (`pnpm-workspace.yaml`) because it is a PlatformIO/C++ project. Nothing in it runs `pnpm`; use `pio` from inside that directory. |
| **Pure/impure split** | The firmware's core discipline: every non-trivial decision lives in a module that compiles on the host and has tests; anything touching Arduino, WiFi or LittleFS is a thin adapter guarded by `#ifndef LLATTENDER_NATIVE_BUILD`. This is what makes a power cut mid-compaction testable at all. |
| **Subtree publishing** | `apps/nfc-attender` and `apps/ll-calendar` are each mirrored to their own standalone repo via `git subtree push` (root `push:*` scripts), which is why the dashboard carries its own `.github/workflows/`. |
