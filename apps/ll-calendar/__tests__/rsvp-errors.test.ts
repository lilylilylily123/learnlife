/**
 * Tests for mapRsvpError in lib/errors.ts
 *
 * Run with: pnpm test
 *
 * Why this file exists: the RSVP submit path no longer computes capacity or
 * waitlist state — the server hook owns both — so the *only* way a user
 * learns "this event is full" or "RSVPs have closed" is now the message this
 * function derives from the rejection. It is the whole of the user-facing
 * feedback for a feature whose logic lives in a file with no tests
 * (`pb_hooks/event_rsvps.pb.js`), which makes flattening a distinction here
 * a silent product regression.
 *
 * The rejections come from two places and have different shapes:
 *   - the hook, as PocketBase 400s carrying a hand-written `message`
 *   - `submitRsvp`'s client-only `not_going` guards, as plain `Error`s with
 *     no `status` at all
 * The second shape is the trap: `mapPbError` reads a missing status as 0 and
 * reports a network failure, so an unmatched client guard would tell the
 * user their connection was down.
 */

import { mapRsvpError } from "../lib/errors";

/** A PocketBase ClientResponseError as the SDK surfaces it to a caller. */
function pbError(status: number, message: string) {
  return { status, message, data: {} };
}

describe("mapRsvpError — hook rejections", () => {
  it("maps the deadline rejection to closed copy", () => {
    expect(mapRsvpError(pbError(400, "RSVP deadline has passed"))).toBe(
      "RSVPs are closed for this event.",
    );
  });

  it("maps the full-and-no-waitlist rejection to full copy", () => {
    expect(
      mapRsvpError(pbError(400, "Event is full and waitlist is disabled")),
    ).toBe("This event is full.");
  });

  it("maps the rsvp_enabled rejection", () => {
    expect(
      mapRsvpError(pbError(400, "RSVP is not enabled for this event")),
    ).toBe("RSVP isn't open for this event.");
  });

  it("maps the ownership rejection", () => {
    expect(
      mapRsvpError(pbError(400, "cannot RSVP on behalf of another user")),
    ).toBe("You can only change your own RSVP.");
  });

  it("does not leak an unrecognised 400 body", () => {
    const raw = "validation_required: event_rsvps.position must be a number";
    const mapped = mapRsvpError(pbError(400, raw));
    expect(mapped).not.toContain("event_rsvps");
    expect(mapped).not.toContain("position");
    expect(mapped).toBe("That didn't work. Double-check what you entered.");
  });

  it("keeps the intent-rejection message off the screen", () => {
    // Reaching this means the client sent a status the hook refuses — a bug,
    // not something the user can act on, so it must not surface verbatim.
    const mapped = mapRsvpError(
      pbError(400, "status must be 'going' or 'not_going' on submit"),
    );
    expect(mapped).not.toContain("not_going");
  });
});

describe("mapRsvpError — client-only guards", () => {
  // These are plain Errors with no `status`. Falling through to mapPbError
  // would surface "Network error", which is wrong and unactionable.
  it("maps the client deadline guard without claiming a network failure", () => {
    const mapped = mapRsvpError(new Error("RSVPs are closed for this event."));
    expect(mapped).toBe("RSVPs are closed for this event.");
    expect(mapped).not.toContain("Network");
  });

  it("maps the client rsvp_enabled guard without claiming a network failure", () => {
    const mapped = mapRsvpError(
      new Error("RSVP is not enabled for this event."),
    );
    expect(mapped).toBe("RSVP isn't open for this event.");
    expect(mapped).not.toContain("Network");
  });
});

describe("mapRsvpError — transport and fallbacks", () => {
  it("still reports a genuine offline error", () => {
    expect(mapRsvpError({ status: 0, message: "Failed to fetch" })).toBe(
      "Network error. Check your connection and try again.",
    );
  });

  it("maps an expired session", () => {
    expect(mapRsvpError(pbError(401, "The request requires valid record authorization token."))).toBe(
      "Your session expired. Please sign in again.",
    );
  });

  it("maps a rule denial", () => {
    expect(mapRsvpError(pbError(403, "Only superusers can perform this action."))).toBe(
      "You don't have access to that.",
    );
  });

  it("maps a server error", () => {
    expect(mapRsvpError(pbError(500, "boom"))).toBe(
      "Server error. Please try again shortly.",
    );
  });

  it("falls back safely on a non-error value", () => {
    expect(mapRsvpError(undefined)).toBe(
      "Network error. Check your connection and try again.",
    );
  });
});
