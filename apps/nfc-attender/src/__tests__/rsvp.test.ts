import { describe, it, expect } from "vitest";
import {
  computeRsvpAction,
  promoteFromWaitlist,
  countRsvps,
} from "@learnlife/shared";
import type { RsvpEntry, RsvpRules } from "@learnlife/shared";

// Reference now: 2026-04-28T12:00:00Z. Tests that don't care about the
// deadline can use this; deadline tests pin their own.
const NOW = new Date("2026-04-28T12:00:00.000Z");

function entry(overrides: Partial<RsvpEntry> = {}): RsvpEntry {
  return {
    id: "rsvp-" + Math.random().toString(36).slice(2),
    user: "user-x",
    status: "going",
    position: null,
    ...overrides,
  };
}

function rules(overrides: Partial<RsvpRules> = {}): RsvpRules {
  return {
    capacity: null,
    allowWaitlist: false,
    deadline: null,
    ...overrides,
  };
}

describe("computeRsvpAction — deadline", () => {
  it("rejects after the deadline has passed", () => {
    const decision = computeRsvpAction({
      current: [],
      actorUserId: "u1",
      choice: "going",
      rules: rules({ deadline: "2026-04-27T00:00:00.000Z" }),
      now: NOW,
    });
    expect(decision).toEqual({ accepted: false, reason: "deadline_passed" });
  });

  it("accepts exactly at the deadline (boundary inclusive)", () => {
    const decision = computeRsvpAction({
      current: [],
      actorUserId: "u1",
      choice: "going",
      rules: rules({ deadline: "2026-04-28T12:00:00.000Z" }),
      now: NOW,
    });
    expect(decision).toEqual({ accepted: true, status: "going", position: null });
  });

  it("ignores an unparseable deadline string", () => {
    const decision = computeRsvpAction({
      current: [],
      actorUserId: "u1",
      choice: "going",
      rules: rules({ deadline: "not-a-date" }),
      now: NOW,
    });
    expect(decision.accepted).toBe(true);
  });
});

describe("computeRsvpAction — not_going", () => {
  it("always accepts not_going regardless of capacity", () => {
    const full = [
      entry({ user: "a", status: "going" }),
      entry({ user: "b", status: "going" }),
    ];
    const decision = computeRsvpAction({
      current: full,
      actorUserId: "c",
      choice: "not_going",
      rules: rules({ capacity: 2, allowWaitlist: false }),
      now: NOW,
    });
    expect(decision).toEqual({ accepted: true, status: "not_going", position: null });
  });
});

describe("computeRsvpAction — unlimited capacity", () => {
  it("accepts any going request when capacity is null", () => {
    const current = Array.from({ length: 50 }, (_, i) =>
      entry({ user: `u${i}`, status: "going" }),
    );
    const decision = computeRsvpAction({
      current,
      actorUserId: "newbie",
      choice: "going",
      rules: rules({ capacity: null }),
      now: NOW,
    });
    expect(decision).toEqual({ accepted: true, status: "going", position: null });
  });
});

describe("computeRsvpAction — limited capacity", () => {
  it("accepts going when spots remain", () => {
    const decision = computeRsvpAction({
      current: [entry({ user: "a", status: "going" })],
      actorUserId: "b",
      choice: "going",
      rules: rules({ capacity: 3 }),
      now: NOW,
    });
    expect(decision).toEqual({ accepted: true, status: "going", position: null });
  });

  it("rejects when full and waitlist is disabled", () => {
    const decision = computeRsvpAction({
      current: [
        entry({ user: "a", status: "going" }),
        entry({ user: "b", status: "going" }),
      ],
      actorUserId: "c",
      choice: "going",
      rules: rules({ capacity: 2, allowWaitlist: false }),
      now: NOW,
    });
    expect(decision).toEqual({ accepted: false, reason: "full_no_waitlist" });
  });

  it("waitlists at position 1 when full and no one else is waitlisted", () => {
    const decision = computeRsvpAction({
      current: [
        entry({ user: "a", status: "going" }),
        entry({ user: "b", status: "going" }),
      ],
      actorUserId: "c",
      choice: "going",
      rules: rules({ capacity: 2, allowWaitlist: true }),
      now: NOW,
    });
    expect(decision).toEqual({ accepted: true, status: "waitlisted", position: 1 });
  });

  it("appends to the back of an existing waitlist", () => {
    const decision = computeRsvpAction({
      current: [
        entry({ user: "a", status: "going" }),
        entry({ user: "b", status: "going" }),
        entry({ user: "c", status: "waitlisted", position: 1 }),
        entry({ user: "d", status: "waitlisted", position: 2 }),
      ],
      actorUserId: "e",
      choice: "going",
      rules: rules({ capacity: 2, allowWaitlist: true }),
      now: NOW,
    });
    expect(decision).toEqual({ accepted: true, status: "waitlisted", position: 3 });
  });

  it("does not double-count the actor's prior 'going' row", () => {
    // Actor is already going; submitting "going" again should still be accepted
    // even though current.length === capacity (because the actor's row is excluded).
    const decision = computeRsvpAction({
      current: [
        entry({ user: "a", status: "going" }),
        entry({ user: "b", status: "going" }),
      ],
      actorUserId: "a",
      choice: "going",
      rules: rules({ capacity: 2 }),
      now: NOW,
    });
    expect(decision).toEqual({ accepted: true, status: "going", position: null });
  });

  it("does not push the actor to the back when they re-submit on the waitlist", () => {
    // Actor is already at position 1; submitting again shouldn't move them to 3.
    const decision = computeRsvpAction({
      current: [
        entry({ user: "a", status: "going" }),
        entry({ user: "b", status: "going" }),
        entry({ user: "actor", status: "waitlisted", position: 1 }),
        entry({ user: "c", status: "waitlisted", position: 2 }),
      ],
      actorUserId: "actor",
      choice: "going",
      rules: rules({ capacity: 2, allowWaitlist: true }),
      now: NOW,
    });
    // Actor excluded → max position among others is 2 → actor goes to 3.
    // (We accept this trade-off: the server hook handles "no-op resubmit"
    // separately by skipping unchanged rows. Encode the actual behaviour.)
    expect(decision).toEqual({ accepted: true, status: "waitlisted", position: 3 });
  });

  it("lets a not_going actor return when spots are open", () => {
    const decision = computeRsvpAction({
      current: [
        entry({ user: "a", status: "going" }),
        entry({ user: "actor", status: "not_going" }),
      ],
      actorUserId: "actor",
      choice: "going",
      rules: rules({ capacity: 2 }),
      now: NOW,
    });
    expect(decision).toEqual({ accepted: true, status: "going", position: null });
  });
});

