# Absence marking (formerly "Scheduler & Test Mode")

There is no scheduler. Nothing runs on a server, on a cron, or on a worker. The
only thing that ever marks a learner absent is a `setInterval` inside this desktop
app, running in whatever browser tab or Tauri window a guide happens to have open.

That is the whole story, and the consequence is the part worth reading:

> **In a device-only deployment — where the ESP32 terminal handles taps and nobody
> opens this dashboard — nobody marks absences. A learner who never taps keeps
> `arrival = null` forever. They are not "absent"; they are missing from the data
> entirely, and every attendance-rate denominator quietly disagrees with reality.**

This file previously documented two Node scripts, `src/server/jobs/scheduledAttendance.js`
and `src/server/worker/scheduler.js`, with CLI invocations, a `PB_URL` environment
variable, and a 10:05 cutoff. **None of that exists.** There is no `src/server/`
directory, neither file is anywhere in the repository, `PB_URL` is a string literal
in `packages/pb-client/src/constants.ts` rather than an environment variable, and
the live cutoff is 10:30. The design intent that document described is preserved at
the end of this file, clearly labelled as unbuilt.

---

## What actually happens

`src/app/hooks/useAutoAbsentSweep.ts`. Its own header comment states the reason:

> Server-side PB cron isn't available in this hosting setup, so any open guide
> screen runs the sweep on a 1-minute timer.

PocketHost runs stock PocketBase. Scheduled jobs would mean either a `cronAdd()`
in a JS hook or a separate always-on process, and this deployment has neither — the
`pb_hooks/` directory is uploaded by hand and holds only request-time hooks. So the
sweep was pushed to the client, where "something is open" is the only available
trigger.

### The mechanism

| Property | Value | Source |
| --- | --- | --- |
| Trigger | `setInterval`, 60 000 ms, plus one immediate tick on mount | `useAutoAbsentSweep.ts` |
| Enabled when | `isLoggedIn` (role `admin` or `lg`) | `page.tsx`, `kiosk/page.tsx` |
| Mounted on | `/` (dashboard) and `/kiosk` | Both call `useAutoAbsentSweep` |
| Cutoff | **10:30 local time** | `TIME_THRESHOLDS.ABSENT_HOUR = 10`, `ABSENT_MINUTE = 30` in `packages/pb-client/src/constants.ts` |
| Weekends | Skipped (Sunday = 0, Saturday = 6) | `findLearnersToMarkAbsent` in `packages/shared/src/attendance.ts` |
| Writes | `{ arrival: "absent", justified: false, status: "absent" }` | `useAutoAbsentSweep.ts` |
| Scope | Today only — returns immediately if `viewDate !== today` | `useAutoAbsentSweep.ts` |

Each tick:

1. Bail unless the dashboard is showing **today**. Viewing a past date must never
   write to it.
2. Bail if `lastSweptDateRef` already equals today (see idempotency below).
3. Fetch today's attendance (`perPage: 500`) and the learner list (`perPage: 500`)
   fresh. Deliberately re-fetched every tick rather than reusing page state, so a
   kiosk window stays consistent with whatever the dashboard has been writing.
4. `findLearnersToMarkAbsent(records, learners, now)` — the pure decision, in
   `@learnlife/shared`.
5. Write each candidate individually via `batchUpdateAttendance`, counting successes
   and failures.

### The absent-candidate rule

From `findLearnersToMarkAbsent`. A learner is a candidate only if **every** one of
these holds:

- It is at or after 10:30 local time.
- It is not Saturday or Sunday.
- They have no `time_in` for today.
- They have no `arrival` recorded for today.
- They have no legacy `status` for today either — the pre-split-migration fallback,
  treated as "a guide already handled this".

Those last three checks are what make the sweep safe to run every 60 seconds. It
never overwrites a guide's manual call, and it never re-marks someone who is
already absent.

### Idempotency, and why it is a ref rather than a flag

`lastSweptDateRef` is set to today's date only when the sweep has nothing left to
do — either zero candidates while past the cutoff on a weekday, or every write
succeeded. If any write failed, the ref stays null and the next tick retries just
the ones that failed. That is the whole retry strategy: a 60-second loop that
converges, with no backoff and no persistence.

Note the ref is component state. Closing and reopening the app clears it, and the
sweep runs again from scratch — which is harmless, because the candidate rule is
already idempotent against the database.

---

## The failure modes

These are not hypothetical; they follow directly from "a browser timer is the only
trigger".

| Situation | What happens |
| --- | --- |
| **Device-only day.** Firmware handles taps, nobody opens the dashboard | **Nobody is marked absent.** Learners who never tapped keep `arrival = null` indefinitely |
| Dashboard opened at 15:00 | The sweep fires on mount and marks the day's absences five hours late. `justified_at` is untouched, but the row's `updated` timestamp reflects 15:00, not 10:30 |
| Dashboard never opened that day, opened the next day | The previous day is **never swept**. The sweep only ever looks at today; there is no catch-up pass over prior dates |
| Dashboard open across midnight | `lastSweptDateRef` no longer matches the new `todayStr`, so the sweep re-arms for the new day automatically |
| Two dashboards open on two machines | Both sweep. The candidate rule makes the second one a no-op, at the cost of duplicate reads. No locking, and none needed |
| Machine's clock or timezone is wrong | The cutoff is evaluated with local `getHours()`/`getMinutes()`. A wrong clock produces a wrong cutoff, silently |
| Test mode with a `testTime` set | `now` becomes `testTime`, so the sweep can be exercised at a simulated 10:31 without waiting. Note this means **test mode can write real absences** — the demo overlay is what prevents writes, not test mode itself |

