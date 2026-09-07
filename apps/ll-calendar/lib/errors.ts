// Map raw PocketBase / network errors to neutral, user-facing copy.
//
// Why: PocketBase response bodies often include schema/field details and HTTP
// statuses that are not safe (or useful) to surface to end users. We map known
// shapes to short, generic strings and fall back to a single safe default for
// everything else.

type PbErrorShape = {
  status?: number;
  message?: string;
  data?: { message?: string; data?: unknown };
};

function pick(err: unknown): PbErrorShape {
  if (err && typeof err === "object") return err as PbErrorShape;
  return {};
}

/** Generic catch-all so we never echo a raw PB payload to the user. */
const DEFAULT = "Something went wrong. Please try again.";

export function mapPbError(
  err: unknown,
  fallback: string = DEFAULT,
): string {
  const e = pick(err);
  const status = e.status ?? 0;

  // Offline / network unreachable. PocketBase surfaces this as status 0.
  if (status === 0) return "Network error. Check your connection and try again.";

  // Auth / permission failures.
  if (status === 401) return "Your session expired. Please sign in again.";
  if (status === 403) return "You don't have access to that.";

  // Not found / validation.
  if (status === 404) return "We couldn't find that.";
  if (status === 400) return "That didn't work. Double-check what you entered.";

  // Rate limit.
  if (status === 429) return "Too many attempts. Try again in a moment.";

  // Server-side.
  if (status >= 500) return "Server error. Please try again shortly.";

  return fallback;
}

/** Sign-in specific copy: avoid distinguishing wrong-email from wrong-password. */
export function mapLoginError(err: unknown): string {
  const e = pick(err);
  if (e.status === 0) return "Network error. Check your connection and try again.";
  if (e.status === 429) return "Too many attempts. Try again in a moment.";
  if (e.status && e.status >= 500) return "Server error. Please try again shortly.";
  // 400/401/403 → all collapse to the same neutral string.
  return "Invalid email or password.";
}

/** Invite-code specific copy. Treat any client error as "code didn't work". */
export function mapInviteError(err: unknown): string {
  const e = pick(err);
  if (e.status === 0) return "Network error. Check your connection and try again.";
  if (e.status && e.status >= 500) return "Server error. Please try again shortly.";
  return "That code didn't work. Check with your facilitator.";
}

/**
 * RSVP-specific copy. The `event_rsvps` hook rejects with a small, fixed set
 * of hand-written `BadRequestError` messages, and those distinctions matter
 * to the user — "this event is full" and "RSVPs have closed" are different
 * problems with different responses, and `mapPbError` would flatten both to
 * the generic 400 string.
 *
 * We match against the known sentences rather than echoing `err.message`, so
 * an unrecognised payload still cannot reach the UI. Anything we do not
 * recognise falls through to `mapPbError`.
 *
 * The first two branches also catch the client-only guards `submitRsvp`
 * raises on the `not_going` path (see the note there). Those are plain
 * `Error`s with no `status`, so they must be matched here — falling through
 * would let `mapPbError` read the missing status as 0 and report a network
 * failure that did not happen.
 *
 * Keep in sync with the throws in `pb_hooks/event_rsvps.pb.js` and in
 * `submitRsvp`.
 */
export function mapRsvpError(err: unknown): string {
  const raw = pick(err).message ?? "";

  if (raw.includes("deadline has passed") || raw.includes("RSVPs are closed")) {
    return "RSVPs are closed for this event.";
  }
  if (raw.includes("waitlist is disabled")) {
    return "This event is full.";
  }
  if (raw.includes("RSVP is not enabled")) {
    return "RSVP isn't open for this event.";
  }
  if (raw.includes("on behalf of another user")) {
    return "You can only change your own RSVP.";
  }

  return mapPbError(err, "Could not save your RSVP. Please try again.");
}
