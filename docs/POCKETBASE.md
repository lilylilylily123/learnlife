# PocketBase backend reference

The backend is a hosted PocketBase instance at `https://learnlife.pockethost.io/`
(PocketHost). **It is not in this repository.** Its collections, fields, indexes,
API rules and auth settings live only in the PocketHost admin console, and there
is no schema export committed anywhere here. The only server-side code this repo
owns is [`../pb_hooks/`](../pb_hooks/README.md), which is uploaded by hand.

This document is a reconstruction of that instance from the four clients that
talk to it. It exists because the absence of a schema reference is the single
biggest reproducibility hole in the project: a new NFC terminal, or a rebuilt
backend, cannot currently be provisioned from the repo alone. Read it as "what
the code requires the backend to look like", not as "what the backend
provably is" — the difference is called out explicitly wherever it matters, and
[Verifying the live instance](#verifying-the-live-instance) is how you close it.

## The four clients

| Client | Language / transport | Auth identity | Collections touched |
|---|---|---|---|
| `apps/nfc-attender` (dashboard) | TS, PocketBase JS SDK via `@learnlife/pb-client` | a `users` record, role `lg` or `admin` | `users`, `learners`, `attendance`, `invites`, `audit_log` |
| `apps/ll-calendar` | TS, PocketBase JS SDK via `@learnlife/pb-client` | a `users` record, role `learner` (also `lg`/`admin`) | `users`, `calendar`, `event_rsvps`, `conversations`, `messages` |
| `apps/nfc-attender/tools/enroll` (Rust CLI) | raw REST via `reqwest` | **PocketBase superuser**, not a `users` record | `learners` |
| `apps/nfc-attender-fw` (ESP32) | raw REST, hand-built URLs and JSON | a `users` record, role `lg`, one per device | `users` (auth only), `learners`, `attendance` |

The enrolment CLI is the odd one out: it posts to
`/api/collections/_superusers/auth-with-password`
(`apps/nfc-attender/tools/enroll/src/main.rs`, `pb_auth`), so it needs the
PocketHost admin credentials, not a normal account. Everything else authenticates
against the `users` collection.

The firmware speaks raw REST because it has no SDK. Its URL and body shapes are
built in `apps/nfc-attender-fw/src/pb_request.cpp` and
`apps/nfc-attender-fw/src/fields.cpp`, deliberately mirroring what the TS clients
produce so rows look identical regardless of writer. Those builders are the most
precise statement in the repo of what the device sends, and they are unit-tested
(`apps/nfc-attender-fw/test/test_pb_request/`), so they are trustworthy as a
source for this document.

## Roles

Role lives on the `users` collection as a plain text/select field with three
values, defined as `UserRole` in `packages/pb-client/src/types.ts` and as
`ALLOWED_ROLES` in `../pb_hooks/users.pb.js`.

| Role | Meaning | Can do |
|---|---|---|
| `learner` | A student. The only role that self-signup and invite redemption can produce. | Read/update own `users` row; read `calendar` events for their program plus their own `class` entries; create/update/delete own `event_rsvps`; participate in `conversations`/`messages`. |
| `lg` | Learning guide (staff). Also the role used by **NFC terminal device accounts**. | Everything a learner can, plus read `learners` and `attendance`, read any event's RSVP roster, and (per the dashboard's behaviour) write `attendance` and `audit_log`. |
| `admin` | Full operator. | Everything, plus create/modify elevated accounts, delete `users`, and read `audit_log`. |

Two things follow from `lg` being both "staff" and "device":

- A device account can read every learner's name, email, date of birth and
  attendance history, because that is what the `lg` read rule grants. There is no
  narrower role. This is recorded as accepted risk in
  [`SECURITY.md`](./SECURITY.md), which suggests a dedicated `device` role if the
  device count grows.
