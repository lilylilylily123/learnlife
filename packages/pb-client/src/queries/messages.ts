import type PocketBase from "pocketbase";
import type { Conversation, Message } from "../types";

/** Fetch all conversations that a given user participates in, newest first. */
export async function fetchConversations(
  pb: PocketBase,
  userId: string,
): Promise<Conversation[]> {
  return pb.collection("conversations").getFullList<Conversation>({
    filter: pb.filter("participants.id ?= {:userId}", { userId }),
    sort: "-last_message_at",
    expand: "participants,last_sender",
  });
}

/**
 * Fetch the most recent page of messages in a conversation, sorted oldest
 * first within the page. Capped at `perPage` to bound memory and avoid
 * runaway requests on conversations with thousands of messages — callers can
 * increase `perPage` or paginate older messages on demand.
 */
export async function fetchMessages(
  pb: PocketBase,
  conversationId: string,
  opts: { page?: number; perPage?: number } = {},
): Promise<Message[]> {
  const page = opts.page ?? 1;
  const perPage = Math.min(opts.perPage ?? 100, 200);
  const result = await pb.collection("messages").getList<Message>(page, perPage, {
    filter: pb.filter("conversation = {:conversationId}", { conversationId }),
    // Newest first so we can grab the latest page; reverse before returning so
    // the UI gets chronological order.
    sort: "-created",
    expand: "sender",
  });
  return result.items.slice().reverse();
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
 * Find an existing 1:1 conversation between exactly the given participant ids.
 * Returns null if none exists. Order of ids does not matter.
 */
export async function findDirectConversation(
  pb: PocketBase,
  participantIds: string[],
): Promise<Conversation | null> {
  if (participantIds.length === 0) return null;
  const filter = participantIds
    .map((id, i) => pb.filter(`participants.id ?= {:p${i}}`, { [`p${i}`]: id }))
    .join(" && ");
  const results = await pb
    .collection("conversations")
    .getFullList<Conversation>({ filter });
  return (
    results.find((c) => c.participants.length === participantIds.length) ?? null
  );
}

export interface MessageableUser {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar: string;
  role: string;
}

/**
 * List users that can be messaged. Filters out the current user and supports
 * search by name/username/email and an optional role allowlist.
 */
export async function listMessageableUsers(
  pb: PocketBase,
  opts: {
    excludeUserId: string;
    search?: string;
    roles?: string[];
  } = { excludeUserId: "" },
): Promise<MessageableUser[]> {
  const filterParts: string[] = [];
  if (opts.excludeUserId) {
    filterParts.push(
      pb.filter("id != {:excludeUserId}", { excludeUserId: opts.excludeUserId }),
    );
  }
  if (opts.roles && opts.roles.length > 0) {
    const roleFilter = opts.roles
      .map((r, i) => pb.filter(`role = {:r${i}}`, { [`r${i}`]: r }))
      .join(" || ");
    filterParts.push(`(${roleFilter})`);
  }
  if (opts.search && opts.search.trim()) {
    // Note: don't include `email` here — PB's users collection protects email
    // by default (emailVisibility=false), and filtering on it returns HTTP 400
    // for non-owner records.
    const q = opts.search.trim();
    filterParts.push(pb.filter("(name ~ {:q} || username ~ {:q})", { q }));
  }
  const records = await pb.collection("users").getFullList({
    filter: filterParts.length > 0 ? filterParts.join(" && ") : undefined,
    sort: "name",
  });
  return records.map((r) => ({
    id: r.id,
    name: (r.name as string) ?? "",
    username: (r.username as string) ?? "",
    email: (r.email as string) ?? "",
    avatar: (r.avatar as string) ?? "",
    role: (r.role as string) ?? "",
  }));
}

/**
 * Mark unread messages in a conversation as read by the given user.
 *
 * Each message is updated individually, capped at `MARK_READ_BATCH` per call
 * so a single user opening a long-stale conversation can't trigger thousands
 * of writes. The cap is well above any realistic in-session unread count;
 * callers can re-invoke if more remain.
 */
const MARK_READ_BATCH = 100;
export async function markMessagesRead(
  pb: PocketBase,
  conversationId: string,
  userId: string,
): Promise<void> {
  const unread = await pb.collection("messages").getList<Message>(
    1,
    MARK_READ_BATCH,
    {
      filter: pb.filter(
        "conversation = {:conversationId} && read_by !~ {:userId}",
        { conversationId, userId },
      ),
    },
  );

  await Promise.all(
    unread.items.map((msg) =>
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
 */
export async function subscribeToMessages(
  pb: PocketBase,
  conversationId: string,
  callback: (message: Message) => void,
): Promise<() => void> {
  const unsubscribe = await pb.collection("messages").subscribe<Message>(
    "*",
    (e) => {
      // Filter client-side: PocketBase realtime sends all message events; we
      // only forward ones that belong to the conversation we care about.
      if (e.record.conversation === conversationId) {
        callback(e.record);
      }
    },
  );

  return unsubscribe;
}
