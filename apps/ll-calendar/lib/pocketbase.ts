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
} from "@learnlife/pb-client";
export { expandEvents } from "@learnlife/shared";
export type {
  CalRecord,
  CalEvent,
  CalRecurrence,
  CreateCalEntryPayload as CreateEntryPayload,
  Conversation,
  Message,
} from "@learnlife/pb-client";

function createAuthStore() {
  if (Platform.OS === "web") {
    const hasLocalStorage = typeof window !== "undefined" && window.localStorage;
    return new AsyncAuthStore({
      save: async (serialized) => hasLocalStorage && localStorage.setItem("pb_auth", serialized),
      initial: hasLocalStorage ? localStorage.getItem("pb_auth") ?? "" : "",
      clear: async () => hasLocalStorage && localStorage.removeItem("pb_auth"),
    });
  }
  // Native: use AsyncStorage
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AsyncStorage = require("@react-native-async-storage/async-storage").default;
  return new AsyncAuthStore({
    save: async (serialized: string) => AsyncStorage.setItem("pb_auth", serialized),
    initial: AsyncStorage.getItem("pb_auth"),
    clear: async () => AsyncStorage.removeItem("pb_auth"),
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

export async function register(userData: any) {
  const record = await pb.collection("users").create(userData);
  await auth.login(pb, userData.email, userData.password);
  return record;
}

export function isAuthenticated() {
  return auth.isAuthenticated(pb);
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
export async function fetchCalendarEvents(
  userId: string,
  _monthStart: Date,
  _monthEnd: Date,
) {
  return calendarQ.fetchCalendarEvents(pb, userId);
}

export async function createCalendarEntry(
  data: import("@learnlife/pb-client").CreateCalEntryPayload,
) {
  return calendarQ.createCalendarEntry(pb, data);
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

export async function markMessagesRead(
  conversationId: string,
  userId: string,
) {
  return messagesQ.markMessagesRead(pb, conversationId, userId);
}

export function subscribeToMessages(
  conversationId: string,
  callback: (message: import("@learnlife/pb-client").Message) => void,
) {
  return messagesQ.subscribeToMessages(pb, conversationId, callback);
}
