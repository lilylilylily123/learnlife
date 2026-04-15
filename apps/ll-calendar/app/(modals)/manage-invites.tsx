import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
  listInvites,
  listLearners,
  createInvite,
} from "@/lib/pocketbase";
import type { Invite, Learner } from "@learnlife/pb-client";

type Screen = "list" | "create";

export default function ManageInvitesScreen() {
  const { user, role } = useAuth();
  const [screen, setScreen] = useState<Screen>("list");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUsed, setShowUsed] = useState(false);

  // Create flow
  const [search, setSearch] = useState("");
  const [learners, setLearners] = useState<Learner[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  const canManage = role === "admin" || role === "lg";

  const loadInvites = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listInvites({ showUsed });
      setInvites(result);
    } catch (e: any) {
      console.error("[invites] load failed", e?.message);
    } finally {
      setLoading(false);
    }
  }, [showUsed]);

  useFocusEffect(
    useCallback(() => {
      if (canManage) loadInvites();
    }, [canManage, loadInvites]),
  );

  async function handleSearch(text: string) {
    setSearch(text);
    if (text.trim().length < 2) {
      setLearners([]);
      return;
    }
    setSearchLoading(true);
    try {
      const result = await listLearners({ search: text.trim() });
      setLearners(result.items);
    } catch {
      setLearners([]);
    } finally {
      setSearchLoading(false);
    }
  }

  async function handleCreateInvite(learner: Learner) {
    if (!user?.id) return;
    setCreating(true);
    try {
      const invite = await createInvite({
        learnerId: learner.id,
        email: learner.email,
        createdBy: user.id,
      });
      setCreatedCode(invite.code);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to create invite.");
    } finally {
      setCreating(false);
    }
  }

  function resetCreate() {
    setSearch("");
    setLearners([]);
    setCreatedCode(null);
    setScreen("list");
    loadInvites();
  }

  if (!canManage) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <Text style={s.emptyText}>You don&apos;t have permission to manage invites.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Created confirmation ──────────────────────────────────────────────────
  if (createdCode) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <Pressable style={s.backBtn} onPress={resetCreate}>
            <MaterialIcons name="close" size={24} color="#2D1B4E" />
          </Pressable>
          <Text style={s.title}>Invite Created</Text>
          <View style={s.backBtn} />
        </View>

        <View style={s.center}>
          <View style={s.codeHero}>
            <MaterialIcons name="check-circle" size={56} color="#4ADE80" />
            <Text style={s.codeLabel}>Invite Code</Text>
            <Text style={s.codeValue}>{createdCode}</Text>
            <Text style={s.codeHint}>
              Share this code with the learner. It expires in 7 days.
            </Text>
          </View>

          <Pressable style={s.primaryBtn} onPress={resetCreate}>
            <Text style={s.primaryBtnText}>Done</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── Create screen ─────────────────────────────────────────────────────────
  if (screen === "create") {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <Pressable style={s.backBtn} onPress={() => setScreen("list")}>
            <MaterialIcons name="arrow-back" size={24} color="#2D1B4E" />
          </Pressable>
          <Text style={s.title}>New Invite</Text>
          <View style={s.backBtn} />
        </View>

        <View style={s.searchSection}>
          <Text style={s.label}>Search Learner</Text>
          <View style={s.searchWrap}>
            <MaterialIcons name="search" size={20} color="#8A7E9E" />
            <TextInput
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={handleSearch}
              placeholder="Name or email..."
              placeholderTextColor="#8A7E9E"
              style={s.searchInput}
              value={search}
            />
            {search.length > 0 && (
              <Pressable onPress={() => handleSearch("")}>
                <MaterialIcons name="close" size={18} color="#8A7E9E" />
              </Pressable>
            )}
          </View>
        </View>

        {searchLoading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="small" color="#C4F34A" />
          </View>
        ) : search.trim().length < 2 ? (
          <View style={s.hintWrap}>
            <Text style={s.hintText}>Type at least 2 characters to search</Text>
          </View>
        ) : learners.length === 0 ? (
          <View style={s.hintWrap}>
            <Text style={s.hintText}>No learners found</Text>
          </View>
        ) : (
          <FlatList
            data={learners}
            keyExtractor={(item) => item.id}
            contentContainerStyle={s.listContent}
            renderItem={({ item }) => (
              <Pressable
                style={s.learnerRow}
                disabled={creating}
                onPress={() =>
                  Alert.alert(
                    "Create Invite",
                    `Send an invite to ${item.name} (${item.email})?`,
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Create", onPress: () => handleCreateInvite(item) },
                    ],
                  )
                }
              >
                <View style={s.learnerAvatar}>
                  <Text style={s.learnerInitial}>
                    {item.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={s.learnerInfo}>
                  <Text style={s.learnerName}>{item.name}</Text>
                  <Text style={s.learnerEmail}>{item.email}</Text>
                </View>
                <View style={s.programBadge}>
                  <Text style={s.programText}>{item.program}</Text>
                </View>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    );
  }

  // ── List screen ───────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color="#2D1B4E" />
        </Pressable>
        <Text style={s.title}>Invites</Text>
        <Pressable style={s.backBtn} onPress={() => setScreen("create")}>
          <MaterialIcons name="add" size={24} color="#2D1B4E" />
        </Pressable>
      </View>

      <Pressable
        style={s.filterToggle}
        onPress={() => setShowUsed((v) => !v)}
      >
        <MaterialIcons
          name={showUsed ? "check-box" : "check-box-outline-blank"}
          size={20}
          color="#8A7E9E"
        />
        <Text style={s.filterText}>Show used / expired</Text>
      </Pressable>

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="small" color="#C4F34A" />
        </View>
      ) : invites.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyEmoji}>📨</Text>
          <Text style={s.emptyText}>No invites yet</Text>
          <Pressable style={s.primaryBtn} onPress={() => setScreen("create")}>
            <Text style={s.primaryBtnText}>Create First Invite</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={invites}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.listContent}
          onRefresh={loadInvites}
          refreshing={loading}
          renderItem={({ item }) => {
            const expired = new Date(item.expires_at) < new Date();
            const status = item.used
              ? "Used"
              : expired
              ? "Expired"
              : "Active";
            const statusColor =
              status === "Active"
                ? "#4ADE80"
                : status === "Expired"
                ? "#F97316"
                : "#8A7E9E";

            return (
              <View style={s.inviteCard}>
                <View style={s.inviteTop}>
                  <Text style={s.inviteCode}>{item.code}</Text>
                  <View style={[s.statusPill, { backgroundColor: statusColor + "22" }]}>
                    <View style={[s.statusDot, { backgroundColor: statusColor }]} />
                    <Text style={[s.statusText, { color: statusColor }]}>
                      {status}
                    </Text>
                  </View>
                </View>
                <Text style={s.inviteName}>
                  {item.expand?.learner?.name ?? item.email}
                </Text>
                <Text style={s.inviteMeta}>
                  {item.email} · Expires{" "}
                  {new Date(item.expires_at).toLocaleDateString()}
                </Text>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F9FAFC" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  title: { fontSize: 22, fontWeight: "700", color: "#2D1B4E" },
  filterToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  filterText: { fontSize: 14, color: "#8A7E9E", fontWeight: "600" },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12, padding: 24 },
  emptyEmoji: { fontSize: 42 },
  emptyText: { fontSize: 16, color: "#8A7E9E", fontWeight: "600" },
  listContent: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  inviteCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  inviteTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  inviteCode: {
    fontSize: 20,
    fontWeight: "800",
    color: "#2D1B4E",
    letterSpacing: 3,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusDot: { width: 8, height: 8, borderRadius: 999 },
  statusText: { fontSize: 12, fontWeight: "700" },
  inviteName: { fontSize: 16, fontWeight: "700", color: "#2D1B4E" },
  inviteMeta: { fontSize: 13, color: "#8A7E9E", fontWeight: "500", marginTop: 2 },
  // Create screen
  searchSection: { paddingHorizontal: 20, marginBottom: 8 },
  label: { color: "#2D1B4E", fontSize: 14, fontWeight: "700", marginBottom: 8 },
  searchWrap: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.select({ ios: 14, default: 10 }),
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  searchInput: { color: "#2D1B4E", flex: 1, fontSize: 16 },
  hintWrap: { alignItems: "center", paddingTop: 40 },
  hintText: { fontSize: 15, color: "#8A7E9E", fontWeight: "600" },
  learnerRow: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  learnerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: "#B892FF",
    alignItems: "center",
    justifyContent: "center",
  },
  learnerInitial: { fontSize: 18, fontWeight: "700", color: "#FFFFFF" },
  learnerInfo: { flex: 1 },
  learnerName: { fontSize: 16, fontWeight: "700", color: "#2D1B4E" },
  learnerEmail: { fontSize: 13, color: "#8A7E9E", fontWeight: "500" },
  programBadge: {
    backgroundColor: "#C4F34A22",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  programText: { fontSize: 11, fontWeight: "700", color: "#2D1B4E" },
  // Code confirmation
  codeHero: { alignItems: "center", gap: 12, marginBottom: 24 },
  codeLabel: { fontSize: 14, fontWeight: "700", color: "#8A7E9E" },
  codeValue: {
    fontSize: 40,
    fontWeight: "800",
    color: "#2D1B4E",
    letterSpacing: 8,
  },
  codeHint: {
    fontSize: 14,
    color: "#8A7E9E",
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: 32,
  },
  primaryBtn: {
    backgroundColor: "#C4F34A",
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 14,
  },
  primaryBtnText: { fontSize: 16, fontWeight: "700", color: "#2D1B4E" },
});
