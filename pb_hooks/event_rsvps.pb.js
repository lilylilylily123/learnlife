/// <reference path="../pb_data/types.d.ts" />

// Capacity + waitlist enforcement for event_rsvps.
// Client sends `status` as the user's intent ("going" | "not_going"); this
// hook may rewrite it to "waitlisted" and set `position` accordingly.
//
// PocketBase 0.31+ JS hook API.

const ID_RE = /^[a-zA-Z0-9]{15}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertId(value, label) {
  if (!ID_RE.test(value || "")) {
    throw new BadRequestError(label + " is invalid");
  }
}

function assertOccurrenceDate(value) {
  if (value && !DATE_RE.test(value)) {
    throw new BadRequestError("occurrence_date must be YYYY-MM-DD");
  }
}

function assertOwner(e) {
  // Server-side identity check: the record's `user` must match the
  // authenticated caller, unless the caller is a guide/admin.
  if (!e.auth) {
    throw new BadRequestError("authentication required");
  }
  const recordUser = e.record.get("user");
  const callerRole = e.auth.get("role");
  if (callerRole === "admin" || callerRole === "lg") return;
  if (recordUser !== e.auth.id) {
    throw new BadRequestError("cannot RSVP on behalf of another user");
  }
}

function applyRsvpRules(e) {
  assertOwner(e);

  const intent = e.record.get("status");

  if (intent === "not_going") {
    e.record.set("position", null);
    return;
  }
  if (intent !== "going") {
    throw new BadRequestError(
      "status must be 'going' or 'not_going' on submit"
    );
  }

  const eventId = e.record.get("event");
  const occurrenceDate = e.record.get("occurrence_date") || "";
  const userId = e.record.get("user");
  assertId(eventId, "event");
  assertId(userId, "user");
  assertOccurrenceDate(occurrenceDate);

  const cal = $app.findRecordById("calendar", eventId);
  if (!cal.get("rsvp_enabled")) {
    throw new BadRequestError("RSVP is not enabled for this event");
  }

  const deadline = cal.get("rsvp_deadline");
  if (deadline && new Date() > new Date(deadline)) {
    throw new BadRequestError("RSVP deadline has passed");
  }

  const capacity = cal.get("capacity");
  const allowWaitlist = cal.get("allow_waitlist");

  // Unlimited
  if (!capacity || capacity <= 0) {
    e.record.set("position", null);
    return;
  }

  // IDs and dates are validated above, so interpolation is safe here.
  const filter = occurrenceDate
    ? `event = "${eventId}" && occurrence_date = "${occurrenceDate}" && user != "${userId}"`
    : `event = "${eventId}" && (occurrence_date = "" || occurrence_date = null) && user != "${userId}"`;
  const others = $app.findRecordsByFilter("event_rsvps", filter, "", 1000, 0);

  const goingCount = others.filter((r) => r.get("status") === "going").length;

  if (goingCount < capacity) {
    e.record.set("status", "going");
    e.record.set("position", null);
    return;
  }

  if (!allowWaitlist) {
    throw new BadRequestError("Event is full and waitlist is disabled");
  }

  const positions = others
    .filter((r) => r.get("status") === "waitlisted")
    .map((r) => r.get("position") || 0);
  const next = positions.length === 0 ? 1 : Math.max(...positions) + 1;
  e.record.set("status", "waitlisted");
  e.record.set("position", next);
}

function maybePromoteWaitlist(eventId, occurrenceDate) {
  assertId(eventId, "event");
  assertOccurrenceDate(occurrenceDate);

  const cal = $app.findRecordById("calendar", eventId);
  const capacity = cal.get("capacity");
  if (!capacity || capacity <= 0) return;

  const filter = occurrenceDate
    ? `event = "${eventId}" && occurrence_date = "${occurrenceDate}"`
    : `event = "${eventId}" && (occurrence_date = "" || occurrence_date = null)`;
  const all = $app.findRecordsByFilter(
    "event_rsvps",
    filter,
    "+position",
    1000,
    0,
  );

  const goingCount = all.filter((r) => r.get("status") === "going").length;
  const openSpots = capacity - goingCount;
  if (openSpots <= 0) return;

  const waitlist = all
    .filter((r) => r.get("status") === "waitlisted")
    .sort((a, b) => (a.get("position") || 0) - (b.get("position") || 0));

  for (let i = 0; i < Math.min(openSpots, waitlist.length); i++) {
    const r = waitlist[i];
    r.set("status", "going");
    r.set("position", null);
    $app.save(r);
  }

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
  const original = $app.findRecordById("event_rsvps", e.record.id);
  const wasGoing = original.get("status") === "going";

  applyRsvpRules(e);
  e.next();

  if (wasGoing && e.record.get("status") !== "going") {
    maybePromoteWaitlist(
      e.record.get("event"),
      e.record.get("occurrence_date") || "",
    );
  }
}, "event_rsvps");

onRecordAfterDeleteSuccess((e) => {
  if (e.record.get("status") === "going") {
    maybePromoteWaitlist(
      e.record.get("event"),
      e.record.get("occurrence_date") || "",
    );
  }
}, "event_rsvps");
