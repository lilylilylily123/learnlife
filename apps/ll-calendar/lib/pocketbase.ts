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
import { parsePBDate } from "@learnlife/shared";
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

export async function changePassword(oldPassword: string, newPassword: string) {
  return auth.changePassword(pb, { oldPassword, newPassword });
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
 * Submit an RSVP. The server owns the outcome.
 *
 * `pb_hooks/event_rsvps.pb.js` reads `status` as the user's *intent*
 * ("going" | "not_going") and computes the persisted `status` and
 * `position` itself, rewriting "going" to "waitlisted" when the event is
 * full. Capacity is a read-then-write, so only the server can make it
 * atomic — two learners submitting "Going" at once would both read the same
 * going-count and both conclude a seat was free. The client must therefore
 * never compute the final status, and the hook rejects the request outright
 * if it tries. `rsvpQ.submitRsvp` sends intent only, which is the contract.
 *
 * CLIENT-ONLY ENFORCEMENT BELOW — load-bearing, do not delete as redundant.
 * `applyRsvpRules` returns early for `not_going` (it clears `position` and
 * stops), so on a withdrawal the server checks nothing beyond ownership:
 * not `rsvp_enabled`, not `rsvp_deadline`. These two guards are the only
 * enforcement that path has. They are deliberately scoped to `not_going`;
 * on the "going" path the hook enforces both itself, and repeating the
 * check here would only add a stale second opinion and a round-trip.
 */
export async function submitRsvp(input: {
  eventId: string;
  occurrenceDate: string | null;
  userId: string;
  choice: "going" | "not_going";
}) {
  if (input.choice === "not_going") {
    const calRecord = await calendarQ.getCalendarEntry(pb, input.eventId);
    if (!calRecord.rsvp_enabled) {
      throw new Error("RSVP is not enabled for this event.");
    }
    if (
      calRecord.rsvp_deadline &&
      new Date() > parsePBDate(calRecord.rsvp_deadline)
    ) {
      throw new Error("RSVPs are closed for this event.");
    }
  }

  return rsvpQ.submitRsvp(pb, input);
}

/**
 * Remove the user's RSVP entirely.
 *
 * No pre-read and no client-side promotion: the hook's
 * `onRecordAfterDeleteSuccess` handler runs `maybePromoteWaitlist`, which
 * promotes the front of the waitlist into the freed seat and renumbers the
 * rest inside the same request.
 */
export async function cancelRsvp(rsvpId: string) {
  return rsvpQ.cancelRsvp(pb, rsvpId);
}
