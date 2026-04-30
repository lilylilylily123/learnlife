import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { BottomNav } from "@/components/bottom-nav";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  login,
  fetchCalendarEvents,
} from "../../lib/pocketbase";
import { mapLoginError } from "../../lib/errors";
import { expandEvents, type CalEvent } from "../../lib/calendar-utils";
import { useAuth } from "../../context/AuthContext";
import { Colors, Fonts } from "@/constants/theme";

const DAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

export default function HomeScreen() {
  const { isAuthenticated } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const canSignIn = useMemo(
    () => email.trim().length > 0 && password.trim().length > 0 && !isLoading,
    [email, password, isLoading],
  );

  const handleLogin = async () => {
    setIsLoading(true);
    try {
      await login(email, password);
    } catch (err: unknown) {
      Alert.alert("Login Failed", mapLoginError(err));
    } finally {
      setIsLoading(false);
    }
  };

  if (isAuthenticated) {
    return <DashboardMainScreen />;
  }

  return (
    <SafeAreaView style={s.safeArea}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={s.loginScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand lozenge */}
          <View style={s.brandRow}>
            <View style={s.brandMark}>
              <Text style={s.brandMarkText}>L</Text>
            </View>
            <Text style={s.brandWordmark}>LearnLife</Text>
          </View>

          {/* Headline */}
          <View style={{ gap: 10, marginTop: 30 }}>
            <Text style={s.kicker}>Welcome back</Text>
            <Text style={s.h1}>
              Ready to{"\n"}learn today?
            </Text>
            <Text style={s.leadBody}>
              Sign in with the credentials from your learning guide.
            </Text>
          </View>

          {/* Inputs — underline style */}
          <View style={{ gap: 18, marginTop: 34 }}>
            <View style={s.field}>
              <Text style={s.fieldLabel}>Email</Text>
              <View style={s.fieldRow}>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  onChangeText={setEmail}
                  placeholder="you@learnlife.com"
                  placeholderTextColor={Colors.muted}
                  style={s.fieldInput}
                  value={email}
                />
              </View>
            </View>

            <View style={s.field}>
              <Text style={s.fieldLabel}>Password</Text>
              <View style={s.fieldRow}>
                <TextInput
                  autoComplete="password"
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={Colors.muted}
                  secureTextEntry={!showPassword}
                  style={s.fieldInput}
                  value={password}
                />
                <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10}>
                  <MaterialIcons
                    name={showPassword ? "visibility-off" : "visibility"}
                    size={18}
                    color={Colors.muted}
                  />
                </Pressable>
              </View>
            </View>

            <Pressable
              onPress={() => router.push("/forgot-password")}
              style={{ alignSelf: "flex-end" }}
              hitSlop={6}
            >
              <Text style={s.forgotLink}>Forgot password?</Text>
            </Pressable>
          </View>

          <View style={{ flex: 1 }} />

          {/* Sign-in CTA */}
          <Pressable
            onPress={handleLogin}
            disabled={!canSignIn}
            style={({ pressed }) => [
              s.ctaFace,
              pressed && canSignIn && { opacity: 0.9 },
              !canSignIn && { opacity: 0.55 },
            ]}
          >
            <Text style={s.ctaLabel}>
              {isLoading ? "Signing in…" : "Sign in →"}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/register")}
            style={{ alignSelf: "center", marginTop: 16 }}
          >
            <Text style={s.inviteText}>
              Have an invite code?{" "}
              <Text style={s.inviteTextLink}>Register</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DashboardMainScreen() {
  const { user, role, program } = useAuth();
  const [todayEvents, setTodayEvents] = useState<CalEvent[]>([]);
  const [hasLoadedEvents, setHasLoadedEvents] = useState(false);

  const today = new Date();
  const dayName = DAY_LABELS[today.getDay()] ?? "";
  const dateShort = today.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const displayName = user?.name || user?.username || "friend";
  const initial = displayName.charAt(0).toUpperCase();

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      let cancelled = false;
      const now = new Date();
      (async () => {
        try {
          const records = await fetchCalendarEvents();
          const expanded = expandEvents(records, now.getFullYear(), now.getMonth());
          const key = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
          if (!cancelled) setTodayEvents(expanded[key] ?? []);
        } catch {
          if (!cancelled) setTodayEvents([]);
        } finally {
          if (!cancelled) setHasLoadedEvents(true);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [user?.id, program]),
  );

  const isGuide = role === "admin" || role === "lg";
  const urgentItems: {
    id: string;
    title: string;
    sub: string;
    accent: string;
    onPress?: () => void;
  }[] = isGuide
    ? [
        {
          id: "invites",
          title: "Manage invites",
          sub: "Create & track learner invites",
          accent: Colors.lavender,
          onPress: () => router.push("/(modals)/manage-invites"),
        },
      ]
    : [];

  return (
    <SafeAreaView style={s.dashSafe}>
      <ScrollView
        contentContainerStyle={s.dashScroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Greeting row */}
        <View style={s.dashHeader}>
          <View style={{ flex: 1 }}>
            <Text style={s.kicker}>
              {dayName} · {dateShort}
            </Text>
            <Text style={s.h2}>Morning, {displayName}</Text>
          </View>
          <Pressable onPress={() => router.push("/settings")} hitSlop={8}>
            <View style={s.avatarCircle}>
              <Text style={s.avatarInitial}>{initial}</Text>
            </View>
          </Pressable>
        </View>

        {/* "Needs you" card */}
        <View style={s.needsCard}>
          <View style={s.needsCardHead}>
            <Text style={s.kicker}>Needs you</Text>
            <Text style={s.needsCount}>{urgentItems.length} item
              {urgentItems.length === 1 ? "" : "s"}
            </Text>
          </View>
          <View style={{ gap: 10, marginTop: 10 }}>
            {urgentItems.length === 0 ? (
              <Text style={s.mutedBody}>
                You&apos;re all caught up ✓
              </Text>
            ) : (
              urgentItems.map((item, idx) => (
                <View key={item.id}>
                  <Pressable
                    onPress={item.onPress}
                    style={s.needsItemRow}
                  >
                    <View
                      style={[s.needsBar, { backgroundColor: item.accent }]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={s.needsItemTitle}>{item.title}</Text>
                      <Text style={s.needsItemSub}>{item.sub}</Text>
                    </View>
                    <Text style={s.needsChevron}>→</Text>
                  </Pressable>
                  {idx < urgentItems.length - 1 && <View style={s.divider} />}
                </View>
              ))
            )}
          </View>
        </View>

        {/* Today timeline */}
        <View style={{ marginTop: 24 }}>
          <View style={s.sectionHeadRow}>
            <Text style={s.h3}>Today</Text>
            <Text style={s.mutedCaption}>
              {todayEvents.length} event{todayEvents.length === 1 ? "" : "s"}
            </Text>
          </View>

          {!hasLoadedEvents && todayEvents.length === 0 ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <ActivityIndicator size="small" color={Colors.lavender} />
            </View>
          ) : todayEvents.length === 0 ? (
            <View style={s.timelineEmpty}>
              <Text style={s.timelineEmptyText}>
                No events today — enjoy the free time.
              </Text>
            </View>
          ) : (
            <View style={{ marginTop: 4 }}>
              {todayEvents.map((ev, i) => (
                <View
                  key={ev.id}
                  style={[
                    s.timelineRow,
                    i < todayEvents.length - 1 && s.timelineRowBorder,
                  ]}
                >
                  <Text style={s.timelineTime} numberOfLines={1}>
                    {ev.time.split(" – ")[0]}
                  </Text>
                  <View
                    style={[
                      s.timelineDot,
                      i === 0
                        ? { backgroundColor: Colors.lavender, borderColor: Colors.lavender }
                        : { backgroundColor: "transparent", borderColor: Colors.purple },
                    ]}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={s.timelineTitle}>{ev.title}</Text>
                    <Text style={s.timelineSub}>{ev.time}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

      </ScrollView>

      <BottomNav active="home" />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  // ─── Shared tokens ──
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  kicker: {
    color: Colors.muted,
    fontSize: 10.5,
    fontWeight: "700",
    fontFamily: Fonts.mono,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  h1: {
    color: Colors.textPrimary,
    fontSize: 38,
    fontFamily: Fonts.display,
    fontWeight: "700",
    letterSpacing: -0.8,
    lineHeight: 42,
  },
  h2: {
    color: Colors.textPrimary,
    fontSize: 30,
    fontFamily: Fonts.display,
    fontWeight: "700",
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  h3: {
    color: Colors.textPrimary,
    fontSize: 20,
    fontFamily: Fonts.display,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  leadBody: {
    color: Colors.textSecondary,
    fontSize: 14.5,
    lineHeight: 20,
  },
  mutedBody: {
    color: Colors.muted,
    fontSize: 13.5,
  },
  mutedCaption: {
    color: Colors.muted,
    fontSize: 12,
    fontWeight: "600",
    fontFamily: Fonts.mono,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.divider,
  },
  link: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: "700",
    textDecorationLine: "underline",
  },

  // ─── Login ──
  loginScroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandMark: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: Colors.lavender,
    alignItems: "center",
    justifyContent: "center",
  },
  brandMarkText: {
    fontSize: 17,
    fontWeight: "700",
    color: Colors.purple,
    fontFamily: Fonts.display,
  },
  brandWordmark: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.textPrimary,
    fontFamily: Fonts.display,
    letterSpacing: -0.3,
  },
  field: {
    gap: 4,
  },
  fieldLabel: {
    color: Colors.muted,
    fontSize: 10,
    fontFamily: Fonts.mono,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.textPrimary,
    paddingBottom: 8,
  },
  fieldInput: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: 16,
    paddingVertical: Platform.select({ ios: 6, default: 2 }),
  },
  ctaFace: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.purple,
    borderRadius: 999,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginTop: 14,
  },
  ctaLabel: {
    color: Colors.background,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: Fonts.display,
    letterSpacing: 0.3,
  },
  inviteText: {
    color: Colors.muted,
    fontSize: 13,
  },
  forgotLink: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  inviteTextLink: {
    color: Colors.textPrimary,
    fontWeight: "700",
    textDecorationLine: "underline",
  },

  // ─── Dashboard ──
  dashSafe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  dashScroll: {
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 120,
  },
  dashHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
    gap: 12,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.lavender,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    color: Colors.purple,
    fontSize: 18,
    fontWeight: "700",
    fontFamily: Fonts.display,
  },
  needsCard: {
    borderWidth: 1.5,
    borderColor: Colors.textPrimary,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
  },
  needsCardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  needsCount: {
    color: Colors.orange,
    fontSize: 10.5,
    fontFamily: Fonts.mono,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  needsItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 6,
  },
  needsBar: {
    width: 6,
    height: 32,
    borderRadius: 3,
  },
  needsItemTitle: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  needsItemSub: {
    color: Colors.muted,
    fontSize: 12,
    marginTop: 1,
  },
  needsChevron: {
    color: Colors.muted,
    fontSize: 18,
  },
  sectionHeadRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  timelineEmpty: {
    alignItems: "center",
    paddingVertical: 24,
  },
  timelineEmptyText: {
    color: Colors.muted,
    fontSize: 14,
  },
  timelineRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  timelineRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  timelineTime: {
    width: 68,
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: Fonts.mono,
    fontWeight: "700",
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
  },
  timelineTitle: {
    color: Colors.textPrimary,
    fontSize: 14.5,
    fontWeight: "700",
  },
  timelineSub: {
    color: Colors.muted,
    fontSize: 12,
    marginTop: 1,
  },
  featuredCard: {
    marginTop: 6,
    borderWidth: 1.5,
    borderColor: Colors.textPrimary,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: Colors.surface,
  },
  featuredHero: {
    height: 140,
    backgroundColor: Colors.surface2,
  },
  featuredImage: {
    height: "100%",
    width: "100%",
  },
  featuredFooter: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  featuredTitle: {
    color: Colors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
    fontFamily: Fonts.display,
  },
  featuredSub: {
    color: Colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  limePill: {
    backgroundColor: Colors.lime,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  limePillText: {
    color: Colors.purple,
    fontSize: 10.5,
    fontWeight: "800",
    fontFamily: Fonts.mono,
    letterSpacing: 0.7,
  },
});
