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
import { Colors, Fonts } from "@/constants/theme";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const INITIALS_COLORS = ["#4F6B4A", "#C26B3C", "#C4D98B", "#4ADE80", "#60A5FA"];

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
  const { isAuthenticated, user, role } = useAuth();
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
        <View>
          <Text style={s.kicker}>Inbox</Text>
          <Text style={s.title}>Messages</Text>
        </View>
        {(role === "lg" || role === "admin") && (
          <Pressable style={s.addBtn}>
            <MaterialIcons name="add" size={22} color={Colors.textPrimary} />
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="small" color={Colors.lavender} />
        </View>
      ) : conversations.length === 0 ? (
        <View style={s.emptyState}>
          <Text style={s.emptyTitle}>All caught up</Text>
          <Text style={s.emptySubtext}>No conversations yet.</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.scroll}
          style={s.scrollView}
        >
          {unread.length > 0 && (
            <>
              <Text style={s.sectionLabel}>
                Needs reply · {unread.length}
              </Text>
              {unread.map((row) => (
                <ConversationRow key={row.id} row={row} card />
              ))}
            </>
          )}

          {read.length > 0 && (
            <>
              <Text
                style={[s.sectionLabel, unread.length > 0 && { marginTop: 24 }]}
              >
                Recent
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
  safe: { flex: 1, backgroundColor: Colors.background },
  scrollView: { flex: 1 },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 26,
    fontWeight: "700",
    fontFamily: Fonts.display,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  emptySubtext: { fontSize: 14, fontWeight: "500", color: Colors.muted },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 14,
  },
  kicker: {
    color: Colors.muted,
    fontSize: 10,
    fontFamily: Fonts.mono,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  title: {
    fontSize: 34,
    fontFamily: Fonts.display,
    fontWeight: "700",
    color: Colors.textPrimary,
    letterSpacing: -0.7,
    lineHeight: 36,
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.textPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    paddingHorizontal: 0,
    paddingBottom: 110,
  },
  sectionLabel: {
    fontSize: 10,
    fontFamily: Fonts.mono,
    fontWeight: "700",
    color: Colors.muted,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    paddingHorizontal: 24,
    marginBottom: 6,
    marginTop: 4,
  },
  recentList: {
    gap: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  rowCard: {
    backgroundColor: Colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: Colors.orange,
  },
  avatarWrap: {
    position: "relative",
    flexShrink: 0,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 999,
  },
  avatarInitials: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  initialsText: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: Fonts.display,
  },
  statusDot: {
    position: "absolute",
    width: 11,
    height: 11,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: Colors.background,
  },
  dotOrange: { backgroundColor: Colors.orange },
  dotLime: { backgroundColor: Colors.lime },
  dotTopRight: { top: -1, right: -1 },
  dotBottomRight: { bottom: 0, right: 0 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 2,
  },
  senderBold: {
    fontSize: 14.5,
    fontWeight: "700",
    color: Colors.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  senderNormal: {
    fontSize: 14.5,
    fontWeight: "600",
    color: Colors.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  time: {
    fontSize: 11,
    fontFamily: Fonts.mono,
    flexShrink: 0,
  },
  timeUnread: {
    fontWeight: "700",
    color: Colors.orange,
  },
  timeMuted: {
    fontWeight: "500",
    color: Colors.muted,
  },
  previewBold: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  previewMuted: {
    fontSize: 13,
    fontWeight: "500",
    color: Colors.muted,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginLeft: 80,
    marginRight: 24,
  },
});
