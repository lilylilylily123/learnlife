import { parsePBDate } from "./date-utils";

/**
 * One user's RSVP to a single event occurrence. Mirrors the PB
 * `event_rsvps` row shape but trims it down to fields the state machine
 * actually needs — caller is free to pass extras or hydrate from PB.
 */
export interface RsvpEntry {
  id: string;
  user: string;
  status: "going" | "not_going" | "waitlisted";
  /** Ordinal position on the waitlist (1-indexed). Null for going / not_going. */
  position: number | null;
}

/**
 * Capacity & deadline configuration for an event. All optional —
 * an event with `capacity: null` and `allowWaitlist: false` simply tracks
 * yes/no responses with no cap.
 */
export interface RsvpRules {
  /** Null = unlimited spots. Positive integer = max simultaneous "going". */
  capacity: number | null;
  /** When true and the event is full, "going" requests join the waitlist. */
  allowWaitlist: boolean;
  /** ISO timestamp; submissions after this point are rejected. Null = no deadline. */
  deadline: string | null;
}

export interface ComputeRsvpInput {
  /** All existing RSVPs for this event occurrence (including the actor's, if any). */
  current: RsvpEntry[];
  actorUserId: string;
  choice: "going" | "not_going";
  rules: RsvpRules;
  now: Date;
}

/**
 * Outcome of an RSVP submission. The caller upserts the actor's row with
 * `{ status, position }` when accepted, or surfaces `reason` to the user
 * when rejected.
 */
export type RsvpDecision =
  | {
      accepted: true;
      status: "going" | "not_going" | "waitlisted";
      position: number | null;
    }
  | {
      accepted: false;
      reason: "deadline_passed" | "full_no_waitlist";
    };

/**
 * Pure function: given the current roster + the user's choice, decide what
 * to write to the actor's RSVP row. Does not mutate inputs; does not run
 * promotion (see `promoteFromWaitlist` for that).
 *
 * Rules (evaluated in order):
 *   1. Past deadline                              → rejected("deadline_passed")
 *   2. choice = "not_going"                       → accepted as not_going
 *   3. capacity = null (unlimited)                → accepted as going
 *   4. spots remaining (going count < capacity)   → accepted as going
 *   5. full + allowWaitlist = true                → accepted as waitlisted (position = max+1)
 *   6. full + allowWaitlist = false               → rejected("full_no_waitlist")
 *
 * The actor's prior RSVP (if any) is excluded from the "going count" so
 * that flipping not_going → going correctly evaluates against the rest of
 * the roster.
 */
export function computeRsvpAction(input: ComputeRsvpInput): RsvpDecision {
  const { current, actorUserId, choice, rules, now } = input;

  // ── 1. Deadline gate ──────────────────────────────────────────────────────
  if (rules.deadline) {
    const deadline = parsePBDate(rules.deadline);
    if (!Number.isNaN(deadline.getTime()) && now.getTime() > deadline.getTime()) {
      return { accepted: false, reason: "deadline_passed" };
    }
  }

  // ── 2. Not going always succeeds ──────────────────────────────────────────
  if (choice === "not_going") {
    return { accepted: true, status: "not_going", position: null };
  }

  // Exclude the actor's own prior row from capacity math: switching from
  // going-back-to-going shouldn't double-count, and a not_going actor
  // returning needs to compete only against the rest of the roster.
  const others = current.filter((r) => r.user !== actorUserId);
  const goingCount = others.filter((r) => r.status === "going").length;

  // ── 3. Unlimited capacity ────────────────────────────────────────────────
  if (rules.capacity === null) {
    return { accepted: true, status: "going", position: null };
  }

  // ── 4. Spots remain ──────────────────────────────────────────────────────
  if (goingCount < rules.capacity) {
    return { accepted: true, status: "going", position: null };
  }

  // ── 5/6. Full → waitlist or reject ───────────────────────────────────────
  if (!rules.allowWaitlist) {
    return { accepted: false, reason: "full_no_waitlist" };
  }

  // Next waitlist position = max(existing waitlisted positions) + 1.
  // Falls back to 1 when no one is currently waitlisted. We exclude the
  // actor here too so re-submitting doesn't push them to the back.
  const maxPosition = others
    .filter((r) => r.status === "waitlisted" && r.position !== null)
    .reduce((max, r) => Math.max(max, r.position ?? 0), 0);

  return { accepted: true, status: "waitlisted", position: maxPosition + 1 };
}

/**
 * One row to update after a "going" user leaves — promote the next person
 * off the waitlist, and shift everyone behind them down by one position.
 */
export interface RsvpPromotion {
  id: string;
  status: "going" | "waitlisted";
  position: number | null;
}

/**
 * After a "going" user becomes not_going (or their RSVP is deleted),
 * promote the front of the waitlist to fill any newly-open spots and
 * renumber the rest. Pure: returns the patch list, doesn't mutate.
 *
 * `remaining` should be the full RSVP list AFTER the departing user has
 * already been removed (or had their status set to not_going). Pass
 * `capacity = null` to skip promotion entirely (uncapped events).
 */
export function promoteFromWaitlist(
  remaining: RsvpEntry[],
  capacity: number | null,
): RsvpPromotion[] {
  if (capacity === null) return [];

  const goingCount = remaining.filter((r) => r.status === "going").length;
  const openSpots = Math.max(0, capacity - goingCount);

  // Sort waitlisted by position ascending; nulls (shouldn't happen) sort last.
  const waitlist = remaining
    .filter((r) => r.status === "waitlisted")
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));

  const promotions: RsvpPromotion[] = [];

  // Promote the first `openSpots` waitlisters to going.
  for (let i = 0; i < Math.min(openSpots, waitlist.length); i++) {
    promotions.push({ id: waitlist[i].id, status: "going", position: null });
  }

  // Renumber whoever's left on the waitlist starting from 1, but only emit
  // a patch if their position actually changed (to keep updates minimal).
  const stillWaitlisted = waitlist.slice(openSpots);
  stillWaitlisted.forEach((r, idx) => {
    const newPosition = idx + 1;
    if (r.position !== newPosition) {
      promotions.push({ id: r.id, status: "waitlisted", position: newPosition });
    }
  });

  return promotions;
}

/**
 * Lightweight roster summary for UI badges ("12/20 going · 3 waitlisted").
 * Pure aggregation of the same RsvpEntry[] used elsewhere.
 */
export interface RsvpCounts {
  going: number;
  waitlisted: number;
  notGoing: number;
  /** Spots still available for "going". Null when capacity is null. */
  spotsRemaining: number | null;
  /** True when capacity is set and going >= capacity. */
  full: boolean;
}

export function countRsvps(
  entries: RsvpEntry[],
  capacity: number | null,
): RsvpCounts {
  let going = 0,
    waitlisted = 0,
    notGoing = 0;
  for (const r of entries) {
    if (r.status === "going") going++;
    else if (r.status === "waitlisted") waitlisted++;
    else if (r.status === "not_going") notGoing++;
  }
  const spotsRemaining = capacity === null ? null : Math.max(0, capacity - going);
  const full = capacity !== null && going >= capacity;
  return { going, waitlisted, notGoing, spotsRemaining, full };
}
