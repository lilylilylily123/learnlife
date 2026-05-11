# RSVP migration — PocketBase admin steps

The client code (in `@learnlife/shared`, `@learnlife/pb-client`, and the
calendar app) has been updated to support RSVPs with capacity and waitlist.
To turn it on you need to apply the schema and rules below in the PocketBase
admin (`https://learnlife.pockethost.io/_/`). All steps are reversible —
nothing destructive in here.

## 1. Add fields to the `calendar` collection

Open **Collections → calendar → Fields → New field** and add four optional
fields:

| Field name       | Type    | Notes                                              |
|------------------|---------|----------------------------------------------------|
| `rsvp_enabled`   | Bool    | default `false`                                    |
| `capacity`       | Number  | optional; integer; min `0`. Empty = unlimited      |
| `rsvp_deadline`  | Date    | optional; full date+time                           |
| `allow_waitlist` | Bool    | default `true`                                     |

Don't change any of the existing fields; the new ones are non-breaking
(records without them just won't have RSVP turned on).

## 2. Create the `event_rsvps` collection

**Collections → New collection → Base**. Name it `event_rsvps`.

Fields:

| Field name        | Type        | Required | Notes                                        |
|-------------------|-------------|----------|----------------------------------------------|
| `event`           | Relation    | yes      | → `calendar`, single, cascade delete         |
| `occurrence_date` | Plain text  | no       | `YYYY-MM-DD` for recurring; null for one-off |
| `user`            | Relation    | yes      | → `users`, single, cascade delete            |
| `status`          | Select      | yes      | options: `going`, `not_going`, `waitlisted`  |
| `position`        | Number      | no       | waitlist ordinal (1-indexed); null otherwise |
| `responded_at`    | Date        | yes      |                                              |

Add a **unique index** on `(event, occurrence_date, user)` so a user can't
have two RSVPs for the same occurrence. In the collection's **Indexes** tab:

```
CREATE UNIQUE INDEX `idx_event_rsvps_unique` ON `event_rsvps`
  (`event`, `occurrence_date`, `user`);
```

## 3. API rules for `event_rsvps`

Apply these in the collection's **API Rules** tab:

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

Rationale: a user can read/create/update/delete their own RSVP. Guides see
the roster (read-only) for any event. Admins can override anything.

## 4. JS hook for atomic capacity + waitlist promotion

The client sends the user's *intent* (`"going"` or `"not_going"`); the
server hook below rewrites `status`/`position` based on capacity and
existing RSVPs. This is the only place capacity is enforced — never trust
the client to do it.

Save as `pb_hooks/event_rsvps.pb.js` (PocketBase loads any `.pb.js` file
in `pb_hooks/` automatically on startup):

```js
/// <reference path="../pb_data/types.d.ts" />

// Helper: shared logic for both create and update events. Mutates the
// record in-place to set the final status/position before persistence.
function applyRsvpRules(e) {
  const intent = e.record.get("status");

  // not_going always succeeds — clear any waitlist position.
  if (intent === "not_going") {
    e.record.set("position", null);
    return;
  }
  // Anything other than "going" at this point is an error from the client.
  if (intent !== "going") {
    throw new BadRequestError(
      "status must be 'going' or 'not_going' on submit"
    );
  }

  const eventId = e.record.get("event");
  const occurrenceDate = e.record.get("occurrence_date");
  const userId = e.record.get("user");

  // Load the calendar record for capacity + deadline.
  const cal = $app.findRecordById("calendar", eventId);
  const rsvpEnabled = cal.get("rsvp_enabled");
  if (!rsvpEnabled) {
    throw new BadRequestError("RSVP is not enabled for this event");
  }

  // Deadline check.
  const deadline = cal.get("rsvp_deadline");
  if (deadline && new Date() > new Date(deadline)) {
    throw new BadRequestError("RSVP deadline has passed");
  }

  const capacity = cal.get("capacity"); // 0 or null = unlimited
  const allowWaitlist = cal.get("allow_waitlist");

  // Unlimited → just accept as going.
  if (!capacity || capacity <= 0) {
    e.record.set("position", null);
    return;
  }

  // Load all OTHER rsvps for this occurrence (exclude actor).
  const filter = occurrenceDate
    ? `event = "${eventId}" && occurrence_date = "${occurrenceDate}" && user != "${userId}"`
    : `event = "${eventId}" && occurrence_date = null && user != "${userId}"`;
  const others = $app.findRecordsByFilter("event_rsvps", filter, "", 0, 0);

  const goingCount = others.filter((r) => r.get("status") === "going").length;

  if (goingCount < capacity) {
    e.record.set("status", "going");
    e.record.set("position", null);
    return;
  }

  if (!allowWaitlist) {
    throw new BadRequestError("Event is full and waitlist is disabled");
  }

  // Append to waitlist.
  const positions = others
    .filter((r) => r.get("status") === "waitlisted")
    .map((r) => r.get("position") || 0);
  const nextPosition = positions.length === 0 ? 1 : Math.max(...positions) + 1;
  e.record.set("status", "waitlisted");
  e.record.set("position", nextPosition);
}

// Promote waitlist after a "going" user leaves (becomes not_going OR is
// deleted). Called from both onRecordAfterUpdate and onRecordAfterDelete.
function maybePromoteWaitlist(eventId, occurrenceDate) {
  const cal = $app.findRecordById("calendar", eventId);
  const capacity = cal.get("capacity");
  if (!capacity || capacity <= 0) return;

  const filter = occurrenceDate
    ? `event = "${eventId}" && occurrence_date = "${occurrenceDate}"`
    : `event = "${eventId}" && occurrence_date = null`;
  const all = $app.findRecordsByFilter("event_rsvps", filter, "+position", 0, 0);

  const goingCount = all.filter((r) => r.get("status") === "going").length;
  const openSpots = capacity - goingCount;
  if (openSpots <= 0) return;

  const waitlist = all
    .filter((r) => r.get("status") === "waitlisted")
    .sort((a, b) => (a.get("position") || 0) - (b.get("position") || 0));

  // Promote the first openSpots waitlisters to going.
  for (let i = 0; i < Math.min(openSpots, waitlist.length); i++) {
    const r = waitlist[i];
    r.set("status", "going");
    r.set("position", null);
    $app.save(r);
  }

  // Renumber whoever's still waitlisted.
  const stillWaiting = waitlist.slice(openSpots);
  stillWaiting.forEach((r, idx) => {
    const newPos = idx + 1;
    if (r.get("position") !== newPos) {
      r.set("position", newPos);
      $app.save(r);
    }
  });
}

onRecordCreateRequest((e) => {
  applyRsvpRules(e);
  e.next();
}, "event_rsvps");

onRecordUpdateRequest((e) => {
  // Detect "going" → "not_going" transitions so we can promote the
  // waitlist after the update commits.
  const original = $app.findRecordById("event_rsvps", e.record.id);
  const wasGoing = original.get("status") === "going";

  applyRsvpRules(e);

  e.next();

  const isGoing = e.record.get("status") === "going";
  if (wasGoing && !isGoing) {
    maybePromoteWaitlist(
      e.record.get("event"),
      e.record.get("occurrence_date")
    );
  }
}, "event_rsvps");

onRecordAfterDeleteSuccess((e) => {
  if (e.record.get("status") === "going") {
    maybePromoteWaitlist(
      e.record.get("event"),
      e.record.get("occurrence_date")
    );
  }
}, "event_rsvps");
```

> Note: PB JS hook APIs vary slightly by version. The names above
> (`onRecordCreateRequest`, `onRecordUpdateRequest`,
> `onRecordAfterDeleteSuccess`, `BadRequestError`, `$app.findRecordsByFilter`)
> match PocketBase 0.22+. If your hosted version is older, the equivalent
> names in 0.20 are `onRecordBeforeCreateRequest` /
> `onRecordBeforeUpdateRequest` / `onRecordAfterDeleteRequest`. Adjust as
> needed when pasting in.

## 5. Smoke test

After applying the above:

1. Pick an existing event, set `rsvp_enabled = true`, `capacity = 2`,
   `allow_waitlist = true`.
2. Log in as Learner A → "Going" → confirm status = `going` in admin.
3. Log in as Learner B → "Going" → confirm status = `going`.
4. Log in as Learner C → "Going" → confirm status = `waitlisted`,
   `position = 1`.
5. Log in as Learner A → "Not going" → confirm Learner C is now `going`
   and `position` is null.

If step 5 doesn't promote, the post-update hook isn't firing — most
likely a PB version naming mismatch (see note above).

## Rollback

Drop the `event_rsvps` collection and remove the four added `calendar`
fields. The client code tolerates missing fields (RSVP simply won't be
offered on any event).
