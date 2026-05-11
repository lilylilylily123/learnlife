import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import {
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
import { requestPasswordReset } from "@/lib/pocketbase";
import { Colors, Fonts } from "@/constants/theme";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const canSubmit = useMemo(
    () => EMAIL_RE.test(email.trim()) && !submitting,
    [email, submitting],
  );

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    // Always show the same neutral confirmation regardless of whether the
    // address exists, so the response can't be used for account enumeration.
    const minDelay = new Promise((resolve) => setTimeout(resolve, 600));
    try {
      await Promise.allSettled([requestPasswordReset(email.trim()), minDelay]);
    } finally {
      setSent(true);
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable style={s.backBtn} onPress={() => router.back()}>
            <MaterialIcons
              name="arrow-back"
              size={20}
              color={Colors.textPrimary}
            />
          </Pressable>

          <View style={{ gap: 10, marginTop: 28 }}>
            <Text style={s.kicker}>Reset your password</Text>
            <Text style={s.h1}>
              {sent ? "Check your\ninbox" : "Forgot your\npassword?"}
            </Text>
            <Text style={s.lead}>
              {sent
                ? `If an account exists for ${email.trim()}, we've sent a link to reset your password.`
                : "Enter the email tied to your account and we'll send a reset link."}
            </Text>
          </View>

          {!sent && (
            <View style={{ gap: 18, marginTop: 30 }}>
              <View style={s.field}>
                <Text style={s.fieldLabel}>Email</Text>
                <View style={s.fieldRow}>
                  <TextInput
                    autoCapitalize="none"
                    autoComplete="email"
                    autoFocus
                    keyboardType="email-address"
                    onChangeText={setEmail}
                    placeholder="you@learnlife.com"
                    placeholderTextColor={Colors.muted}
                    style={s.fieldInput}
                    value={email}
                  />
                </View>
              </View>
            </View>
          )}

          <View style={{ flex: 1 }} />

          {sent ? (
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [s.cta, pressed && { opacity: 0.9 }]}
            >
              <Text style={s.ctaLabel}>Back to sign in</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit}
              style={({ pressed }) => [
                s.cta,
                pressed && canSubmit && { opacity: 0.9 },
                !canSubmit && { opacity: 0.55 },
              ]}
            >
              <Text style={s.ctaLabel}>
                {submitting ? "Sending…" : "Send reset link →"}
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.textPrimary,
    alignItems: "center",
    justifyContent: "center",
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
  lead: {
    color: Colors.textSecondary,
    fontSize: 14.5,
    lineHeight: 20,
  },
  field: { gap: 4 },
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
  cta: {
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
});
