import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "@/context/AuthContext";
import {
  createConversation,
  findDirectConversation,
  listMessageableUsers,
} from "@/lib/pocketbase";
import { mapPbError } from "@/lib/errors";
import type { MessageableUser } from "@learnlife/pb-client";
import { Colors, Fonts } from "@/constants/theme";

const INITIALS_COLORS = ["#4F6B4A", "#C26B3C", "#C4D98B", "#4ADE80", "#60A5FA"];

function getInitialsColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return INITIALS_COLORS[Math.abs(hash) % INITIALS_COLORS.length];
}

function avatarUri(u: MessageableUser): string | undefined {
  if (!u.avatar) return undefined;
  return `https://learnlife.pockethost.io/api/files/users/${u.id}/${u.avatar}`;
}

function roleLabel(role: string): string {
  if (role === "lg") return "Guide";
  if (role === "admin") return "Admin";
  if (role === "learner") return "Learner";
  return role;
}

export default function NewConversationModal() {
  const { user, role } = useAuth();
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<MessageableUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Learners can only start conversations with guides/admins; guides can DM anyone.
  const isLearner = role === "learner";
  const audienceLabel = isLearner ? "guides and admins" : "people";

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const debounce = setTimeout(() => {
      (async () => {
        setLoading(true);
        try {
          // Don't pass `roles` to PB — filtering on `role` returns HTTP 400 when
          // the field isn't queryable by non-admins. Rely on the server listRule
          // for visibility and filter the displayed results client-side.
          const list = await listMessageableUsers({
            excludeUserId: user.id,
            search: search.trim() || undefined,
          });
          const filtered = isLearner
            ? list.filter((u) => u.role === "lg" || u.role === "admin")
            : list;
          if (!cancelled) setUsers(filtered);
        } catch (e: unknown) {
          if (!cancelled) {
            setErrorMsg(mapPbError(e, "Couldn't load users."));
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
    };
  }, [user?.id, search, isLearner]);

  async function handleSelect(other: MessageableUser) {
    if (!user?.id || creatingFor) return;
    setCreatingFor(other.id);
    setErrorMsg(null);
    try {
      const existing = await findDirectConversation([user.id, other.id]);
      const conv =
        existing ?? (await createConversation([user.id, other.id]));
      router.replace({
        pathname: "/(modals)/chat",
        params: {
          conversationId: conv.id,
          participantName: other.name || other.username || other.email,
          participantAvatar: avatarUri(other) ?? "",
        },
      });
    } catch (e: unknown) {
      setErrorMsg(mapPbError(e, "Couldn't start a conversation."));
      setCreatingFor(null);
    }
  }

  const empty = useMemo(
    () => !loading && users.length === 0,
    [loading, users.length],
  );

  function renderRow({ item }: { item: MessageableUser }) {
    const display = item.name || item.username || item.email;
    const initials = display.charAt(0).toUpperCase();
    const uri = avatarUri(item);
    const isCreating = creatingFor === item.id;

    return (
      <Pressable
        style={[s.row, isCreating && { opacity: 0.5 }]}
        onPress={() => handleSelect(item)}
        disabled={!!creatingFor}
      >
        <View style={s.avatarWrap}>
          {uri ? (
            <Image source={{ uri }} style={s.avatar} contentFit="cover" />
          ) : (
            <View
              style={[
                s.avatarInitials,
                { backgroundColor: getInitialsColor(display) },
              ]}
            >
              <Text style={s.initialsText}>{initials}</Text>
            </View>
          )}
        </View>
        <View style={s.rowBody}>
          <Text style={s.name} numberOfLines={1}>
            {display}
          </Text>
          <Text style={s.sub} numberOfLines={1}>
            {roleLabel(item.role)}
            {item.email ? ` · ${item.email}` : ""}
          </Text>
        </View>
        {isCreating ? (
          <ActivityIndicator size="small" color={Colors.muted} />
        ) : (
          <MaterialIcons
            name="chevron-right"
            size={22}
            color={Colors.muted}
          />
        )}
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.closeBtn} onPress={() => router.back()}>
          <MaterialIcons name="close" size={22} color={Colors.textPrimary} />
        </Pressable>
        <Text style={s.headerTitle}>New conversation</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={s.searchBar}>
        <MaterialIcons name="search" size={20} color={Colors.muted} />
        <TextInput
          style={s.searchInput}
          placeholder={
            isLearner ? "Search guides by name" : "Search by name"
          }
          placeholderTextColor={Colors.muted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")} hitSlop={8}>
            <MaterialIcons name="close" size={18} color={Colors.muted} />
          </Pressable>
        )}
      </View>

      {errorMsg && (
        <View style={s.errorBar}>
          <Text style={s.errorText}>{errorMsg}</Text>
        </View>
      )}

      {loading && users.length === 0 ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="small" color={Colors.lavender} />
        </View>
      ) : empty ? (
        <View style={s.emptyState}>
          <Text style={s.emptyTitle}>No matches</Text>
          <Text style={s.emptySub}>
            {search.trim()
              ? "Try a different name or email."
              : isLearner
                ? "No guides or admins are visible to you yet. If this looks wrong, ask an admin to update the PocketBase users list rule so learners can see staff."
                : `There are no ${audienceLabel} to message yet.`}
          </Text>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          renderItem={renderRow}
          contentContainerStyle={s.list}
          ItemSeparatorComponent={() => <View style={s.divider} />}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: Colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: Colors.textPrimary,
    fontFamily: Fonts.display,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    margin: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.textPrimary,
    paddingVertical: 2,
  },
  errorBar: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    backgroundColor: "rgba(194, 107, 60, 0.1)",
    borderRadius: 10,
  },
  errorText: { fontSize: 13, color: Colors.orange, fontWeight: "600" },
  loadingWrap: {
    paddingVertical: 32,
    alignItems: "center",
  },
  emptyState: {
    paddingTop: 60,
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.textPrimary,
    fontFamily: Fonts.display,
  },
  emptySub: {
    fontSize: 13,
    color: Colors.muted,
    textAlign: "center",
  },
  list: { paddingBottom: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  avatarWrap: { flexShrink: 0 },
  avatar: { width: 44, height: 44, borderRadius: 999 },
  avatarInitials: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  initialsText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    fontFamily: Fonts.display,
  },
  rowBody: { flex: 1, minWidth: 0 },
  name: {
    fontSize: 14.5,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  sub: {
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginLeft: 76,
  },
});
