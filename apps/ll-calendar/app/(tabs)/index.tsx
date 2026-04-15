import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { BottomNav } from "@/components/bottom-nav";
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
import { login, logout as doLogout, fetchCalendarEvents } from "../../lib/pocketbase";
import { expandEvents, type CalEvent } from "../../lib/calendar-utils";
import { useAuth } from "../../context/AuthContext";

const dashboardImages = {
  profile:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuDmSN2UT-Rav0ZkqgQ-Y7nWNF-lsQgqv3Z5nKapaqcy3wqzb7UYN3-79kjZZOr0Sp69IWGMGZywdpoG7ozk3xKq8ad2y_3Z4sppk7d5NTMrjc6FxdaBcpcGc7KdU8eO3e3nOBtW-oRIWGuf453gf9gZuAl-WNucpKw6w2Oxj8qRp9IYoUhaBXdN0mZmaTYuVigZ4uATXzBZhrcRYvQbABPvod9CgKKpyigwuubrwGlQiYo3X5WrKpR85YlEaxqPTjUZPQqFabVN3-yl",
  sarah:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuCbwEyw3h0PbDNzy92pyjYfy3-ALks1u9lg07H2ut5xONCcmidcrnhXOJayodJ0YAjCwDiwSwbRuENjdgoc5p4-N840UR07fVH8sUGnuh0T-n6iPaEv9Ht9pudTCFLGqftgHWr0Fz9yqAHRRGkGkY3whLs9khPDYdao2xpo1Zl2D6hNXiip8qWmDqigf3LnhmLIdq1pJG3hVc7KFuWQpgELmNKscWwFuTzGzxue6Jb8dKnHdl5hnpb2TyayKzdAqinAmRTZx_og_k0_",
  surf:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuA8M9Z6seNBY6LX8OW31bQXz4c5Ftn159R9nQarJqNMhKnhK9AGj1U94UGArB-4ZhoNlEVSo0A3fxlMOBiY3CdfzSMfGaJoJCRgE336GLUOZLHRzt7wW4JxM_q5gHrD3BLp7d9Udvk73SQWoJF960SkBES_MnyF4BhFDlJdN3jh-gLZ_AyFQlVIXPOLRwXcU0fwKZvAyih0jcsskFgndAcL8gdGceVV-LakQnWGJqfTD0lMlcVVkfVsiifHuCa_r6oNXso4haKd2zi-",
  outingA:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuDPL927strO9wM5CXsnopKM-A5FE2pq3kNn5W15aWB8773NgM16lpyfPAQ3cCTdlHevAr8CIO1S5Nn47278TEZ98HkzCwTGTfD8NIzEHt6rm-yBYiP6A33zkm3-CcdasF54lkp6GQhcpmY5-vt0YZiymjXgLlZ3UvfpHiB6xq_XQytQ0legYHouFUbSkazoLgO81DcvE1mr-aaBWjU11xGctHjzv_v0oTkdrsm0m-Inw5s6B8FGOAPObHYVaRXs4t1OANx-GA0LFL-S",
  outingB:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuDMaPuEuNKDtURkrk5pIiUZ6PKXkwbWMkBvhCqQP1qG1NCnSpR50Ah-MKKcP_BWkN8knRIrZ_WgrexlvgmGrEupcrcl1o_Wli52QbzdKB9VHBOS9X4PLhV_6NYzzErU4LWzENWRTS3rgJZXXrFh16jbyGC4SVDMkgzbcdcCzGy137F0zXbLhglI90ubvD7teJj-5wynx9nJ6-bKMDdkIAAN2tG8JVfYnwoXelY0-YW3UkPVZ3MR3uFCyxKgWa8JBW4xdA_FaJjYIJUj",
};

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
      Alert.alert("Success", "You have logged in successfully!");
    } catch (error: any) {
      Alert.alert(
        "Login Failed",
        error.message || "Invalid credentials. Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (isAuthenticated) {
    return <DashboardMainScreen />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardArea}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <MaterialIcons name="school" size={26} color="#8AC300" />
            <Text style={styles.appName}>Luminous Scholar</Text>
          </View>

          <View style={styles.hero}>
            <View style={styles.heroIconContainer}>
              <MaterialIcons name="rocket-launch" size={42} color="#2D1B4E" />
            </View>
            <Text style={styles.heroTitle}>Welcome Back!</Text>
            <Text style={styles.heroSubtitle}>
              Ready for today&apos;s learning adventure?
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email Address</Text>
              <View style={styles.inputWrap}>
                <MaterialIcons name="mail" size={20} color="#8A7E9E" />
                <TextInput
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  onChangeText={setEmail}
                  placeholder="yourname@learnlife.com"
                  placeholderTextColor="#8A7E9E"
                  style={styles.input}
                  value={email}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputWrap}>
                <MaterialIcons name="lock" size={20} color="#8A7E9E" />
                <TextInput
                  autoComplete="password"
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor="#8A7E9E"
                  secureTextEntry={!showPassword}
                  style={styles.input}
                  value={password}
                />
                <Pressable onPress={() => setShowPassword((prev) => !prev)}>
                  <MaterialIcons
                    name={showPassword ? "visibility-off" : "visibility"}
                    size={20}
                    color="#8A7E9E"
                  />
                </Pressable>
              </View>
            </View>

            <Pressable style={styles.forgotButton}>
              <Text style={styles.forgotText}>Forgot Password?</Text>
            </Pressable>

            <Pressable
              onPress={handleLogin}
              disabled={!canSignIn}
              style={({ pressed }) => [
                styles.signInPressable,
                pressed && canSignIn && styles.signInPressed,
                !canSignIn && styles.signInDisabled,
              ]}
            >
              <View style={styles.signInShadow} />
              <View style={styles.signInFace}>
                <MaterialIcons name="login" size={20} color="#2D1B4E" />
                <Text style={styles.signInLabel}>
                  {isLoading ? "SIGNING IN..." : "SIGN IN"}
                </Text>
              </View>
            </Pressable>
          </View>

          <View style={styles.tipBox}>
            <View style={styles.tipIconCircle}>
              <MaterialIcons
                name="tips-and-updates"
                size={20}
                color="#8D67FF"
              />
            </View>
            <Text style={styles.tipText}>
              Log in with the credentials provided by your facilitator during
              onboarding.
            </Text>
          </View>

          <Text style={styles.footer}>
            © 2024 Luminous Scholar. All rights reserved.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DashboardMainScreen() {
  const { user } = useAuth();
  const [todayEvents, setTodayEvents] = useState<CalEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const today = new Date();
  const todayLabel = today.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const displayName = user?.name || user?.username || "there";

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      let cancelled = false;
      const now = new Date();
      (async () => {
        setLoadingEvents(true);
        try {
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
          const records = await fetchCalendarEvents(user.id, monthStart, monthEnd);
          const expanded = expandEvents(records, now.getFullYear(), now.getMonth());
          const key = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
          if (!cancelled) setTodayEvents(expanded[key] ?? []);
        } catch {
          if (!cancelled) setTodayEvents([]);
        } finally {
          if (!cancelled) setLoadingEvents(false);
        }
      })();
      return () => { cancelled = true; };
    }, [user?.id])
  );

  function handleLogout() {
    Alert.alert("Log out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: () => doLogout() },
    ]);
  }

  const urgentCards = [
    {
      id: "meeting",
      title: "Meeting Request",
      description: "Sarah requested a check-in!",
      cta: "Review",
      icon: "event-available" as const,
      bg: "#FF6B35",
    },
    {
      id: "waiver",
      title: "Waiver Needed",
      description: "Sign for Friday's Surf Trip.",
      cta: "Sign Now",
      icon: "edit-document" as const,
      bg: "#B892FF",
    },
  ];

  return (
    <SafeAreaView style={styles.dashboardSafeArea}>
      <View style={styles.dashboardHeader}>
        <Text style={styles.dashboardGreeting}>Hey {displayName}! 👋</Text>
        <Pressable onPress={handleLogout}>
          <Image source={{ uri: dashboardImages.profile }} style={styles.avatar} contentFit="cover" />
          <View style={styles.avatarDot} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.dashboardScrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Urgent Updates</Text>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={urgentCards}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.urgentList}
            renderItem={({ item }) => (
              <Pressable style={[styles.urgentCard, { backgroundColor: item.bg }]}>
                <View style={styles.urgentIconCircle}>
                  <MaterialIcons name={item.icon} size={24} color="#FFFFFF" />
                </View>
                <View style={styles.urgentCopy}>
                  <Text style={styles.urgentTitle}>{item.title}</Text>
                  <Text style={styles.urgentDescription}>{item.description}</Text>
                  <View style={styles.urgentCtaPill}>
                    <Text style={[styles.urgentCtaText, { color: item.bg }]}>{item.cta}</Text>
                  </View>
                </View>
              </Pressable>
            )}
          />
        </View>

        <View style={styles.section}>
          <View style={styles.timelineHeader}>
            <Text style={styles.sectionTitle}>Today&apos;s Timeline</Text>
            <Text style={styles.sectionDate}>{todayLabel}</Text>
          </View>

          {loadingEvents ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <ActivityIndicator size="small" color="#C4F34A" />
            </View>
          ) : todayEvents.length === 0 ? (
            <View style={styles.timelineEmpty}>
              <Text style={styles.timelineEmptyEmoji}>🌤️</Text>
              <Text style={styles.timelineEmptyText}>No events today — enjoy the free time!</Text>
            </View>
          ) : (
            todayEvents.map((ev, i) => (
              <View key={ev.id} style={styles.timelineItemMuted}>
                <View style={i === 0 ? styles.timelineDotActive : styles.timelineDotFuture}>
                  {i === 0 && <View style={styles.timelineDotCore} />}
                </View>
                <View style={styles.timelineContent}>
                  <Text style={i === 0 ? styles.timelineTimeActive : styles.timelineTimeMuted}>
                    {ev.time.split(" – ")[0]}
                  </Text>
                  <View style={[styles.timelineCard, { borderLeftColor: ev.color }]}>
                    <Text style={styles.timelineEmoji}>{ev.emoji || "📅"}</Text>
                    <View style={styles.timelineTextWrap}>
                      <Text style={styles.timelineTitle}>{ev.title}</Text>
                      <Text style={styles.timelineSubtitle}>{ev.time}</Text>
                    </View>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={[styles.section, { paddingBottom: 120 }]}>
          <View style={styles.timelineHeader}>
            <Text style={styles.sectionTitle}>Featured Outings</Text>
            <Pressable>
              <Text style={styles.seeAll}>See all</Text>
            </Pressable>
          </View>

          <Pressable style={styles.featuredCard}>
            <View style={styles.featuredHero}>
              <Image source={{ uri: dashboardImages.surf }} style={styles.featuredImage} contentFit="cover" />
              <View style={styles.featuredOverlay} />
              <View style={styles.featuredHeadlineRow}>
                <Text style={styles.featuredTitle}>Surf Trip</Text>
                <View style={styles.featuredPill}>
                  <Text style={styles.featuredPillText}>Tomorrow</Text>
                </View>
              </View>
            </View>
            <View style={styles.featuredFooter}>
              <View style={styles.avatarStack}>
                <Image source={{ uri: dashboardImages.outingA }} style={styles.stackAvatar} contentFit="cover" />
                <Image source={{ uri: dashboardImages.outingB }} style={[styles.stackAvatar, styles.stackAvatarOverlap]} contentFit="cover" />
                <View style={styles.stackCount}>
                  <Text style={styles.stackCountText}>+12</Text>
                </View>
              </View>
              <Text style={styles.joinOuting}>Join Outing →</Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>

      <BottomNav active="home" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F9FAFC",
  },
  keyboardArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 30,
    gap: 18,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginBottom: 10,
  },
  appName: {
    color: "#111827",
    fontSize: 26,
    fontWeight: "800",
  },
  hero: {
    alignItems: "center",
    gap: 6,
  },
  heroIconContainer: {
    alignItems: "center",
    backgroundColor: "#D9FB86",
    borderRadius: 999,
    height: 84,
    justifyContent: "center",
    marginBottom: 6,
    width: 84,
  },
  heroTitle: {
    color: "#2D1B4E",
    fontSize: 36,
    fontWeight: "800",
  },
  heroSubtitle: {
    color: "#6B7280",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderLeftColor: "#C4F34A",
    borderLeftWidth: 4,
    borderRadius: 24,
    elevation: 3,
    gap: 16,
    padding: 20,
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    color: "#2D1B4E",
    fontSize: 14,
    fontWeight: "700",
    paddingLeft: 2,
  },
  inputWrap: {
    alignItems: "center",
    backgroundColor: "#F3F5F0",
    borderRadius: 16,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.select({ ios: 14, default: 10 }),
  },
  input: {
    color: "#2D1B4E",
    flex: 1,
    fontSize: 16,
  },
  forgotButton: {
    alignSelf: "center",
  },
  forgotText: {
    color: "#8A7E9E",
    fontSize: 14,
    fontWeight: "700",
  },
  signInPressable: {
    marginTop: 2,
    minHeight: 58,
    position: "relative",
  },
  signInPressed: {
    transform: [{ translateY: 3 }],
  },
  signInShadow: {
    backgroundColor: "#A8D62C",
    borderRadius: 999,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 6,
  },
  signInFace: {
    alignItems: "center",
    backgroundColor: "#C4F34A",
    borderRadius: 999,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 16,
  },
  signInDisabled: {
    opacity: 0.55,
  },
  signInLabel: {
    color: "#2D1B4E",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  tipBox: {
    alignItems: "center",
    backgroundColor: "rgba(232, 235, 221, 0.55)",
    borderColor: "#DDE1CF",
    borderRadius: 16,
    borderStyle: "dashed",
    borderWidth: 2,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  tipIconCircle: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  tipText: {
    color: "#6B7280",
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  footer: {
    color: "#9CA3AF",
    fontSize: 12,
    marginTop: 8,
    textAlign: "center",
  },
  dashboardSafeArea: {
    backgroundColor: "#F9FAFC",
    flex: 1,
  },
  dashboardHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  dashboardGreeting: {
    color: "#2D1B4E",
    fontSize: 32,
    fontWeight: "700",
  },
  avatar: {
    borderColor: "#C4F34A",
    borderRadius: 24,
    borderWidth: 2,
    height: 48,
    width: 48,
  },
  avatarDot: {
    backgroundColor: "#FF6B35",
    borderColor: "#F9FAFC",
    borderRadius: 7,
    borderWidth: 2,
    height: 14,
    position: "absolute",
    right: 0,
    top: 0,
    width: 14,
  },
  dashboardScrollContent: {
    gap: 18,
    paddingBottom: 20,
  },
  section: {
    paddingHorizontal: 24,
  },
  sectionTitle: {
    color: "#2D1B4E",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 12,
  },
  urgentList: {
    gap: 14,
    paddingRight: 8,
  },
  urgentCard: {
    borderRadius: 24,
    flexDirection: "row",
    gap: 12,
    minHeight: 138,
    padding: 16,
    width: 280,
  },
  urgentIconCircle: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 24,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  urgentCopy: {
    flex: 1,
  },
  urgentTitle: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "700",
    marginBottom: 2,
  },
  urgentDescription: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 10,
  },
  urgentCtaPill: {
    alignSelf: "flex-start",
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  urgentCtaText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  timelineHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  sectionDate: {
    color: "#8A7E9E",
    fontSize: 14,
    fontWeight: "700",
  },
  timelineEmpty: {
    alignItems: "center",
    paddingVertical: 28,
    gap: 6,
  },
  timelineEmptyEmoji: {
    fontSize: 32,
  },
  timelineEmptyText: {
    fontSize: 15,
    color: "#8A7E9E",
    fontWeight: "600",
  },
  timelineItemMuted: {
    alignItems: "flex-start",
    flexDirection: "row",
    marginTop: 10,
  },
  timelineItemActive: {
    alignItems: "flex-start",
    flexDirection: "row",
    marginTop: 10,
  },
  timelineDotMuted: {
    alignItems: "center",
    backgroundColor: "rgba(138,126,158,0.25)",
    borderColor: "#F9FAFC",
    borderRadius: 20,
    borderWidth: 4,
    height: 40,
    justifyContent: "center",
    marginRight: 10,
    width: 40,
  },
  timelineDotActive: {
    alignItems: "center",
    backgroundColor: "#C4F34A",
    borderColor: "#F9FAFC",
    borderRadius: 20,
    borderWidth: 4,
    height: 40,
    justifyContent: "center",
    marginRight: 10,
    width: 40,
  },
  timelineDotCore: {
    backgroundColor: "#2D1B4E",
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  timelineDotFuture: {
    backgroundColor: "rgba(138,126,158,0.45)",
    borderColor: "#F9FAFC",
    borderRadius: 20,
    borderWidth: 10,
    height: 40,
    marginRight: 10,
    width: 40,
  },
  timelineContent: {
    flex: 1,
  },
  timelineTimeMuted: {
    color: "#8A7E9E",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },
  timelineTimeActive: {
    color: "#2D1B4E",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 8,
  },
  timelineCard: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderLeftColor: "#B892FF",
    borderLeftWidth: 8,
    borderRadius: 16,
    flexDirection: "row",
    gap: 10,
    minHeight: 80,
    padding: 12,
  },
  timelineCardMuted: {
    borderLeftColor: "rgba(138,126,158,0.4)",
    opacity: 0.65,
  },
  timelineCardActive: {
    borderColor: "#C4F34A",
    borderWidth: 2,
    elevation: 2,
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
  },
  timelineCardGreen: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderLeftColor: "#4ADE80",
    borderLeftWidth: 8,
    borderRadius: 16,
    flexDirection: "row",
    gap: 10,
    minHeight: 80,
    padding: 12,
  },
  timelineEmoji: {
    fontSize: 24,
  },
  timelineTextWrap: {
    flex: 1,
  },
  timelineTitle: {
    color: "#2D1B4E",
    fontSize: 16,
    fontWeight: "700",
  },
  timelineSubtitle: {
    color: "#8A7E9E",
    fontSize: 14,
    fontWeight: "600",
  },
  timelineNow: {
    color: "#8AC300",
    fontSize: 14,
    fontWeight: "700",
  },
  timelineAvatar: {
    borderRadius: 20,
    height: 40,
    width: 40,
  },
  seeAll: {
    color: "#B892FF",
    fontSize: 14,
    fontWeight: "700",
  },
  featuredCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    overflow: "hidden",
  },
  featuredHero: {
    height: 132,
    position: "relative",
  },
  featuredImage: {
    height: "100%",
    width: "100%",
  },
  featuredOverlay: {
    backgroundColor: "rgba(45,27,78,0.45)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  featuredHeadlineRow: {
    alignItems: "center",
    bottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    left: 14,
    position: "absolute",
    right: 14,
  },
  featuredTitle: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "700",
  },
  featuredPill: {
    backgroundColor: "#C4F34A",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  featuredPillText: {
    color: "#2D1B4E",
    fontSize: 11,
    fontWeight: "700",
  },
  featuredFooter: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  avatarStack: {
    alignItems: "center",
    flexDirection: "row",
  },
  stackAvatar: {
    borderColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 2,
    height: 32,
    width: 32,
  },
  stackAvatarOverlap: {
    marginLeft: -8,
  },
  stackCount: {
    alignItems: "center",
    backgroundColor: "rgba(138,126,158,0.2)",
    borderColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 2,
    height: 32,
    justifyContent: "center",
    marginLeft: -8,
    width: 32,
  },
  stackCountText: {
    color: "#8A7E9E",
    fontSize: 10,
    fontWeight: "700",
  },
  joinOuting: {
    color: "#8A7E9E",
    fontSize: 14,
    fontWeight: "700",
  },
});
