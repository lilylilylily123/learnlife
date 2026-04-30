import { AsyncAuthStore } from "pocketbase";
import { Platform } from "react-native";
import {
  createPBClient,
  PB_URL,
  auth,
  learners as learnersQ,
  calendar as calendarQ,
  messages as messagesQ,
  invites as invitesQ,
  rsvp as rsvpQ,
} from "@learnlife/pb-client";
import { computeRsvpAction, promoteFromWaitlist } from "@learnlife/shared";
export { expandEvents } from "@learnlife/shared";
export type {
  CalRecord,
  CalEvent,
  CalRecurrence,
  CreateCalEntryPayload as CreateEntryPayload,
  Conversation,
  Message,
} from "@learnlife/pb-client";

const AUTH_KEY = "pb_auth";

function createAuthStore() {
  if (Platform.OS === "web") {
    const hasLocalStorage = typeof window !== "undefined" && !!window.localStorage;
    return new AsyncAuthStore({
      save: async (serialized) => {
        if (hasLocalStorage) localStorage.setItem(AUTH_KEY, serialized);
      },
      initial: hasLocalStorage ? localStorage.getItem(AUTH_KEY) ?? "" : "",
      clear: async () => {
        if (hasLocalStorage) localStorage.removeItem(AUTH_KEY);
      },
    });
  }

  // Native: keep the auth token in the OS keystore (iOS Keychain / Android
  // Keystore via expo-secure-store) instead of plaintext AsyncStorage. The
  // PB token is well under SecureStore's 2 KB per-value limit.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SecureStore = require("expo-secure-store");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AsyncStorage = require("@react-native-async-storage/async-storage").default;

  // One-shot migration: if a token still lives in AsyncStorage from an older
  // build, copy it into SecureStore and delete the legacy entry. After that,
  // SecureStore is authoritative.
  const initial: Promise<string> = (async () => {
    try {
      const secure = await SecureStore.getItemAsync(AUTH_KEY);
      if (secure) return secure;
      const legacy = await AsyncStorage.getItem(AUTH_KEY);
      if (legacy) {
        await SecureStore.setItemAsync(AUTH_KEY, legacy);
        await AsyncStorage.removeItem(AUTH_KEY);
        return legacy;
      }
    } catch {
      // Fall through; signed-out state is the safe default.
    }
    return "";
  })();

  return new AsyncAuthStore({
    save: async (serialized: string) =>
      SecureStore.setItemAsync(AUTH_KEY, serialized),
    initial,
    clear: async () => SecureStore.deleteItemAsync(AUTH_KEY),
  });
}

export const pb = createPBClient({ url: PB_URL, authStore: createAuthStore() });

// Auth — bound to singleton
export async function login(email: string, password: string) {
  return auth.login(pb, email, password);
}

export function logout() {
  auth.logout(pb);
}

export function isAuthenticated() {
  return auth.isAuthenticated(pb);
}

export async function requestPasswordReset(email: string) {
  return auth.requestPasswordReset(pb, email);
}

// Learners — bound to singleton
export async function listLearners(params?: { search?: string; program?: string }) {
  return learnersQ.listLearners(pb, params);
}

// Invites — bound to singleton
export async function listInvites(opts?: { showUsed?: boolean }) {
  return invitesQ.listInvites(pb, opts);
}

export async function createInvite(data: { learnerId: string; email: string; createdBy: string }) {
  return invitesQ.createInvite(pb, data);
}

export async function lookupInvite(code: string) {
  return invitesQ.lookupInvite(pb, code);
}

export async function redeemInvite(code: string, password: string) {
  return invitesQ.redeemInvite(pb, { code, password });
}

// Calendar — bound to singleton
export async function fetchCalendarEvents() {
  return calendarQ.fetchCalendarEvents(pb);
}

export async function createCalendarEntry(
  data: import("@learnlife/pb-client").CreateCalEntryPayload,
) {
  return calendarQ.createCalendarEntry(pb, data);
}

export async function getCalendarEntry(id: string) {
  return calendarQ.getCalendarEntry(pb, id);
}

export async function updateCalendarEntry(
  id: string,
  data: Partial<import("@learnlife/pb-client").CreateCalEntryPayload>,
) {
  return calendarQ.updateCalendarEntry(pb, id, data);
}

export async function deleteCalendarEntry(id: string) {
  return calendarQ.deleteCalendarEntry(pb, id);
}

// Messaging — bound to singleton
export async function fetchConversations(userId: string) {
  return messagesQ.fetchConversations(pb, userId);
}

export async function fetchMessages(conversationId: string) {
  return messagesQ.fetchMessages(pb, conversationId);
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  body: string,
) {
  return messagesQ.sendMessage(pb, conversationId, senderId, body);
}

export async function createConversation(participantIds: string[]) {
  return messagesQ.createConversation(pb, participantIds);
}

export async function findDirectConversation(participantIds: string[]) {
  return messagesQ.findDirectConversation(pb, participantIds);
}

export async function listMessageableUsers(opts: {
  excludeUserId: string;
  search?: string;
  roles?: string[];
}) {
  return messagesQ.listMessageableUsers(pb, opts);
}

export async function markMessagesRead(
  conversationId: string,
  userId: string,
) {
  return messagesQ.markMessagesRead(pb, conversationId, userId);
}

export function subscribeToMessages(
  conversationId: string,
  callback: (message: import("@learnlife/pb-client").Message) => void,
): Promise<() => void> {
  return messagesQ.subscribeToMessages(pb, conversationId, callback);
}