### The gap has no in-app signal

Nothing warns that the sweep has not run. There is no "last swept" indicator, no
staleness banner, and the sweep's own output goes to `console.log`/`console.warn`
(not through `src/lib/debug.ts`, so these lines survive into production builds and
are visible only in the devtools console). The only way to notice from outside is
that a learner has no attendance row for a past weekday at all.

### If you need absences marked reliably

Nothing in this repository does it. The options, none of them built:

- A PocketBase JS hook using `cronAdd()` in `pb_hooks/`. Closest to the current
  architecture, but the sweep needs to read the whole roster and write many rows,
  and `pb_hooks/` is currently uploaded by hand with no tests and no CI.
- A scheduled GitHub Actions workflow hitting the PocketBase REST API with admin
  credentials. Requires storing those credentials as repository secrets.
- Teaching the ESP32 firmware to do it. It already has an NTP clock and a copy of
  the state machine, but it does not have the roster, only the cards it has seen.
- Accepting the gap and treating `arrival = null` on a past weekday as "absent, not
  recorded" everywhere it is read. `useAdminHistoryData` already partly does this:
  it derives `expectedDays` from `countWeekdays()` rather than from the record
  count, precisely so days with no row do not vanish from attendance rates.

Whoever picks one should also decide what to do about the days already missing.

---

## Test mode

The old document paired the scheduler with a `TEST_MODE` / `DRY_RUN` environment
convention. Neither variable exists. Test mode is a UI toggle:

- Press `t`, or click the **Test** pill in the dashboard toolbar.
- `TestModePanel` (bottom of the screen) sets a simulated date and time, which flow
  into `useNfcLearner` and `useAutoAbsentSweep` and from there into
  `computeCheckInAction` and `findLearnersToMarkAbsent`. Time presets: 9 AM, 10 AM,
  1 PM, 1:30 PM, 2 PM, 5 PM, 6 PM.
- "Simulate scan" fires a scan for a chosen learner with no reader attached.
- **Test mode alone still writes to PocketBase.** The dry-run equivalent is the
  separate **Load demo** button, which installs a synthetic attendance overlay
  (`src/lib/demo-data.ts`); while that overlay is active every write handler returns
  early and nothing reaches the database. Leaving test mode clears the overlay.

So the mapping from the old document is: `TEST_MODE` → the `t` toggle;
`DRY_RUN` → Load demo. There is no CLI for either.

---

## Design intent from the previous version of this document — NOT BUILT

Kept because the shape of the intended system is still useful, and because one of
its two jobs has no client-side equivalent at all. **None of the following exists in
code.** Treat it as a proposal.

Two scheduled jobs were envisaged:

| Job | Intent | Status today |
| --- | --- | --- |
| `markAbsent` | Mark learners who never checked in by a morning cutoff | **Partially exists**, as the client-side sweep above. Cutoff is 10:30, not the 10:05 the old document claimed |
| `markLunchLate` | Mark learners who went `lunch_out` and never came back by a lunch cutoff | **Does not exist in any form.** No sweep, no timer, no job |

The `markLunchLate` gap is worth stating plainly, because it is easy to assume it is
covered. `lunch_status = "late"` is only ever written when a learner **actually
scans back in** after the lunch window — by `computeCheckInAction`'s
`late_lunch_return` branch, or folded into the `check_out` write when a learner is
still mid-lunch at checkout time. A learner who taps out for lunch and then never
taps again keeps a trailing unmatched `out` event and a null `lunch_status` forever.
The daily CSV surfaces this as `(no return)` — that string exists precisely because
nothing resolves the state automatically.

The old document's other stated intentions, all still unimplemented: a dry-run mode
that logs without writing, admin-credential auth for the job process, running under
a managed supervisor (systemd, PM2, or a container), and "proper monitoring,
retries, and idempotency keys". Of those, only idempotency was actually achieved,
and by a different route — the candidate rule in `findLearnersToMarkAbsent`, not by
keys.

---

## Related

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — where the sweep sits among the app's hooks
- [`../../docs/POCKETBASE.md`](../../docs/POCKETBASE.md) — the `attendance` collection schema
- [`../../docs/GLOSSARY.md`](../../docs/GLOSSARY.md) — `arrival`, `justified`, `lg`, and the status enum
- `packages/shared/src/attendance.ts` — `findLearnersToMarkAbsent`, the pure rule
- `packages/pb-client/src/constants.ts` — `TIME_THRESHOLDS`, the single source of cutoffs
