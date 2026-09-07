# RSVP migration — historical record

This is the record of a migration that has already been applied to the hosted
PocketBase at `https://learnlife.pockethost.io/`: adding RSVP support with
capacity and waitlists to the `calendar` collection, creating `event_rsvps`, and
installing a server hook to enforce capacity atomically.

It is kept because the admin-console steps in sections 1–3 are not recorded
anywhere else, and would have to be redone from scratch if the backend were ever
rebuilt. It is **not** the specification of the hook. The hook shipped, then
changed; [`../pb_hooks/event_rsvps.pb.js`](../pb_hooks/event_rsvps.pb.js) is the
source of truth for its behaviour, and
[`../pb_hooks/README.md`](../pb_hooks/README.md) documents it. Section 4 below
now records only how the shipped hook differs from the version this document
originally proposed, so that nobody re-pastes the old one over it.

> **Whether the admin-console steps below were ever actually applied cannot be
> verified from this repository.** There is no schema export committed, no CI
> that can reach the instance, and no migration log. The evidence that they were
> applied is indirect: `apps/ll-calendar` ships a working RSVP UI and
> `packages/pb-client/src/queries/rsvp.ts` queries `event_rsvps` unconditionally.
> To actually confirm, follow the verification steps in
> [`POCKETBASE.md`](./POCKETBASE.md#verifying-the-live-instance).

All steps here are reversible — see [Rollback](#rollback).

## 1. Fields added to the `calendar` collection

**Collections → calendar → Fields → New field**, four optional fields:

| Field name       | Type    | Notes                                              |
|------------------|---------|----------------------------------------------------|
| `rsvp_enabled`   | Bool    | default `false`                                    |
| `capacity`       | Number  | optional; integer; min `0`. Empty or 0 = unlimited |
| `rsvp_deadline`  | Date    | optional; full date+time                           |
| `allow_waitlist` | Bool    | default `true`                                     |

Non-breaking: records without them simply have RSVP off. These match the optional
fields on `CalRecord` in `packages/pb-client/src/types.ts`.

## 2. The `event_rsvps` collection

**Collections → New collection → Base**, named `event_rsvps`.

| Field name        | Type        | Required | Notes                                        |
|-------------------|-------------|----------|----------------------------------------------|
| `event`           | Relation    | yes      | → `calendar`, single, cascade delete         |
| `occurrence_date` | Plain text  | no       | `YYYY-MM-DD` for recurring; empty for one-off |
| `user`            | Relation    | yes      | → `users`, single, cascade delete            |
| `status`          | Select      | yes      | options: `going`, `not_going`, `waitlisted`  |
| `position`        | Number      | no       | waitlist ordinal (1-indexed); null otherwise |
| `responded_at`    | Date        | yes      |                                              |

Unique index on `(event, occurrence_date, user)`, so a user cannot hold two RSVPs
for the same occurrence. In the collection's **Indexes** tab:

```
CREATE UNIQUE INDEX `idx_event_rsvps_unique` ON `event_rsvps`
  (`event`, `occurrence_date`, `user`);
```

The index matters beyond tidiness: `submitRsvp` in
`packages/pb-client/src/queries/rsvp.ts` does a read-then-upsert, so without the
constraint a double submit can create two rows and the hook's capacity count then
double-counts that user.

## 3. API rules for `event_rsvps`

Applied in the collection's **API Rules** tab:

```
List/Search rule:
  user = @request.auth.id ||
  @request.auth.role = "lg" ||
  @request.auth.role = "admin"

View rule:
  user = @request.auth.id ||
  @request.auth.role = "lg" ||
  @request.auth.role = "admin"

Create rule:
  @request.auth.id != "" &&
  user = @request.auth.id

Update rule:
  user = @request.auth.id ||
  @request.auth.role = "lg" ||
  @request.auth.role = "admin"

Delete rule:
  user = @request.auth.id ||
  @request.auth.role = "admin"
```

A user reads, creates, updates and deletes their own RSVP. Guides see any event's
roster and can edit it. Admins can override anything. These are duplicated in
[`../pb_hooks/README.md`](../pb_hooks/README.md), which is the maintained copy.

## 4. The hook — how the shipped version differs

The hook is [`../pb_hooks/event_rsvps.pb.js`](../pb_hooks/event_rsvps.pb.js).
**Do not reconstruct it from this document.** Earlier revisions of this file
carried a full inline copy of the source; that copy fell behind the shipped file
in four ways, all of them load-bearing. The differences, so a reader who
remembers the old version is not surprised:

| Area | This document's original proposal | Shipped hook |
|---|---|---|
| Identity | none — relied entirely on the `create` API rule to bind `user` to the caller | `assertOwner(e)` runs first on both create and update: requires auth, and requires `record.user == e.auth.id` unless the caller is `lg` or `admin` |
| Input validation | none | `assertId` enforces `/^[a-zA-Z0-9]{15}$/` on `event` and `user`; `assertOccurrenceDate` enforces `/^\d{4}-\d{2}-\d{2}$/` |
| One-off occurrence filter | `occurrence_date = null` | `(occurrence_date = "" \|\| occurrence_date = null)`, and callers pass `… \|\| ""`, so empty-string rows are counted too |
| Query page size | `findRecordsByFilter(…, 0, 0)` — unlimited | `findRecordsByFilter(…, 1000, 0)` — a real 1000-RSVP-per-occurrence ceiling |

The first two are the important ones, and they are related. The capacity query
builds its filter by string interpolation rather than parameter binding:

```js
`event = "${eventId}" && occurrence_date = "${occurrenceDate}" && user != "${userId}"`
```

The regex guards are what make that safe, which is why they run before the filter
is constructed. The ownership check exists because the `create` rule
(`user = @request.auth.id`) is the only thing otherwise preventing an RSVP on
another user's behalf, and a single fat-fingered rule edit in the admin console
removes it with no trace in git.

The third difference was a real bug: rows written with an empty-string
`occurrence_date` rather than SQL `NULL` were invisible to the old filter, so a
one-off event's capacity count could come back short and over-admit.

Everything else — intent rewriting, deadline check, unlimited-capacity path,
waitlist append, promotion and renumbering on cancel or delete — is unchanged in
substance. See [`../pb_hooks/README.md`](../pb_hooks/README.md) for the outcome
table.

### PocketBase version

Earlier revisions of this document said the hook API names matched PocketBase
0.22+ and offered 0.20 fallbacks (`onRecordBeforeCreateRequest` etc.). That note
is obsolete. The shipped file declares the **0.31+** JS hook API and uses `e.auth`
and `e.next()`. Do not downgrade the handler names.

The version PocketHost actually runs is not pinned anywhere in this repo.

### Upload

Hooks are uploaded by hand to **Settings → Files → `pb_hooks/`** in the PocketHost
admin. No CI covers this. Full procedure and post-upload verification in
[`../pb_hooks/README.md`](../pb_hooks/README.md#upload-procedure).

## 5. Smoke test

Still the best end-to-end check that steps 1–4 are all in place. Run it after any
hook upload.

1. Pick an existing event, set `rsvp_enabled = true`, `capacity = 2`,
   `allow_waitlist = true`.
2. Log in as Learner A → "Going" → confirm status = `going` in admin.
3. Log in as Learner B → "Going" → confirm status = `going`.
4. Log in as Learner C → "Going" → confirm status = `waitlisted`,
   `position = 1`.
5. Log in as Learner A → "Not going" → confirm Learner C is now `going`
   and `position` is null.

Failure modes and what they mean:

| Symptom | Likely cause |
|---|---|
| Step 4 gives `going`, not `waitlisted` | the hook is not loaded at all, or `capacity` was not saved on the calendar record |
| Step 5 does not promote | the post-update path is not firing — check the hook file uploaded cleanly and the handler names were not downgraded |
| Any step 403s | an API rule from section 3 is missing or wrong; rules are evaluated before hooks |
| Step 2 rejected with "cannot RSVP on behalf of another user" | the client is sending a `user` that is not the authenticated caller |

## Known divergence in the calendar app

`apps/ll-calendar/lib/pocketbase.ts` still contains a client-side capacity and
waitlist implementation, with a comment stating that PocketHost's free tier does
not run custom hooks and that server-side enforcement is the intended design. That
comment is stale — the hook is shipped. Noted here because a reader following this
migration will hit that comment and reasonably conclude the migration was never
completed. Fixing it is out of this document's scope.

## Rollback

Drop the `event_rsvps` collection, remove the four added `calendar` fields, and
delete `event_rsvps.pb.js` from `pb_hooks/` in the admin file browser. The client
code tolerates missing fields — RSVP simply will not be offered on any event.