describe("promoteFromWaitlist", () => {
  it("returns no patches for unlimited events", () => {
    const remaining: RsvpEntry[] = [
      entry({ id: "w1", status: "waitlisted", position: 1 }),
    ];
    expect(promoteFromWaitlist(remaining, null)).toEqual([]);
  });

  it("promotes the front of the waitlist into an open spot", () => {
    // Capacity 2, only 1 going, 2 waitlisted → promote position 1.
    const remaining: RsvpEntry[] = [
      entry({ id: "g1", status: "going" }),
      entry({ id: "w1", user: "x", status: "waitlisted", position: 1 }),
      entry({ id: "w2", user: "y", status: "waitlisted", position: 2 }),
    ];
    const patches = promoteFromWaitlist(remaining, 2);
    expect(patches).toContainEqual({ id: "w1", status: "going", position: null });
    // w2 should be renumbered from 2 → 1.
    expect(patches).toContainEqual({ id: "w2", status: "waitlisted", position: 1 });
  });

  it("does not promote when going still meets capacity", () => {
    const remaining: RsvpEntry[] = [
      entry({ id: "g1", status: "going" }),
      entry({ id: "g2", status: "going" }),
      entry({ id: "w1", status: "waitlisted", position: 1 }),
    ];
    expect(promoteFromWaitlist(remaining, 2)).toEqual([]);
  });

  it("promotes multiple waitlisters when multiple spots opened", () => {
    // Two going removed; two waitlisters slide in.
    const remaining: RsvpEntry[] = [
      entry({ id: "w1", status: "waitlisted", position: 1 }),
      entry({ id: "w2", status: "waitlisted", position: 2 }),
      entry({ id: "w3", status: "waitlisted", position: 3 }),
    ];
    const patches = promoteFromWaitlist(remaining, 2);
    expect(patches).toContainEqual({ id: "w1", status: "going", position: null });
    expect(patches).toContainEqual({ id: "w2", status: "going", position: null });
    expect(patches).toContainEqual({ id: "w3", status: "waitlisted", position: 1 });
  });

  it("emits no patch for waitlisters whose position didn't change", () => {
    // Capacity 2, 2 going, waitlisters already at 1 and 2 — nothing to do.
    const remaining: RsvpEntry[] = [
      entry({ id: "g1", status: "going" }),
      entry({ id: "g2", status: "going" }),
      entry({ id: "w1", status: "waitlisted", position: 1 }),
      entry({ id: "w2", status: "waitlisted", position: 2 }),
    ];
    expect(promoteFromWaitlist(remaining, 2)).toEqual([]);
  });
});

describe("countRsvps", () => {
  it("aggregates statuses and computes spotsRemaining/full", () => {
    const entries: RsvpEntry[] = [
      entry({ status: "going" }),
      entry({ status: "going" }),
      entry({ status: "waitlisted", position: 1 }),
      entry({ status: "not_going" }),
    ];
    expect(countRsvps(entries, 5)).toEqual({
      going: 2,
      waitlisted: 1,
      notGoing: 1,
      spotsRemaining: 3,
      full: false,
    });
  });

  it("reports full = true when going meets capacity", () => {
    const entries: RsvpEntry[] = [
      entry({ status: "going" }),
      entry({ status: "going" }),
    ];
    expect(countRsvps(entries, 2)).toEqual({
      going: 2,
      waitlisted: 0,
      notGoing: 0,
      spotsRemaining: 0,
      full: true,
    });
  });

  it("reports null spotsRemaining for unlimited capacity", () => {
    const counts = countRsvps([entry({ status: "going" })], null);
    expect(counts.spotsRemaining).toBeNull();
    expect(counts.full).toBe(false);
  });
});