- Revoking a lost terminal means disabling one `users` record. That is the whole
  reason for one account per device rather than a shared one — see
  [Device account procedure](#device-account-procedure).

`admin` here is the application-level role on a `users` record. It is **not** the
same as a PocketBase superuser (`_superusers`), which is the console login the
enrolment CLI uses.

## Collections

Field types below are inferred from how each client reads and writes them. Where
the repo does not pin a type down (PocketBase `select` vs plain `text`, required
vs optional, index presence), that is stated rather than guessed. Every
collection also carries PocketBase's built-in `id`, `created` and `updated`.

### `users` (auth collection)

Source: `User` in `packages/pb-client/src/types.ts`; writes in
`packages/pb-client/src/queries/auth.ts` and `../pb_hooks/invites.pb.js`.

| Field | Type | Notes | Written by |
|---|---|---|---|
| `email` | email (PB built-in) | | invite redemption hook; admin console |
| `emailVisibility` | bool (PB built-in) | hook sets `false` on redemption | `invites.pb.js` |
| `verified` | bool (PB built-in) | hook sets `true` on redemption | `invites.pb.js`; admin console |
| `password` | password (PB built-in) | `changePassword` in `queries/auth.ts` sends `oldPassword` + `password` + `passwordConfirm` | user, admin console |
| `name` | text | display name; falls back to email at redemption | `invites.pb.js`, admin console |
| `username` | text (PB built-in) | read for messaging search | PB |
| `avatar` | file/text | read only in this repo | admin console |
| `role` | `learner` \| `lg` \| `admin` | gated by `users.pb.js` on both create and update | `invites.pb.js` (always `learner`), admin console |
| `learner` | relation → `learners`, single | required in practice for `role = "learner"`; the forward FK is the source of truth | `invites.pb.js`, admin console |

Read by: the calendar app (`listMessageableUsers` in
`packages/pb-client/src/queries/messages.ts` does a `getFullList` on `users`, via
the new-conversation modal), the dashboard, and the firmware only via
`auth-with-password`.

### `learners`

Source: `Learner` in `packages/pb-client/src/types.ts`;
`packages/pb-client/src/queries/learners.ts`;
`apps/nfc-attender/tools/enroll/src/main.rs`;
`list_learners_url` in `apps/nfc-attender-fw/src/pb_request.cpp`.

| Field | Type | Notes | Written by |
|---|---|---|---|
| `name` | text | sort key for both the dashboard list and the device roster fetch | dashboard, enrol CLI |
| `email` | email/text | | dashboard |
| `dob` | date/text | | dashboard |
| `NFC_ID` | text, nullable | card UID; exact-match filtered by `getLearnerByNfc` and by the enrol CLI's duplicate check. **Needs a unique index to make that duplicate check meaningful; the repo cannot confirm one exists.** | enrol CLI, dashboard |
| `program` | `chmk` \| `cre` \| `exp` | codes from `PROGRAM_CODES` in `packages/pb-client/src/constants.ts` | enrol CLI, dashboard |
| `comments` | text, optional | guide free-text | `updateLearnerComment` |
| `user` | relation → `users`, optional | back-reference; best-effort, set by `invites.pb.js` and explicitly non-fatal on failure | `invites.pb.js` |

**Type discrepancy worth knowing:** `Learner` declares `email` and `dob` as
required `string`, but the enrolment CLI creates records with only
`{ name, program, NFC_ID }` (`CreateLearnerBody` in `main.rs`). Either those two
fields are optional in the live schema, or CLI-enrolled learners carry empty
strings. Not verifiable from the repo.

Read by all four clients. The device fetches the whole roster paginated
(`?page=N&perPage=M&sort=name`) at boot and caches it to `/roster.txt` so a cold
boot resolves cards to names before WiFi is up.

### `attendance`

The busiest collection and the one with the most subtle contract. Source:
`AttendanceRecord` in `packages/pb-client/src/types.ts`;
`packages/pb-client/src/queries/attendance.ts`;
`apps/nfc-attender-fw/src/fields.h`.

| Field | Type | Notes | Written by |
|---|---|---|---|
| `learner` | relation → `learners` | | device (POST), dashboard |
| `date` | date/text `YYYY-MM-DD` | every client filters it with `~` (substring), not `=`, because PB stores a datetime | device (POST), dashboard |
| `time_in` | datetime, nullable | | device, dashboard |
| `time_out` | datetime, nullable | | device, dashboard |
| `lunch_out` | datetime, nullable | **legacy**, superseded by `lunch_events`; still cleared on reset | dashboard |
| `lunch_in` | datetime, nullable | **legacy**, as above | dashboard |
| `lunch_events` | json (array of `{type: "out"\|"in", time}`) | the device sends this as a **JSON string**, not a nested object (see `fields.h`) | device, dashboard |
| `status` | `present`\|`late`\|`absent`\|`jLate`\|`jAbsent`, nullable | **legacy combined enum**, kept in sync with `arrival` + `justified` by every writer | device, dashboard |
| `lunch_status` | same enum, nullable | | device, dashboard |
| `arrival` | `present`\|`late`\|`absent`, nullable | the fact of arrival, independent of justification | device, dashboard |
| `justified` | bool | only meaningful when `arrival` is `late` or `absent` | dashboard only |
| `justification_reason` | text, nullable | | dashboard only |
| `justified_by` | relation → `users`, nullable | deliberately **not** cleared by `resetAttendance` — kept as an audit breadcrumb | dashboard only |
| `justified_at` | datetime, nullable | same | dashboard only |

The split `arrival`/`justified` model exists so that marking a day excused does
not destroy the underlying fact that the learner was late. `status` is the older
single enum; it is written alongside so existing queries and reports keep working
(`withDerivedStatus` in `queries/attendance.ts`).

**The device never writes `justified`.** It writes `status` directly, including
`jLate` — see the examples in `apps/nfc-attender-fw/src/fields.h`. Justification
is a guide action, taken in the dashboard.

**Three implementations of the attendance rule.** `packages/shared/src/attendance.ts`,
a hand-duplicated `deriveStatus` in `packages/pb-client/src/queries/attendance.ts`
carrying a `MUST STAY IN SYNC` banner, and a C++ port in
`apps/nfc-attender-fw/src/state_machine.cpp`. Nothing in CI compares them. If they
drift, the same tap produces different rows depending on which client handled it,
and the backend will not notice.

Device request shapes, from `pb_request.cpp`:

| Purpose | Request |
|---|---|
| Find today's row for one learner | `GET /api/collections/attendance/records?perPage=1&page=1&filter=learner = "<id>" && date ~ "<date>"` |
| Boot pre-fetch of the whole day | `GET /api/collections/attendance/records?page=N&perPage=M&filter=date ~ "<date>"` |
| Delta sync | `GET /api/collections/attendance/records?page=N&perPage=M&sort=updated&filter=date ~ "<date>" && updated > "<since>"` |
| First tap of the day | `POST /api/collections/attendance/records` body `{"learner":"<id>","date":"<date>"}` |
| Every subsequent tap | `PATCH /api/collections/attendance/records/<id>` |

`since` is the highest `updated` value the device has already seen, never device
time — clock skew against server time would otherwise silently skip rows.
`sort=updated` ascending means a truncated multi-page delta still advances the
watermark monotonically.

### `calendar`

Source: `CalRecord` in `packages/pb-client/src/types.ts`;
`packages/pb-client/src/queries/calendar.ts`; RSVP fields added by
[`RSVP_MIGRATION.md`](./RSVP_MIGRATION.md).

| Field | Type | Notes |
|---|---|---|
| `title` | text | |
| `start`, `end` | datetime | |
| `color`, `emoji` | text | |
| `type` | `event` \| `class` | load-bearing for access control: `class` entries are private to their creator |
| `recurrence` | `none` \| `weekly` | |
| `recurrence_days` | json, `number[]` | `0 = Mon … 6 = Sun` |
| `recurrence_end` | date | |
| `created_by` | relation → `users` | |
| `programs` | multi-select, optional | subset of `chmk`/`cre`/`exp`; unset = not program-scoped |
| `rsvp_enabled` | bool, default `false` | events only |
| `capacity` | number, optional, min 0 | null or 0 = unlimited |
| `rsvp_deadline` | datetime, optional | null = no deadline |
| `allow_waitlist` | bool, default `true` | |

Written and read by the calendar app; guides and admins create events, learners
create their own `class` entries.

### `conversations` and `messages`

Source: `Conversation` and `Message` in `packages/pb-client/src/types.ts`;
`packages/pb-client/src/queries/messages.ts`.

`conversations`:

| Field | Type | Notes |
|---|---|---|
| `participants` | relation → `users`, **multiple** | filtered with `participants.id ?= {:userId}` |
| `last_message` | text | denormalised preview |
| `last_message_at` | datetime | sort key for the inbox |
| `last_sender` | relation → `users` | |

`messages`:

| Field | Type | Notes |
|---|---|---|
| `conversation` | relation → `conversations` | |
| `sender` | relation → `users` | |
| `body` | text | |
| `read_by` | relation → `users`, **multiple** | sender is added at create time |

`subscribeToMessages` uses PocketBase realtime on `messages` with a wildcard
subscription and filters client-side, so **every authenticated client receives a
realtime event for every message it is permitted to see**. The view rule on
`messages` is what actually contains that, and it is not documented anywhere in
this repo.

### `invites`

Source: `Invite` in `packages/pb-client/src/types.ts`;
`packages/pb-client/src/queries/invites.ts`; `../pb_hooks/invites.pb.js`.

| Field | Type | Notes |
|---|---|---|
| `code` | text, **unique** | 6 chars, `[A-Z0-9]`, generated by `generateInviteCode` |
| `learner` | relation → `learners` | |
| `email` | email | becomes the new user's email |
| `expires_at` | datetime | `createInvite` sets +7 days; the hook filters `expires_at > @now` |
| `used` | bool | |
| `used_at` | datetime, optional | |
| `created_by` | relation → `users` | |

The unique index on `code` is required, not optional: the redemption hook's
correctness depends on `findFirstRecordByFilter` resolving one record.

### `event_rsvps`

Source: `EventRsvp` in `packages/pb-client/src/types.ts`;
`packages/pb-client/src/queries/rsvp.ts`; `../pb_hooks/event_rsvps.pb.js`.

| Field | Type | Notes |
|---|---|---|
| `event` | relation → `calendar`, cascade delete | hook validates against `/^[a-zA-Z0-9]{15}$/` |
| `occurrence_date` | text, optional | `YYYY-MM-DD` for recurring occurrences, empty/null for one-off; hook validates `/^\d{4}-\d{2}-\d{2}$/` |
| `user` | relation → `users`, cascade delete | hook validates the ID format and the caller's ownership |
| `status` | `going` \| `not_going` \| `waitlisted` | the client sends **intent** (`going`/`not_going`); the hook may rewrite it to `waitlisted` |
| `position` | number, optional | waitlist ordinal, 1-indexed; null for `going`/`not_going` |
| `responded_at` | datetime | set by the client |

Requires a unique index on `(event, occurrence_date, user)`. See
[`RSVP_MIGRATION.md`](./RSVP_MIGRATION.md) for the index DDL and the admin steps.

### `audit_log`

Source: `apps/nfc-attender/src/lib/audit.ts`.

| Field | Type | Notes |
|---|---|---|
| `actor` | relation → `users`, optional | null for anonymous |
| `action` | text, required | stable id; `AuditAction` declares `csv_export`, `history_admin_view`, `bulk_attendance_edit` |
| `details` | json, optional | structured context |

**This collection may not exist.** [`../pb_hooks/README.md`](../pb_hooks/README.md)
labels it "optional, but recommended", but `logAuditEvent` already writes to it
from the dashboard. The write is wrapped in `try`/`catch` and swallows every
failure — missing collection, offline, 403 — because auditing is observability and
must never block a user's download.

**Only one of the three declared actions is actually emitted.** The single
`logAuditEvent` call site in the repo is `csv_export`, in
`apps/nfc-attender/src/app/history/admin/page.tsx`. `history_admin_view` and
`bulk_attendance_edit` exist in the `AuditAction` union but nothing calls them, so
admin history views and bulk attendance edits are currently **not** audited even
if the collection does exist.

The consequence is that if the collection was never created, **every privileged
action goes unaudited and nothing anywhere reports it.** In development you get a
`debug.warn`; in production you get silence. There is no repo-side way to tell
which state the instance is in. Check it (see below) before relying on the audit
trail for anything.

## API rules

PocketBase evaluates collection API rules **before** JS hooks fire. The hooks are
defence in depth; the rules are the gate. This is also stated in
[`SECURITY.md`](./SECURITY.md).

### Rules documented in this repo

[`../pb_hooks/README.md`](../pb_hooks/README.md) is the only place with rule
expressions written down as rules. It covers, in full:

- `users` — list, view, create, update, delete
- `event_rsvps` — list, view, create, update, delete
- `audit_log` — list, view, create, update, delete (append-only)

and, for `learners` and `attendance`, **a read rule only**:

```
@request.auth.role = "lg" || @request.auth.role = "admin"
```

One more rule is documented, but only as a code comment rather than in a doc —
the `calendar` list/view rule, in the docblock of `fetchCalendarEvents`
(`packages/pb-client/src/queries/calendar.ts`):

```
created_by = @request.auth.id ||
(type = "event" && (@request.auth.role = "lg" || @request.auth.role = "admin")) ||
(type = "event" && @request.auth.learner.program != "" && programs ~ @request.auth.learner.program)
```

That comment also records a real constraint: `~` (substring) is used instead of
`?=` on the multi-select `programs` field because `?=` does not match in the
deployed PB version, and it is only safe because `chmk`/`cre`/`exp` are mutually
disjoint. A fourth program code that is a substring of another would silently
break the rule.

### Rules NOT documented anywhere in this repo

> **The device's write authorization is undocumented.** Only a *read* rule is
> written down for `attendance`, yet the ESP32 terminal does `POST
> /api/collections/attendance/records` and `PATCH
> /api/collections/attendance/records/<id>` on every tap of every day. Whatever
> permits those writes is configured in the PocketHost admin UI and exists
> nowhere else: unversioned, unreviewed, un-diffable, and impossible to
> reproduce from this repository. If the instance is lost or rebuilt, the exact
> expression is gone. Copy it out of the admin console and into this document
> the next time you are in there.

The same applies, with less operational urgency, to:

| Collection | What is missing |
|---|---|
| `attendance` | create, update, delete rules (the device and dashboard both write) |
| `learners` | create, update, delete rules (the enrol CLI and dashboard both write) |
| `calendar` | create, update, delete rules; the list/view rule exists only in a code comment |
| `conversations` | all five rules |
| `messages` | all five rules, including the realtime-visible view rule |
| `invites` | all five rules (the redemption route is unauthenticated by design and runs as the hook, but the dashboard's create/list path goes through normal rules) |
| `users` | auth options: "Forbid authentication for unverified users", password minimums, OAuth providers, token durations |

Also not in the repo: indexes (beyond the two this document argues are required),
file-storage settings, SMTP configuration, backup schedule, and rate limiting.

## Device account procedure

Each NFC terminal needs its own `users` record with role `lg`. It cannot be
created by the app or by a script, and that is by design:
`../pb_hooks/users.pb.js` rejects any create request whose `role` is not
`learner` unless the caller is authenticated **and** already has role `admin`.
Anonymous creation is forced to `learner`. So a device account is a manual admin
console action.

Steps, in the PocketHost admin at `https://learnlife.pockethost.io/_/`:

1. **Collections → users → New record.**
2. Set `email` to something identifying the physical unit. The existing
   convention, per [`SECURITY.md`](./SECURITY.md), is `device-NN@…`. This string
   ends up in PocketBase's request logs, which is the point.
3. Set a long random `password`. Store it in whatever the project's password
   manager is — it is entered once, into the device's captive-portal setup page,
   and never displayed again.
4. Set `role` to `lg`. **Required**: `learners` and `attendance` restrict reads to
   `lg`/`admin`, so a `learner`-role device sees an empty roster and reports every
   card as "Unknown card".
5. Set `verified` to **true**. If the `users` collection has *"Forbid
   authentication for unverified users"* enabled, an unverified device account
   fails `auth-with-password` with an error that does not say "unverified" — the
   device just reports a login failure forever. This is the single most common
   provisioning trap.
6. Leave `learner` empty. A device is not a person.
7. Provision the device: power it on unprovisioned, join the `LL-Attender-XXXX`
   AP shown on its OLED, and enter WiFi, the PocketBase URL, this account, and a
   device name. Full procedure in
   [`../apps/nfc-attender-fw/README.md`](../apps/nfc-attender-fw/README.md).

**One account per device, not one shared account.** Two reasons, both operational:

- A unit that is lost or stolen is revoked by disabling one record. A shared
  account means rotating the password on every remaining terminal, each of which
  requires physically re-running the captive-portal flow.
- PocketBase's request logs record the authenticated identity. With per-device
  accounts you can tell which terminal wrote a row, or which one is burning the
  request budget. With a shared account you cannot.

To revoke: disable or delete the `users` record in the admin console — the full
lost-device runbook is in [`SECURITY.md`](./SECURITY.md). The device fails its
next login; `apps/nfc-attender-fw/src/pb_result.h` classifies 403 as a permanent
failure, so queued writes move to the dead-letter file rather than retrying
forever.

## Request budget

PocketHost allows **1000 requests/hour per IP**. Both terminals and the dashboard
sit behind the school's single NAT, so they share one budget. That number is not
a guideline the firmware respects out of politeness — it is the constraint that
picks the sync interval.

The derivation, from
[`../apps/nfc-attender-fw/README.md`](../apps/nfc-attender-fw/README.md):

| Poll interval | Idle delta-sync cost, two devices | Share of budget |
|---|---|---|
| 10 s | 720/h | 72% |
| **30 s** | **240/h** | **24%** |

30 s is therefore derived, not chosen. It is the point at which idle polling stops
crowding out real traffic.

At ~80 learners and two terminals:

| Source | Requests/hour |
|---|---|
| Delta sync, 30 s, both devices, always on | 240 |
| Morning rush: ~80 first taps × (GET + POST + PATCH) | ~240, concentrated in the arrival hour |
| Lunch window: ~80 × 2 taps, cache hit + PATCH | ~160 |
| Dashboard | negligible — realtime SSE, one long-lived connection, not polling |

Peak is the arrival hour at roughly **500/hour against 1000** — about 2× headroom.

**That headroom is the binding constraint on a third terminal.** A third unit adds
120/h of idle delta sync plus its own share of taps, which puts the arrival hour
uncomfortably close to the cap. Raise `kDeltaPollMs` in
`apps/nfc-attender-fw/src/main.cpp` to 60000 before adding one.

Two design choices fall out of the same budget:

- The device fetches the roster once at boot and caches it to LittleFS, rather
  than re-reading `learners` per tap.
- The delta sync asks only for rows PocketBase itself has touched
  (`updated > <watermark>`), so a quiet poll returns an empty page instead of ~61
  rows.

Check the real figure in the PocketBase admin under Settings → Logs after a live
morning. Expect ~500; investigate above ~800.

## Verifying the live instance

Nothing in CI can check any of this — the instance is not reachable from a
workflow and there is no schema export in the repo to diff against. Verification
is manual, and it is worth doing after any admin-console change.

**1. Export the schema and keep it.** PocketBase's admin console can export the
full collection definitions as JSON (Collections → the export action; the exact
menu label varies by PB version, so this specific step is unverified against the
deployed version). Save that file somewhere durable. It is the only artefact that
makes the backend reproducible, and it is what would let a future version of this
document be generated instead of reconstructed.

**2. Confirm every collection in this document exists**, in particular
`audit_log`, whose absence is silent. From the admin console, Collections should
list: `users`, `learners`, `attendance`, `calendar`, `conversations`, `messages`,
`invites`, `event_rsvps`, `audit_log`.

A live check for `audit_log` specifically: sign in to the dashboard as an admin,
export a CSV, then look for a new `audit_log` row with `action = "csv_export"`. No
row means the collection is missing or its create rule rejects `lg`/`admin`, and
either way auditing is off.

**3. Confirm the read rules actually deny.** An unauthenticated read of a
protected collection must fail:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://learnlife.pockethost.io/api/collections/learners/records?perPage=1'
```

Anything in the 2xx range means the `learners` list rule is open to the public
internet. Repeat for `attendance`, `users`, `invites` and `audit_log`.

**4. Write down the attendance write rules.** Open Collections → attendance → API
Rules, copy the create and update expressions, and paste them into the
[Rules NOT documented](#rules-not-documented-anywhere-in-this-repo) section above.
That single edit removes the largest reproducibility gap described here.

**5. Confirm the hooks are loaded.** See
[`../pb_hooks/README.md`](../pb_hooks/README.md) for the upload procedure and the
per-hook behaviour checks.

**6. Confirm the auth setting.** Collections → users → Options: note whether
"Forbid authentication for unverified users" is on, because it changes the device
account procedure above from "recommended" to "mandatory".

## Not verifiable from this repository

Collected in one place, so the list is honest:

- Every API rule not listed under [Rules documented in this repo](#rules-documented-in-this-repo) — most importantly the `attendance` create/update rules the ESP32 depends on.
- Whether `audit_log` exists at all.
- Whether the unique indexes on `invites.code`, `learners.NFC_ID` and `event_rsvps (event, occurrence_date, user)` were ever created.
- Whether `learners.email` and `learners.dob` are required, given the enrolment CLI does not send them.
- The exact PocketBase version PocketHost is running. `../pb_hooks/event_rsvps.pb.js` targets the 0.31+ JS hook API and `../pb_hooks/invites.pb.js` says 0.22+; both use `e.auth`, which is the newer API, so the effective floor is the newer one. The deployed version is not pinned anywhere.
- Whether the hook files currently uploaded to PocketHost match the ones in `pb_hooks/`. There is no CI, no checksum, and no upload log.
- Auth options, SMTP, backups, file storage, and rate-limit configuration.
