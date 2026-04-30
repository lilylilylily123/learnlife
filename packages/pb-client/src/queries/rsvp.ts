import type PocketBase from "pocketbase";
import type { EventRsvp, RsvpStatus } from "../types";

/**
 * RSVP queries. Two collections involved:
 *
 *   - calendar (existing) — gains rsvp_enabled / capacity / rsvp_deadline /
 *     allow_waitlist columns.
 *   - event_rsvps (new) — one row per (event, occurrence_date, user).
 *
 * Capacity & waitlist promotion is enforced by a JS hook on event_rsvps so
 * the math is atomic on the server. The client calls submit/cancel and
 * trusts the server to set the right status/position.
 *
 * Expected PB rules (event_rsvps):
 *   List/View:  user = @request.auth.id ||
 *               @request.auth.role = "lg" || @request.auth.role = "admin"
 *   Create:     user = @request.auth.id
 *   Update:     user = @request.auth.id ||
 *               @request.auth.role = "lg" || @request.auth.role = "admin"
 *   Delete:     user = @request.auth.id ||
 *               @request.auth.role = "admin"
 */

/**
 * Build the PB filter for "RSVPs for this event occurrence".
 * For one-off events, occurrence_date is null on the row.
 * For recurring events, callers pass the YYYY-MM-DD key from makeDateKey.
 */
function occurrenceFilter(
  pb: PocketBase,
  eventId: string,
  occurrenceDate: string | null,
): string {
  if (occurrenceDate === null) {
    return pb.filter("event = {:eventId} && occurrence_date = null", {
      eventId,
    });
  }
  return pb.filter(
    "event = {:eventId} && occurrence_date = {:occurrenceDate}",
    { eventId, occurrenceDate },
  );
}

/** Roster for one event occurrence — used by the guide-only roster modal. */
export async function fetchRsvpsForOccurrence(
  pb: PocketBase,
  eventId: string,
  occurrenceDate: string | null,
): Promise<EventRsvp[]> {
  return pb.collection("event_rsvps").getFullList<EventRsvp>({
    filter: occurrenceFilter(pb, eventId, occurrenceDate),
    sort: "+position,+responded_at",
    expand: "user",
  });
}

/**
 * The current user's RSVP for a single occurrence, or null if they haven't
 * responded yet. Used to drive the event-detail buttons' selected state.
 */
export async function fetchMyRsvp(
  pb: PocketBase,
  eventId: string,
  occurrenceDate: string | null,
  userId: string,
): Promise<EventRsvp | null> {
  try {
    return await pb
      .collection("event_rsvps")
      .getFirstListItem<EventRsvp>(
        `${occurrenceFilter(pb, eventId, occurrenceDate)} && ${pb.filter(
          "user = {:userId}",
          { userId },
        )}`,
      );
  } catch (err: unknown) {
    // PB throws 404 when no record matches — translate to null.
    if ((err as { status?: number })?.status === 404) return null;
    throw err;
  }
}

/**
 * All RSVPs the current user has made — used to badge upcoming events on
 * the calendar/home views.
 */
export async function fetchMyUpcomingRsvps(
  pb: PocketBase,
  userId: string,
): Promise<EventRsvp[]> {
  return pb.collection("event_rsvps").getFullList<EventRsvp>({
    filter: pb.filter('user = {:userId} && status != "not_going"', { userId }),
    sort: "-responded_at",
  });
}

export interface SubmitRsvpInput {
  eventId: string;
  occurrenceDate: string | null;
  userId: string;
  choice: "going" | "not_going";
}

/**
 * Upsert the user's RSVP for this occurrence. The server hook computes the
 * final status/position based on capacity + waitlist rules, so we just send
 * the user's intent.
 */
export async function submitRsvp(
  pb: PocketBase,
  input: SubmitRsvpInput,
): Promise<EventRsvp> {
  const existing = await fetchMyRsvp(
    pb,
    input.eventId,
    input.occurrenceDate,
    input.userId,
  );

  // The server hook fills in status/position; we set the choice via a
  // sentinel field so the hook knows whether to gate against capacity.
  const payload = {
    event: input.eventId,
    occurrence_date: input.occurrenceDate,
    user: input.userId,
    // The hook reads `status` as the user's intent ("going" or "not_going")
    // and may rewrite it to "waitlisted" before persisting.
    status: input.choice as RsvpStatus,
    responded_at: new Date().toISOString(),
  };

  if (existing) {
    return pb.collection("event_rsvps").update<EventRsvp>(existing.id, payload);
  }
  return pb.collection("event_rsvps").create<EventRsvp>(payload);
}

/** Remove the user's RSVP entirely. Triggers waitlist promotion server-side. */
export async function cancelRsvp(pb: PocketBase, rsvpId: string): Promise<void> {
  await pb.collection("event_rsvps").delete(rsvpId);
}
