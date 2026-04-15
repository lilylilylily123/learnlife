import type PocketBase from "pocketbase";
import type { Conversation, Message } from "../types";

export async function fetchConversations(
  pb: PocketBase,
  userId: string,
): Promise<Conversation[]> {
  return pb.collection("conversations").getFullList<Conversation>({
    filter: `participants.id ?= "${userId}"`,
    sort: "-last_message_at",
    expand: "participants,last_sender",
  });
}

export async function fetchMessages(
  pb: PocketBase,
  conversationId: string,
): Promise<Message[]> {
  return pb.collection("messages").getFullList<Message>({
    filter: `conversation = "${conversationId}"`,
    sort: "created",
    expand: "sender",
  });
}

export async function sendMessage(
  pb: PocketBase,
  conversationId: string,
  senderId: string,
  body: string,
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
  pb: PocketBase,
  participantIds: string[],
): Promise<Conversation> {
  return pb.collection("conversations").create<Conversation>({
    participants: participantIds,
    last_message: "",
    last_message_at: new Date().toISOString(),
    last_sender: "",
  });
}

export async function markMessagesRead(
  pb: PocketBase,
  conversationId: string,
  userId: string,
): Promise<void> {
  const unread = await pb.collection("messages").getFullList<Message>({
    filter: `conversation = "${conversationId}" && read_by !~ "${userId}"`,
  });

  await Promise.all(
    unread.map((msg) =>
      pb.collection("messages").update(msg.id, {
        read_by: [...msg.read_by, userId],
      }),
    ),
  );
}

export function subscribeToMessages(
  pb: PocketBase,
  conversationId: string,
  callback: (message: Message) => void,
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
