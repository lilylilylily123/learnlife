# PocketBase hooks

Three server-side JavaScript hook files for the hosted PocketBase backend at
`https://learnlife.pockethost.io/`. They are the only server-side code this
repository owns — the collections, fields, indexes, API rules and auth settings
all live in the PocketHost admin console and are not in the repo at all. See
[`../docs/POCKETBASE.md`](../docs/POCKETBASE.md) for the schema and rule
reference reconstructed from the clients.

Hooks exist here for one reason: three things had to be enforced on the server
because no client can be trusted to enforce them. Role escalation, invite
redemption atomicity, and event capacity are all cases where a hostile or merely
crashed client produces a wrong row that no later cleanup can fully undo.

> **No CI covers this directory.** None of the six workflows in
> `.github/workflows/` reference `pb_hooks/`. There are no tests. `pnpm lint`
> runs `pnpm -r lint`, which only recurses into workspace packages, and
> `pb_hooks/` is not one — it has no `package.json` and is not matched by
> `pnpm-workspace.yaml`. So these files are never parsed, linted, type-checked
> or executed by anything except the production instance. **A syntax error or a
> logic regression is discoverable only in production, after a manual upload.**
> Read [Upload procedure](#upload-procedure) before touching anything here.

## Where hooks sit in the request path

PocketBase evaluates the collection's API rule **first**, then runs the hook.
A hook cannot rescue a permissive rule for reads, and a restrictive rule will
reject a request before the hook ever sees it. The practical consequences:

- The rules are the primary gate. The hooks are defence in depth for the cases
  where a rule expression is easy to get subtly wrong.
- If a hook seems not to fire, check whether the rule rejected the request first.
- Rules live only in the admin console. Nothing in this repo can verify that the
  rules below are actually set — [`../docs/POCKETBASE.md`](../docs/POCKETBASE.md)
  has a manual verification procedure.

## The three hooks

| File | Binds to | Events | Enforces |
|---|---|---|---|
| `users.pb.js` | `users` | `onRecordCreateRequest`, `onRecordUpdateRequest` | role cannot be self-elevated |
| `invites.pb.js` | custom route | `POST /api/redeem-invite` | invite redemption is atomic and single-use |
| `event_rsvps.pb.js` | `event_rsvps` | `onRecordCreateRequest`, `onRecordUpdateRequest`, `onRecordAfterDeleteSuccess` | capacity, waitlist ordering, RSVP ownership |

### `users.pb.js` — role escalation

Prevents a self-signup or a self-update from setting `role` to `lg` or `admin`.

`ALLOWED_ROLES` is `["learner", "lg", "admin"]`; anything else is rejected
outright on both create and update. Beyond that:

| Caller | Requested role | Result |
|---|---|---|
| anonymous | unset | forced to `learner` |
| anonymous | `learner` | allowed, forced to `learner` anyway |
| anonymous | `lg` or `admin` | `BadRequestError`, "only learner role can be self-assigned" |
| authenticated non-admin | `lg` or `admin` on create | `BadRequestError`, "only admins can create elevated accounts" |
| authenticated admin | any valid role | allowed |
| anyone | role changed on update, caller not admin | `BadRequestError`, "only admins can change a user's role" |

The update hook re-reads the original record with `$app.findRecordById` and
compares roles, so an update that merely re-sends the unchanged role passes. Only
an actual transition is gated.

**The attack this prevents:** the `users` create rule is the primary gate, and its
expression (`@request.body.role:isset = false || @request.body.role = "learner"`)
is exactly the kind of thing that gets loosened during debugging and never tightened
back. If it is, anyone who can hit the public signup endpoint mints themselves an
`admin` and gains read access to every learner's name, email, date of birth and
attendance history. The hook makes that require two independent mistakes.

**Direct operational consequence:** because elevated roles cannot be created
except by an authenticated admin, every NFC terminal's device account (role `lg`)
must be created by hand in the admin console. That procedure is in
[`../docs/POCKETBASE.md`](../docs/POCKETBASE.md).

### `invites.pb.js` — atomic invite redemption

Adds an unauthenticated route:

```
POST /api/redeem-invite
body:    { "code": "ABC123", "password": "…" }
returns: standard PB record-auth response { token, record }
```

Called by `redeemInvite` in `packages/pb-client/src/queries/invites.ts`.

Input is validated before any database work: `code` must match `/^[A-Z0-9]{6}$/`
(after upcasing) and `password` must be at least 8 characters. The route is
deliberately anonymous — the whole point is that the person redeeming does not yet
have an account — so those guards are the only thing standing between the public
internet and a transaction.

Inside a single `$app.runInTransaction`:

1. Find an `invites` record matching `code = {:code} && used = false && expires_at > @now`. No match means "Invalid or expired code" — the same message for wrong, used and expired, so the endpoint is not an invite-code oracle.
2. Look up the linked `learners` record for a display name, falling back to the invite's email. A missing learner is non-fatal.
3. Create the `users` record with `role: "learner"`, `verified: true`, `emailVisibility: false`, and the forward FK `learner`.
4. Best-effort write of the `user` back-reference onto the `learners` record. Wrapped in its own `try`/`catch`: the forward FK on `users` is the source of truth, so failing here does not roll back the redemption.
5. Mark the invite `used = true`, `used_at = now`.

**The two race windows this closes.** The previous flow was three client calls —
check invite, create user, mark invite used. That allowed:

- Two clients racing on the same code, both seeing `used = false`, both creating an account.
- A client crashing between steps 2 and 3, leaving a live user account and an invite still marked unused.

Neither is recoverable by a retry, and both produce state a human has to untangle.
Making the whole thing one transaction is the only fix that does not require
distributed coordination on the client.

Requires the `invites` collection to have `code` (text, **unique**), `learner`
(relation), `email` (email), `expires_at` (datetime), `used` (bool), `used_at`
(datetime, optional). The unique index on `code` is load-bearing —
`findFirstRecordByFilter` picking one of several duplicates would reintroduce the
double-redemption case.

### `event_rsvps.pb.js` — capacity, waitlist, ownership

The client sends the user's **intent** (`going` or `not_going`); the hook computes
the persisted `status` and `position`. `waitlisted` is a server-assigned outcome
and is rejected if a client sends it.

Three guards run before any capacity logic:

- `assertOwner` — requires authentication, and requires `record.user` to equal the
  caller's id unless the caller is `lg` or `admin`.
- `assertId` — `event` and `user` must match `/^[a-zA-Z0-9]{15}$/`.
- `assertOccurrenceDate` — if present, must match `/^\d{4}-\d{2}-\d{2}$/`.

The ID and date regexes are not cosmetic. The capacity query builds its filter by
**string interpolation**, not parameter binding:

```js
`event = "${eventId}" && occurrence_date = "${occurrenceDate}" && user != "${userId}"`
```

Validating the three interpolated values against strict character classes first is
what makes that safe. Removing either the regex checks or the validation ordering
reopens filter injection. If you refactor this function, keep `assertId` and
`assertOccurrenceDate` above the filter construction.

`applyRsvpRules`, run on both create and update:

| Condition | Outcome |
|---|---|
| intent `not_going` | `position` cleared, accepted |
| intent neither `going` nor `not_going` | `BadRequestError` |
| `calendar.rsvp_enabled` false | `BadRequestError`, "RSVP is not enabled for this event" |
| `rsvp_deadline` set and passed | `BadRequestError`, "RSVP deadline has passed" |
| `capacity` null or ≤ 0 | unlimited; `status = going`, `position` cleared |
| going count (excluding this user) < capacity | `status = going`, `position` cleared |
| full, `allow_waitlist` false | `BadRequestError`, "Event is full and waitlist is disabled" |
| full, `allow_waitlist` true | `status = waitlisted`, `position` = max existing + 1 |

`maybePromoteWaitlist` runs after a `going → not_going` update and after any
delete of a `going` row. It promotes the first N waitlisters into the open spots
and renumbers the rest to close the gap, writing only records whose position
actually changed.

Both filter queries page with `perPage = 1000`, which caps a single occurrence at
1000 RSVPs. Beyond that the counts would be wrong. That is far above any plausible
school event, but it is a real ceiling rather than "all records".

**Why this cannot be client-side:** capacity is a read-then-write. Two learners
submitting "Going" simultaneously both read the same going-count and both conclude
a seat is free. On the server, inside the request handler, the check and the write
are close enough together that the window is not practically exploitable at this
concurrency.

Note that `apps/ll-calendar/lib/pocketbase.ts` still contains a client-side
capacity implementation whose comment claims PocketHost's free tier cannot run
hooks. That comment is stale — the hook is shipped and this file is it. Not this
directory's file to fix.

## Upload procedure

There is no automation. Uploading is manual, and nothing verifies afterwards that
what is running matches what is in git.

1. **Read the whole file you are about to upload.** No linter or parser will see
   it before PocketBase does. A syntax error takes hooks down for the whole
   instance, not just the file with the error.
2. Sign in to the PocketHost admin at `https://learnlife.pockethost.io/_/`.
3. Go to **Settings → Files → `pb_hooks/`**.
4. Upload the `*.pb.js` files. PocketBase loads every `.pb.js` in `pb_hooks/`
   automatically and restarts the JS VM on change.
5. **Verify immediately**, per hook, against the checks below. There is no other
   feedback channel: a hook that failed to load simply does not run, and requests
   succeed without its enforcement.

The `/// <reference path="../pb_data/types.d.ts" />` line at the top of each file
is an editor affordance for PocketBase's generated type definitions. `pb_data/`
does not exist in this repo, so those references resolve to nothing here; they
resolve on a machine with a local PocketBase checkout. Harmless either way — it
is a comment.

### Post-upload verification

| Hook | Check | Expected |
|---|---|---|
| `users.pb.js` | Sign out, sign up with `role: "admin"` in the body | rejected, "only learner role can be self-assigned" |
| `users.pb.js` | As a non-admin, PATCH your own `users` row to `role: "lg"` | rejected, "only admins can change a user's role" |
| `invites.pb.js` | `curl -X POST …/api/redeem-invite -d '{"code":"zzz","password":"short"}'` | 400, "Invalid code format" |
| `invites.pb.js` | Redeem a real invite twice | second attempt "Invalid or expired code"; exactly one `users` record created |
| `event_rsvps.pb.js` | The 5-step smoke test in [`../docs/RSVP_MIGRATION.md`](../docs/RSVP_MIGRATION.md) | third RSVP waitlisted at position 1; promoted when the first cancels |

## Collection API rules these hooks assume

These must be set in the admin console. The hooks do not set them and cannot
compensate for their absence on reads. This is the complete set of rules written
down anywhere in the repository — see
[`../docs/POCKETBASE.md`](../docs/POCKETBASE.md) for the much longer list of rules
that are **not** documented, including the `attendance` write rules the ESP32
terminal depends on.

### `users`

| Rule | Expression |
|---|---|
| List | `id = @request.auth.id \|\| @request.auth.role = "admin"` |
| View | `id = @request.auth.id \|\| @request.auth.role = "admin"` |
| Create | `@request.body.role:isset = false \|\| @request.body.role = "learner"` |
| Update | `id = @request.auth.id \|\| @request.auth.role = "admin"` |
| Delete | `@request.auth.role = "admin"` |

`users.pb.js` enforces the create and update constraints again at the hook layer.

### `learners`, `attendance`

Read (list and view) restricted to guides, admins, and device accounts:

```
@request.auth.role = "lg" || @request.auth.role = "admin"
```

**Only the read rule is documented.** Both collections are written — `attendance`
by the dashboard and by the ESP32 terminal on every tap, `learners` by the
dashboard and the Rust enrolment CLI — and the rules permitting those writes exist
only in the admin console. This is the largest reproducibility gap in the project;
[`../docs/POCKETBASE.md`](../docs/POCKETBASE.md) says so at more length.

### `event_rsvps`

| Rule | Expression |
|---|---|
| List | `user = @request.auth.id \|\| @request.auth.role = "lg" \|\| @request.auth.role = "admin"` |
| View | `user = @request.auth.id \|\| @request.auth.role = "lg" \|\| @request.auth.role = "admin"` |
| Create | `@request.auth.id != "" && user = @request.auth.id` |
| Update | `user = @request.auth.id \|\| @request.auth.role = "lg" \|\| @request.auth.role = "admin"` |
| Delete | `user = @request.auth.id \|\| @request.auth.role = "admin"` |

`event_rsvps.pb.js` re-checks `user` against `@request.auth.id` via `assertOwner`
on every create and update, so a misconfigured rule cannot be used to RSVP on
another user's behalf. Note the update rule permits `lg`/`admin` to edit anyone's
RSVP, and `assertOwner` deliberately allows that too — guides manage rosters.

### `audit_log`

Append-only log of privileged actions, written by
`apps/nfc-attender/src/lib/audit.ts`. The write is non-blocking and swallows all
errors, so **if this collection does not exist, auditing silently does nothing.**
It is not optional if you want an audit trail; it is optional only in the sense
that its absence does not break the app. The `AuditAction` union declares
`csv_export`, `history_admin_view` and `bulk_attendance_edit`, but only
`csv_export` has a call site today — see
[`../docs/POCKETBASE.md`](../docs/POCKETBASE.md).

| Field | Type | Notes |
|---|---|---|
| `actor` | relation → users (optional) | null for anonymous events |
| `action` | text (required) | stable id, e.g. `csv_export` |
| `details` | json (optional) | structured context |

| Rule | Expression |
|---|---|
| List | `@request.auth.role = "admin"` |
| View | `@request.auth.role = "admin"` |
| Create | `@request.auth.role = "lg" \|\| @request.auth.role = "admin"` |
| Update | _(empty — block all writes)_ |
| Delete | _(empty — block all writes)_ |

## PocketBase version

`event_rsvps.pb.js` declares the 0.31+ JS hook API; `invites.pb.js` declares
0.22+. Both use `e.auth` and `e.next()`, and `invites.pb.js` uses
`apis.recordAuthResponse(e, user, "")` — the newer JSVM shape — so the effective
floor is the newer of the two. The version PocketHost actually runs is not pinned
or recorded anywhere in this repo. If hooks stop firing after a PocketHost
upgrade, that is the first thing to check.
