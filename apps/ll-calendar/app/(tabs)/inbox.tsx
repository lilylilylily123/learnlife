import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { useAuth } from "@/context/AuthContext";
import {
  fetchConversations,
  type Conversation,
} from "@/lib/pocketbase";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const INITIALS_COLORS = ["#B892FF", "#FF6B35", "#C4F34A", "#4ADE80", "#60A5FA"];

function getInitialsColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return INITIALS_COLORS[Math.abs(hash) % INITIALS_COLORS.length];
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso.replace(" ", "T"));
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return date.toLocaleDateString("en-US", { weekday: "short" });
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface DisplayRow {
  id: string;
  name: string;
  preview: string;
  time: string;
  unread: boolean;
  avatarUri?: string;
  initials: string;
  initialsColor: string;
  initialsBg: string;
  conversationId: string;
  participantAvatar?: string;
}

function toDisplayRow(conv: Conversation, currentUserId: string): DisplayRow {
  // PocketBase may nest multi-relation expand under the field name or a keyed variant
  const participants = conv.expand?.participants ?? [];
  const other = participants.find((p) => p.id !== currentUserId) ?? participants[0];
  const name = other?.name || other?.username || other?.email || "Unknown";
  const initials = name.charAt(0).toUpperCase();
  const color = getInitialsColor(name);
  const hasUnread = !!conv.last_message && conv.last_sender !== currentUserId;

  return {
    id: conv.id,
    name,
    preview: conv.last_message || "No messages yet",
    time: formatTime(conv.last_message_at),
    unread: hasUnread,
    avatarUri: other?.avatar
      ? `https://learnlife.pockethost.io/api/files/users/${other.id}/${other.avatar}`
      : undefined,
    initials,
    initialsColor: "#FFFFFF",
    initialsBg: color,
    conversationId: conv.id,
    participantAvatar: other?.avatar || "",
  };
}

function Avatar({ row }: { row: DisplayRow }) {
  if (row.avatarUri) {
    return <Image source={{ uri: row.avatarUri }} style={s.avatar} contentFit="cover" />;
  }
  return (
    <View style={[s.avatarInitials, { backgroundColor: row.initialsBg }]}>
      <Text style={[s.initialsText, { color: row.initialsColor }]}>{row.initials}</Text>
    </View>
  );
}

function ConversationRow({ row, card = false }: { row: DisplayRow; card?: boolean }) {
  function openChat() {
    router.push({
      pathname: "/(modals)/chat",
      params: {
        conversationId: row.conversationId,
        participantName: row.name,
        participantAvatar: row.avatarUri || "",
      },
    });
  }

  return (
    <Pressable style={[s.row, card && s.rowCard]} onPress={openChat}>
      <View style={s.avatarWrap}>
        <Avatar row={row} />
        {row.unread && (
          <View style={[s.statusDot, s.dotOrange, s.dotTopRight]} />
        )}
      </View>
      <View style={s.rowBody}>
        <View style={s.rowTop}>
          <Text style={row.unread ? s.senderBold : s.senderNormal} numberOfLines={1}>
            {row.name}
          </Text>
          <Text style={[s.time, row.unread ? s.timeUnread : s.timeMuted]}>{row.time}</Text>
        </View>
        <Text style={row.unread ? s.previewBold : s.previewMuted} numberOfLines={1}>
          {row.preview}
        </Text>
      </View>
    </Pressable>
  );
}

export default function InboxScreen() {
  const { isAuthenticated, user } = useAuth();
  const [conversations, setConversations] = useState<DisplayRow[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      let cancelled = false;
      (async () => {
        setLoading(true);
        try {
          const convos = await fetchConversations(user.id);
          if (__DEV__ && convos.length > 0) {
            console.log("[inbox] first conv expand:", JSON.stringify(convos[0].expand));
          }
          if (!cancelled) {
            setConversations(convos.map((c) => toDisplayRow(c, user.id)));
          }
        } catch (e: any) {
          console.error("[inbox] Failed to load conversations", e?.message);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }, [user?.id])
  );

  if (!isAuthenticated) return <Redirect href="/(tabs)/" />;

  const unread = conversations.filter((c) => c.unread);
  const read = conversations.filter((c) => !c.unread);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Text style={s.title}>Messages</Text>
        <Pressable style={s.addBtn}>
          <MaterialIcons name="add" size={28} color="#2D1B4E" />
        </Pressable>
      </View>

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="small" color="#C4F34A" />
        </View>
      ) : conversations.length === 0 ? (
        <View style={s.emptyState}>
          <Text style={s.emptyEmoji}>💬</Text>
          <Text style={s.emptyTitle}>All caught up!</Text>
          <Text style={s.emptySubtext}>No conversations yet</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll} style={s.scrollView}>
          {unread.length > 0 && (
            <>
              <Text style={s.sectionLabel}>NEEDS ACTION</Text>
              {unread.map((row) => (
                <ConversationRow key={row.id} row={row} card />
              ))}
            </>
          )}

          {read.length > 0 && (
            <>
              <Text style={[s.sectionLabel, unread.length > 0 && { marginTop: 24 }]}>
                RECENT
              </Text>
              <View style={s.recentList}>
                {read.map((row, i) => (
                  <View key={row.id}>
                    <ConversationRow row={row} />
                    {i < read.length - 1 && <View style={s.divider} />}
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      )}

      <BottomNav active="inbox" />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F9FAFC" },
  scrollView: { flex: 1 },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyState: { flex: 1, justifyContent: "center", alignItems: "center", gap: 6 },
  emptyEmoji: { fontSize: 42 },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: "#2D1B4E" },
  emptySubtext: { fontSize: 15, fontWeight: "500", color: "#8A7E9E" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: "#2D1B4E",
  },
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8A7E9E",
    letterSpacing: 1,
    paddingHorizontal: 8,
    marginBottom: 10,
  },
  recentList: {
    gap: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 16,
  },
  rowCard: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
    marginBottom: 4,
  },
  avatarWrap: {
    position: "relative",
    flexShrink: 0,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 999,
  },
  avatarInitials: {
    width: 56,
    height: 56,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  initialsText: {
    fontSize: 20,
    fontWeight: "700",
  },
  statusDot: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#F9FAFC",
  },
  dotOrange: { backgroundColor: "#FF6B35" },
  dotLime: { backgroundColor: "#C4F34A" },
  dotTopRight: { top: -1, right: -1 },
  dotBottomRight: { bottom: 0, right: 0 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 4,
  },
  senderBold: {
    fontSize: 17,
    fontWeight: "700",
    color: "#2D1B4E",
    flex: 1,
    marginRight: 8,
  },
  senderNormal: {
    fontSize: 17,
    fontWeight: "500",
    color: "#2D1B4E",
    flex: 1,
    marginRight: 8,
  },
  time: {
    fontSize: 13,
    flexShrink: 0,
  },
  timeUnread: {
    fontWeight: "700",
    color: "#FF6B35",
  },
  timeMuted: {
    fontWeight: "500",
    color: "#8A7E9E",
  },
  previewBold: {
    fontSize: 15,
    fontWeight: "700",
    color: "#2D1B4E",
  },
  previewMuted: {
    fontSize: 15,
    fontWeight: "500",
    color: "#8A7E9E",
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(138,126,158,0.1)",
    marginLeft: 84,
    marginRight: 12,
  },
});
