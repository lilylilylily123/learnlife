# NFC Attender — user guide

This guide covers two different things, because two different groups use this
system and they do not use the same part of it.

- **Learners** tap a card on the reader by the door. They never sign in to
  anything. [Jump to the tapping rules](#part-1-tapping-your-card-for-learners).
- **Guides and admins** sign in to the Attender app on a computer to see who is in,
  fix mistakes, and pull reports. [Jump to the app](#part-2-the-attender-app-for-guides-and-admins).

A note on the previous version of this guide: it described the app as if learners
signed in to see "your card" and "your history". They cannot. Learner accounts are
rejected at the sign-in screen — the app only accepts guide and admin accounts. If a
learner needs to know their own attendance, a guide has to look it up for them.

## Before anything else: get your card registered

**Your card does nothing until it has been registered against your name.** Tapping
an unregistered card shows "Card not registered" and records nothing at all. There
is no self-service for this — see Lily, or whoever currently handles enrolment.

If you get a replacement card, the old one should be unlinked too. A card left
linked to you alongside your new one causes taps to be attributed unpredictably.

---

# Part 1: Tapping your card (for learners)

## The times that matter

All times are local. "Up to 10:00" includes 10:00 itself.

| What you're doing | When | Result |
| --- | --- | --- |
| Morning arrival | Up to **10:00** | **Present** |
| Morning arrival | **10:01** or later | **Late** |
| Going out for lunch | **1:00 PM – 1:59 PM** | Logged as out for lunch |
| Coming back from lunch | **1:00 PM – 1:59 PM** | Back on time |
| Coming back from lunch | **2:00 PM** or later | Back from lunch, **late** |
| End of day, Monday–Thursday | From **5:00 PM** | Checked out |
| End of day, **Friday** | From **2:00 PM** | Checked out |

Three of these catch people out, so they get their own headings.

### 10:00 is on time. 10:01 is late.

The cutoff is 10:01, not 10:00. If you tap at exactly 10:00 you are Present. One
minute later and you are Late. There is no grace period beyond that.

### Friday ends early

Friday check-out opens at 2:00 PM. Every other weekday it opens at 5:00 PM. Nobody
changes this by hand — the system knows what day it is.

### Between 2:00 PM and 5:00 PM, tapping does nothing

On Monday to Thursday, once you have checked in for the morning and you are not out
at lunch, the door reader ignores your card between 2:00 PM and 5:00 PM. This is
deliberate: it stops an accidental mid-afternoon tap from doing something you did
not intend. The device tells you scans are locked. It is not broken. Come back at
5:00 PM.

The one exception: if you went out for lunch and never tapped back in, tapping in
this window records your late return.

## Lunch: tap twice

Lunch needs **two** taps — one on the way out, one on the way back. The reader works
out which is which from what you did last, so there is no button to press.

If you only tap once, you are recorded as having left for lunch and never returned.
**Nothing corrects this automatically.** It will still be sitting there as "no
return" weeks later unless a guide fixes it.

You can go out and come back more than once during the lunch window; each pair is
recorded.

## What the statuses mean

| Status | Meaning |
| --- | --- |
| **Present** | Checked in at 10:00 or earlier |
| **Late** | Checked in at 10:01 or later |
| **Absent** | No check-in recorded by 10:30 |
| **Justified late** | Late, but a guide has excused it |
| **Justified absent** | Absent, but a guide has excused it |
| **No status** | Nothing recorded yet today |

Being marked absent is not permanent. If you turn up at 11:00 and tap, your card
overrides the absent mark and you become Late.

If a guide had already excused you before you turned up, that excusal is *supposed*
to carry across to your late arrival. It usually does. **There is a known bug where
it can be applied inconsistently** — the day can end up showing as excused in one
place and not excused in another. If you were excused and your record does not look
right, tell a guide; it is worth them checking rather than assuming.

"Justified" is something only a guide can apply. Ask a guide; the system will not
work it out.

## If something goes wrong

**"Card not registered"** — the card has never been linked to a name, or it has been
unlinked. See the person who handles enrolment. Tapping again will not help.

**Nothing happens when I tap** — check the time against the table above. Between
2:00 PM and 5:00 PM on Monday–Thursday, and at any time after you have already
recorded everything for the day, the reader is meant to do nothing. If it is 9:00 AM
and nothing happens, tell a guide: the reader may be offline.

**I tapped but the wrong thing was recorded** — a guide can correct any time or
status after the fact. Nothing is locked.

**I forgot to tap** — tell a guide the same day if you can. They can add your
check-in with the right time. Waiting means somebody has to reconstruct it later.

---

# Part 2: The Attender app (for guides and admins)

You need a guide (`lg`) or admin account. Learner accounts are refused. Accounts
cannot be created from the app — ask an admin to set one up in PocketBase.

## The dashboard

Signing in lands you on the dashboard for today.

The big number at the top left is **how many people are on site right now** —
present plus late, not counting anyone at lunch or already checked out. Beside it is
the roster total and the on-time percentage.

The indicator at the top right shows the card reader. **A caution about it: it reads
"Reader live" even when no reader is connected.** It only changes when an
unrecognised card is tapped. Do not use it to confirm the reader is working; tap a
known card instead.

### Two views

- **Table** (keyboard `1`) — one row per learner, with times, status buttons, and a
  per-row menu.
- **Wall** (keyboard `2`) — a grid of colour-coded tiles. Best for a glance across
  the room.

### Setting a status by hand

Each row has five buttons: **P** (present), **L** (late), **A** (absent),
**JL** (justified late), **JA** (justified absent).

Clicking a button applies it. **Clicking the button that is already active clears
the day back to no status.** That is the only way to un-set a status.

When you mark someone justified, the app records that it was you and when. Use the
reason icon next to the status to add a written reason — do that, because in three
weeks nobody will remember why.

### One case to double-check: excused learner who then turns up

If you mark someone justified absent and they later tap in, the day should end up as
justified late. There is a known bug where the two halves of that status can
disagree, so the reports may count it as an ordinary unexcused late even though the
row displays as justified.

If it matters — and for an excused absence it usually does — re-apply **JL** to that
learner by hand after they arrive. That writes both halves correctly and the reports
will then agree.

### Fixing times

Use the row's `...` menu to edit the check-in or check-out time, add a note, edit a
justification reason, see the full list of taps for the day, or reset the day
entirely.

**Reset clears the whole day for that learner** — check-in, check-out, lunch, and
status. It asks first. There is no undo.

One thing to know before editing lunch times in the History screen: that editor
holds a single out/in pair. If a learner went out and back more than once, saving
there replaces all of it with the one pair you can see. Check the row's tap history
first.

### Doing several people at once

Tick the checkboxes in the table view and a bar appears with: check in all, check
out all, mark absent, mark justified absent.

In wall view, "Select" mode gives you bulk reset only.

Bulk actions run one learner at a time, so a large selection takes a few seconds.
**They are also not recorded anywhere.** If you bulk mark thirty people absent,
nothing logs that you did it or when. Be deliberate.

### Live activity

The "Live" panel on the left shows taps as they happen, from the door device as well
as from any reader attached to the computer. Useful during arrival. It keeps the last
50 events and does not persist — closing the app loses it.

## History and reports

**History** (keyboard `h`, or the History button) shows one day at a time, listing
every learner whether or not they have a record. Search by name or email, filter by
status, and click a learner to edit their day. "Export CSV" saves that day as a
spreadsheet file.

**Reports** (the Reports button inside History) covers a date range — today,
3 days, 7 days, 14 days, this month, or dates you pick. It gives per-learner
attendance rates and per-programme summaries, sortable by any column, with an
expandable day-by-day breakdown per learner. Its "Export CSV" covers the whole range.

Both exports open a normal save dialog. Choose where the file goes.

The Reports programme filter offers Changemaker, Creator, and Explorer. It does
**not** offer Pathfinders, even though Pathfinder learners display correctly
elsewhere in the app. To report on Pathfinders, leave the filter on "All programmes"
and use the search box or the exported CSV.

### A caution about the percentages

Attendance percentages are calculated against **weekdays in the range**, not against
the number of records that exist. This is deliberate, and it means a day where
somebody simply has no record still counts against them. Given the absence problem
below, treat a low percentage as a prompt to check the raw days rather than as a
finding.

## The one thing you must know about absences

**Absences are only marked while this app is open.**

The app checks once a minute, and from 10:30 onwards it marks anyone with no
check-in as absent. That check runs *inside the app*. There is no server doing it.

So:

- If nobody opens the Attender app on a given school day, **nobody is marked absent
  that day**. The learners who did not turn up end up with no record at all, rather
  than an absent record.
- Opening the app later the same day fixes that day — the check runs as soon as you
  sign in.
- Opening the app the *next* day does **not** fix the previous day. There is no
  catch-up pass. That day stays incomplete permanently unless someone fills it in by
  hand.

**Practical advice: have the Attender app open on some machine every school day,
past 10:30.** The kiosk screen counts — it runs the same check.

There is no warning anywhere in the app when this has not happened. Nothing turns
red. The only symptom is missing days in the reports.

Also unhandled: a learner who taps out for lunch and never taps back in is never
resolved automatically. They show as "no return" in the daily CSV indefinitely. Fix
those by hand.

## Keyboard shortcuts

Press `?` at any time for the full list.

| Key | Action |
| --- | --- |
| `/` | Focus the search box |
| `h` | Open history |
| `1` | Table view |
| `2` | Wall view |
| `t` | Toggle test mode |
| `?` | Show shortcuts |
| `Esc` | Close menus and dialogs |

## Test mode — and the one dangerous thing about it

Test mode (`t`) lets you pretend it is a different date and time, and fire a
simulated tap for any learner. It exists so you can check behaviour without waiting
for 10:01 or 5:00 PM to come around.

**Test mode on its own still writes real data to the real database.** Simulating a
tap in test mode genuinely checks that learner in.

If you want to demonstrate the app without touching real records, use the
**Load demo** button in the test panel. That replaces what you see with invented
attendance and stops all saving — nothing you click reaches the database. Turning
test mode off clears it.

Rule of thumb: demonstrating to an audience means Load demo, every time.

## Updates

When a new version is released, the app shows a full-screen prompt on startup and
will not let you continue until you install it. Click Install, wait for the
download, then Restart. This is intentional — a stale copy writing to the same
database is worse than a minute of waiting.

If the update fails, "Continue without updating" lets you carry on. Tell whoever
maintains the app.

## Getting help

Contact an admin for: a lost or replacement card, a new learner who needs adding,
attendance corrections you cannot make yourself, a reader that has stopped
responding, or a day that was never swept for absences.

---

*Reviewed against the code on 2026-09-07. The times in Part 1 come from
`TIME_THRESHOLDS` in `packages/pb-client/src/constants.ts`, the tap logic in
`packages/shared/src/attendance.ts`, and the door device's own copy in
`apps/nfc-attender-fw/src/state_machine.cpp`. If those change, this guide is wrong
until somebody updates it.*

*Known discrepancy, recorded here so staff are not caught out: the door device opens
check-out at 5:00 PM and locks scans between 2:00 PM and 5:00 PM. A reader plugged
directly into the computer opens check-out at 4:59 PM and has no locked window at
all. The two copies of the rule have drifted. Learners use the door device, so
Part 1 gives the device's behaviour.*
