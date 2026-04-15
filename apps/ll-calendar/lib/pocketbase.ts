import PocketBase, { AsyncAuthStore } from "pocketbase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CalRecord, CalEvent, CalRecurrence } from "./calendar-utils";
export type { CalRecord, CalEvent, CalRecurrence };
export { expandEvents } from "./calendar-utils";

// Replace with your actual PocketBase URL.
// Note: For Android Emulator, use 'http://10.0.2.2:8090' instead of localhost
// For iOS Simulator, 'http://127.0.0.1:8090' works.
const POCKETBASE_URL = "https://learnlife.pockethost.io";

const store = new AsyncAuthStore({
  save: async (serialized) => AsyncStorage.setItem("pb_auth", serialized),
  initial: AsyncStorage.getItem("pb_auth"),
  clear: async () => AsyncStorage.removeItem("pb_auth"),
});

export const pb = new PocketBase(POCKETBASE_URL, store);

export async function login(email: string, password: string) {
  try {
    const authData = await pb
      .collection("users")
      .authWithPassword(email, password);
    return authData;
  } catch (error) {
    console.error("Login failed:", error);
    throw error;
  }
}

export function logout() {
  pb.authStore.clear();
}

export async function register(userData: any) {
  try {
    const record = await pb.collection("users").create(userData);
    await login(userData.email, userData.password);
    return record;
  } catch (error) {
    console.error("Registration failed:", error);
    throw error;
  }
}

export function isAuthenticated() {
  return pb.authStore.isValid;
}

// ─── Calendar types ────────────────────────────────────────────────────────

export interface CreateEntryPayload {
  title: string;
  start: string;
  end: string;
  color: string;
  emoji: string;
  type: "event" | "class";
  recurrence: CalRecurrence;
  recurrence_days: number[];
  recurrence_end: string;
  created_by: string;
}

// ─── Calendar API ──────────────────────────────────────────────────────────

export async function fetchCalendarEvents(
  userId: string,
  _monthStart: Date,
  _monthEnd: Date
): Promise<CalRecord[]> {
  const result = await pb.collection("calendar").getFullList<CalRecord>({
    filter: `created_by = "${userId}"`,
    sort: "start",
  });
  return result;
}

export async function createCalendarEntry(
  data: CreateEntryPayload
): Promise<CalRecord> {
  return pb.collection("calendar").create<CalRecord>(data);
}

export async function deleteCalendarEntry(id: string): Promise<void> {
  await pb.collection("calendar").delete(id);
}

// ─── Messaging types ──────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  participants: string[];
  last_message: string;
  last_message_at: string;
  last_sender: string;
  created: string;
  updated: string;
  expand?: {
    participants?: { id: string; name: string; username: string; email: string; avatar: string }[];
    last_sender?: { id: string; name: string; username: string };
  };
}

export interface Message {
  id: string;
  conversation: string;
  sender: string;
  body: string;
  read_by: string[];
  created: string;
  expand?: {
    sender?: { id: string; name: string; username: string; avatar: string };
  };
}

// ─── Messaging API ────────────────────────────────────────────────────────

export async function fetchConversations(
  userId: string
): Promise<Conversation[]> {
  return pb.collection("conversations").getFullList<Conversation>({
    filter: `participants.id ?= "${userId}"`,
    sort: "-last_message_at",
    expand: "participants,last_sender",
  });
}

export async function fetchMessages(
  conversationId: string
): Promise<Message[]> {
  return pb.collection("messages").getFullList<Message>({
    filter: `conversation = "${conversationId}"`,
    sort: "created",
    expand: "sender",
  });
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  body: string
): Promise<Message> {
  const message = await pb.collection("messages").create<Message>({
    conversation: conversationId,
    sender: senderId,
    body,
    read_by: [senderId],
  });

  await pb.collection("conversations").update(conversationId, {
    last_message: body,
    last_message_at: new Date().toISOString(),
    last_sender: senderId,
  });

  return message;
}

export async function createConversation(
  participantIds: string[]
): Promise<Conversation> {
  return pb.collection("conversations").create<Conversation>({
    participants: participantIds,
    last_message: "",
    last_message_at: new Date().toISOString(),
    last_sender: "",
  });
}

export async function markMessagesRead(
  conversationId: string,
  userId: string
): Promise<void> {
  const unread = await pb.collection("messages").getFullList<Message>({
    filter: `conversation = "${conversationId}" && read_by !~ "${userId}"`,
  });

  await Promise.all(
    unread.map((msg) =>
      pb.collection("messages").update(msg.id, {
        read_by: [...msg.read_by, userId],
      })
    )
  );
}

export function subscribeToMessages(
  conversationId: string,
  callback: (message: Message) => void
): () => void {
  pb.collection("messages").subscribe<Message>("*", (e) => {
    if (e.record.conversation === conversationId) {
      callback(e.record);
    }
  });

  return () => {
    pb.collection("messages").unsubscribe("*");
  };
}