// RSVP — bound to singleton
export async function fetchRsvpsForOccurrence(
  eventId: string,
  occurrenceDate: string | null,
) {
  return rsvpQ.fetchRsvpsForOccurrence(pb, eventId, occurrenceDate);
}

export async function fetchMyRsvp(
  eventId: string,
  occurrenceDate: string | null,
  userId: string,
) {
  return rsvpQ.fetchMyRsvp(pb, eventId, occurrenceDate, userId);
}

/**
 * Submit an RSVP with client-side capacity + waitlist enforcement.
 *
 * NOTE: this is a stop-gap. The intended design is a PocketBase JS hook on
 * `event_rsvps` (see docs/RSVP_MIGRATION.md and pb_hooks/event_rsvps.pb.js),
 * which would enforce capacity atomically on the server. Pockethost's free
 * tier doesn't run custom hooks, so we do the math here. There's a small
 * race window where two simultaneous "Going" submissions can both think
 * they got the last seat — acceptable for low-concurrency usage but worth
 * fixing if/when hooks become available.
 */
export async function submitRsvp(input: {
  eventId: string;
  occurrenceDate: string | null;
  userId: string;
  choice: "going" | "not_going";
}) {
  const [calRecord, roster, existing] = await Promise.all([
    calendarQ.getCalendarEntry(pb, input.eventId),
    rsvpQ.fetchRsvpsForOccurrence(pb, input.eventId, input.occurrenceDate),
    rsvpQ.fetchMyRsvp(pb, input.eventId, input.occurrenceDate, input.userId),
  ]);

  if (!calRecord.rsvp_enabled) {
    throw new Error("RSVP is not enabled for this event");
  }

  // Compute the actor's final status against the current roster.
  const decision = computeRsvpAction({
    current: roster.map((r) => ({
      id: r.id,
      user: r.user,
      status: r.status,
      position: r.position,
    })),
    actorUserId: input.userId,
    choice: input.choice,
    rules: {
      capacity:
        calRecord.capacity != null && calRecord.capacity > 0
          ? calRecord.capacity
          : null,
      allowWaitlist: calRecord.allow_waitlist !== false,
      deadline: calRecord.rsvp_deadline ?? null,
    },
    now: new Date(),
  });

  if (!decision.accepted) {
    if (decision.reason === "deadline_passed") {
      throw new Error("RSVP deadline has passed.");
    }
    throw new Error("This event is full.");
  }

  // Persist the final status/position. The pb-client query treats `status`
  // as either intent or final state — server hook (if running) would
  // re-validate; without a hook, we trust this.
  const wasGoing = existing?.status === "going";
  const isStillGoing = decision.status === "going";

  const payload = {
    event: input.eventId,
    occurrence_date: input.occurrenceDate,
    user: input.userId,
    status: decision.status,
    position: decision.position,
    responded_at: new Date().toISOString(),
  };

  const result = existing
    ? await pb.collection("event_rsvps").update(existing.id, payload)
    : await pb.collection("event_rsvps").create(payload);

  // If we just dropped from "going" to anything else, attempt to promote
  // the front of the waitlist into the freed spot. Each promotion is a
  // separate update — best-effort, swallow individual failures so one
  // promotion blocking doesn't roll back the actor's submission.
  if (wasGoing && !isStillGoing) {
    await promoteWaitlistAfterDeparture(
      input.eventId,
      input.occurrenceDate,
      calRecord.capacity ?? null,
    );
  }

  return result;
}

export async function cancelRsvp(rsvpId: string) {
  // Look up the row so we know whether to promote the waitlist after
  // deletion. PB returns the record on delete only in newer versions, so
  // fetch first to be safe.
  let priorStatus: string | null = null;
  let eventId: string | null = null;
  let occurrenceDate: string | null = null;
  let capacity: number | null = null;
  try {
    const rec = await pb.collection("event_rsvps").getOne(rsvpId);
    priorStatus = rec.status;
    eventId = rec.event;
    occurrenceDate = rec.occurrence_date || null;
    if (eventId) {
      const cal = await calendarQ.getCalendarEntry(pb, eventId);
      capacity = cal.capacity != null && cal.capacity > 0 ? cal.capacity : null;
    }
  } catch {
    // If lookup fails, we still try the delete; just skip promotion.
  }

  await rsvpQ.cancelRsvp(pb, rsvpId);

  if (priorStatus === "going" && eventId) {
    await promoteWaitlistAfterDeparture(eventId, occurrenceDate, capacity);
  }
}

/**
 * Refresh the roster after a "going" user leaves and apply any promotions
 * the math says are now warranted. Best-effort: failures on individual
 * promotion updates are logged but don't throw, so one stuck row doesn't
 * block the others.
 */
async function promoteWaitlistAfterDeparture(
  eventId: string,
  occurrenceDate: string | null,
  capacity: number | null,
) {
  if (capacity === null) return;
  try {
    const remaining = await rsvpQ.fetchRsvpsForOccurrence(pb, eventId, occurrenceDate);
    const patches = promoteFromWaitlist(
      remaining.map((r) => ({
        id: r.id,
        user: r.user,
        status: r.status,
        position: r.position,
      })),
      capacity,
    );
    await Promise.all(
      patches.map((p) =>
        pb
          .collection("event_rsvps")
          .update(p.id, { status: p.status, position: p.position })
          .catch((err) => {
            console.warn("[rsvp] promotion failed for", p.id, err?.message);
          }),
      ),
    );
  } catch (err) {
    console.warn("[rsvp] could not run waitlist promotion", err);
  }
}
