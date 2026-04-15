import type PocketBase from "pocketbase";
import type { Conversation, Message } from "../types";

/** Fetch all conversations that a given user participates in, newest first. */
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

/** Fetch all messages in a conversation in chronological order. */
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

/**
 * Send a message and update the conversation's last-message metadata in one go.
 *
 * NOTE: these are two separate PocketBase writes. If the second (conversation
 * update) fails, the message will still exist but the conversation list will
 * show stale preview text. Consider wrapping in a PocketBase transaction or
 * a server-side hook if atomicity becomes important.
 */
export async function sendMessage(
  pb: PocketBase,
  conversationId: string,
  senderId: string,
  body: string,
): Promise<Message> {
  // Create the message and immediately mark it as read by the sender.
  const message = await pb.collection("messages").create<Message>({
    conversation: conversationId,
    sender: senderId,
    body,
    read_by: [senderId],
  });

  // Denormalise conversation metadata for efficient list rendering.
  await pb.collection("conversations").update(conversationId, {
    last_message: body,
    last_message_at: new Date().toISOString(),
    last_sender: senderId,
  });

  return message;
}

/**
 * Create a new conversation between the given participants.
 * The caller is responsible for ensuring no duplicate conversation already exists.
 */
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

/**
 * Mark all unread messages in a conversation as read by the given user.
 *
 * Each message is updated individually — for conversations with many unread
 * messages this can result in a large number of requests. A server-side hook
 * or batch endpoint would be more efficient if this becomes a bottleneck.
 */
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

/**
 * Subscribe to new messages in a specific conversation via PocketBase realtime.
 *
 * Returns an unsubscribe function. Call it when the component unmounts or
 * the conversation changes to avoid memory leaks.
 *
 * ⚠️  Bug: the returned cleanup calls `unsubscribe("*")` which removes ALL
 * message subscriptions on this client, not just the one registered here.
 * If multiple conversations are subscribed simultaneously, switching away
 * from one will silently break the others. Fix by storing and calling the
 * specific unsubscribe function returned by `pb.collection().subscribe()`.
 */
export function subscribeToMessages(
  pb: PocketBase,
  conversationId: string,
  callback: (message: Message) => void,
): () => void {
  pb.collection("messages").subscribe<Message>("*", (e) => {
    // Filter client-side: PocketBase realtime sends all message events; we
    // only forward ones that belong to the conversation we care about.
    if (e.record.conversation === conversationId) {
      callback(e.record);
    }
  });

  return () => {
    // TODO: store the unsubscribe fn from subscribe() and call it here instead
    // of using the collection-wide unsubscribe("*").
    pb.collection("messages").unsubscribe("*");
  };
}
