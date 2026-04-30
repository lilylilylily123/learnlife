import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "@/context/AuthContext";
import {
  fetchMessages,
  sendMessage,
  markMessagesRead,
  subscribeToMessages,
  type Message,
} from "@/lib/pocketbase";

function formatTime(dateString: string): string {
  const d = new Date(dateString);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function ChatModal() {
  const { user } = useAuth();
  const params = useLocalSearchParams<{
    conversationId: string;
    participantName: string;
    participantAvatar?: string;
  }>();

  const conversationId = params.conversationId ?? "";
  const participantName = params.participantName ?? "Chat";

  const [messages, setMessages] = useState<Message[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList<Message>>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, []);

  useEffect(() => {
    if (!conversationId || !user?.id) return;

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const fetched = await fetchMessages(conversationId);
      if (cancelled) return;
      setMessages(fetched);
      setHasLoaded(true);
      scrollToBottom();

      markMessagesRead(conversationId, user.id);

      const unsub = await subscribeToMessages(conversationId, (newMessage) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMessage.id)) return prev;
          return [...prev, newMessage];
        });
        scrollToBottom();

        if (newMessage.sender !== user.id) {
          markMessagesRead(conversationId, user.id);
        }
      });
      if (cancelled) {
        unsub();
        return;
      }
      unsubscribe = unsub;
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [conversationId, user?.id, scrollToBottom]);

  async function handleSend() {
    const body = inputText.trim();
    if (!body || !user?.id || !conversationId || sending) return;

    setSending(true);
    setInputText("");
    try {
      await sendMessage(conversationId, user.id, body);
      scrollToBottom();
    } catch {
      setInputText(body);
    } finally {
      setSending(false);
    }
  }

  function getInitials(name: string): string {
    return name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }

  const isOwnMessage = (msg: Message) => msg.sender === user?.id;

  function renderMessage({ item }: { item: Message }) {
    const own = isOwnMessage(item);

    return (
      <View style={[s.messageRow, own ? s.messageRowOwn : s.messageRowOther]}>
        {!own && (
          <View style={s.avatar}>
            <Text style={s.avatarText}>{getInitials(participantName)}</Text>
          </View>
        )}
        <View style={[s.bubble, own ? s.bubbleOwn : s.bubbleOther]}>
          <Text style={s.bubbleText}>{item.body}</Text>
          <Text style={[s.timestamp, own ? s.timestampOwn : s.timestampOther]}>
            {formatTime(item.created)}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={22} color="#1F1B16" />
        </Pressable>
        <Text style={s.headerTitle} numberOfLines={1}>
          {participantName}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 60 : 0}
      >
        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={s.messageList}
          onContentSizeChange={() => scrollToBottom()}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            hasLoaded ? (
              <View style={s.emptyContainer}>
                <Text style={s.emptyText}>No messages yet</Text>
                <Text style={s.emptySubtext}>
                  Send a message to start the conversation
                </Text>
              </View>
            ) : null
          }
        />

        {/* Input bar */}
        <View style={s.inputBar}>
          <TextInput
            style={s.input}
            placeholder="Type a message..."
            placeholderTextColor="#807663"
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={2000}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={handleSend}
          />
          <Pressable
            style={[s.sendBtn, !inputText.trim() && s.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() || sending}
          >
            <MaterialIcons name="send" size={20} color="#1F1B16" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F3EEE5" },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(128,118,99,0.1)",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: "#EAE3D3",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1F1B16",
    flex: 1,
    textAlign: "center",
    marginHorizontal: 12,
  },

  // Message list
  messageList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexGrow: 1,
  },
  messageRow: {
    flexDirection: "row",
    marginBottom: 12,
    maxWidth: "80%",
  },
  messageRowOwn: {
    alignSelf: "flex-end",
  },
  messageRowOther: {
    alignSelf: "flex-start",
  },

  // Avatar
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: "#EAE3D3",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    marginTop: 4,
  },
  avatarText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1F1B16",
  },

  // Bubbles
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "100%",
  },
  bubbleOwn: {
    backgroundColor: "#C4D98B",
    borderBottomRightRadius: 4,
    shadowColor: "#1F1B16",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  bubbleOther: {
    backgroundColor: "#FFFFFF",
    borderBottomLeftRadius: 4,
    shadowColor: "#1F1B16",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  bubbleText: {
    fontSize: 15,
    color: "#1F1B16",
    lineHeight: 21,
  },
  timestamp: {
    fontSize: 11,
    marginTop: 4,
  },
  timestampOwn: {
    color: "rgba(45,27,78,0.5)",
    textAlign: "right",
  },
  timestampOther: {
    color: "#807663",
    textAlign: "left",
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1F1B16",
    marginBottom: 6,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#807663",
  },

  // Input bar
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "rgba(128,118,99,0.1)",
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: "#EAE3D3",
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    fontSize: 15,
    color: "#1F1B16",
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: "#C4D98B",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#1F1B16",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
});
