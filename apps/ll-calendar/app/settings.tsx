import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAuth } from "@/context/AuthContext";
import { logout, requestPasswordReset } from "@/lib/pocketbase";
import { Colors, Fonts } from "@/constants/theme";

const PROGRAM_LABEL: Record<string, string> = {
  chmk: "Changemakers",
  cre: "Creators",
  exp: "Explorers",
};

const ROLE_LABEL: Record<string, string> = {
  learner: "Learner",
  lg: "Guide",
  admin: "Admin",
};

export default function SettingsScreen() {
  const { user, role, program } = useAuth();
  const [resetting, setResetting] = useState(false);

  const displayName = user?.name || user?.username || "—";
  const initial = displayName.charAt(0).toUpperCase();

  function handleLogout() {
    Alert.alert("Log out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: () => {
          logout();
          router.replace("/(tabs)");
        },
      },
    ]);
  }

  async function handlePasswordReset() {
    if (!user?.email || resetting) return;
    setResetting(true);
    try {
      await requestPasswordReset(user.email);
      Alert.alert(
        "Check your email",
        `A password reset link was sent to ${user.email}.`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not send reset email.";
      Alert.alert("Failed", msg);
    } finally {
      setResetting(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.closeBtn} onPress={() => router.back()}>
          <MaterialIcons name="close" size={22} color={Colors.textPrimary} />
        </Pressable>
        <Text style={s.headerTitle}>Settings</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.profileCard}>
          <View style={s.avatarLg}>
            <Text style={s.avatarLgText}>{initial}</Text>
          </View>
          <Text style={s.name}>{displayName}</Text>
          {user?.email ? <Text style={s.email}>{user.email}</Text> : null}
          <View style={s.badgeRow}>
            {role ? (
              <View style={s.badge}>
                <Text style={s.badgeText}>{ROLE_LABEL[role] ?? role}</Text>
              </View>
            ) : null}
            {program ? (
              <View style={[s.badge, s.badgeAlt]}>
                <Text style={s.badgeText}>
                  {PROGRAM_LABEL[program] ?? program}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <Text style={s.sectionLabel}>Account</Text>
        <View style={s.group}>
          <Pressable
            style={s.row}
            onPress={handlePasswordReset}
            disabled={resetting}
          >
            <MaterialIcons name="lock-reset" size={20} color={Colors.textPrimary} />
            <Text style={s.rowLabel}>
              {resetting ? "Sending…" : "Send password reset email"}
            </Text>
            <MaterialIcons name="chevron-right" size={20} color={Colors.muted} />
          </Pressable>
        </View>

        <Text style={s.sectionLabel}>Session</Text>
        <View style={s.group}>
          <Pressable style={s.row} onPress={handleLogout}>
            <MaterialIcons name="logout" size={20} color={Colors.orange} />
            <Text style={[s.rowLabel, { color: Colors.orange }]}>Log out</Text>
            <View style={{ width: 20 }} />
          </Pressable>
        </View>
      </ScrollView>
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
  scroll: { padding: 20, gap: 8 },
  profileCard: {
    alignItems: "center",
    paddingVertical: 24,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.textPrimary,
    marginBottom: 16,
    gap: 8,
  },
  avatarLg: {
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: Colors.lavender,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  avatarLgText: {
    color: Colors.purple,
    fontSize: 30,
    fontWeight: "700",
    fontFamily: Fonts.display,
  },
  name: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.textPrimary,
    fontFamily: Fonts.display,
  },
  email: { fontSize: 13, color: Colors.muted },
  badgeRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: Colors.lime,
  },
  badgeAlt: { backgroundColor: Colors.surface2 },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.purple,
    fontFamily: Fonts.mono,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  sectionLabel: {
    fontSize: 10.5,
    fontFamily: Fonts.mono,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: Colors.muted,
    marginTop: 16,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  group: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.divider,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
});
