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
import { changePassword } from "@/lib/pocketbase";
import { Colors, Fonts } from "@/constants/theme";

// Matches the password rule PocketBase enforces on the `users` collection
// by default (min 8 chars). Keep in sync if the server-side rule changes.
const MIN_PASSWORD_LENGTH = 8;

export default function ChangePasswordScreen() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const validation = useMemo<{ ok: true } | { ok: false; reason: string }>(() => {
    if (!oldPassword) return { ok: false, reason: "Enter your current password." };
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return { ok: false, reason: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
    }
    if (newPassword === oldPassword) {
      return { ok: false, reason: "New password must be different from the current one." };
    }
    if (newPassword !== confirm) return { ok: false, reason: "Passwords don't match." };
    return { ok: true };
  }, [oldPassword, newPassword, confirm]);

  // Only surface inline-validation messages once the user has typed in the
  // confirm field — otherwise the form starts red, which is hostile.
  const showInlineError = !done && !submitting && confirm.length > 0 && !validation.ok;
  const canSubmit = validation.ok && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await changePassword(oldPassword, newPassword);
      setDone(true);
    } catch (e) {
      const err = e as { status?: number; data?: { data?: Record<string, { message?: string }> }; message?: string };
      // PB returns 400 with field-level errors; surface the most specific one.
      const fieldErrors = err?.data?.data;
      const fieldMsg =
        fieldErrors?.oldPassword?.message ||
        fieldErrors?.password?.message ||
        fieldErrors?.passwordConfirm?.message;
      setError(fieldMsg || err?.message || "Could not change password. Please try again.");
    } finally {
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
            <MaterialIcons name="arrow-back" size={20} color={Colors.textPrimary} />
          </Pressable>

          <View style={{ gap: 10, marginTop: 28 }}>
            <Text style={s.kicker}>Account</Text>
            <Text style={s.h1}>
              {done ? "Password\nupdated" : "Change your\npassword"}
            </Text>
            <Text style={s.lead}>
              {done
                ? "You'll stay signed in on this device. Other sessions have been signed out."
                : "Enter your current password, then choose a new one."}
            </Text>
          </View>

          {!done && (
            <View style={{ gap: 18, marginTop: 30 }}>
              <PasswordField
                label="Current password"
                value={oldPassword}
                onChangeText={setOldPassword}
                visible={showOld}
                onToggle={() => setShowOld((v) => !v)}
                autoFocus
              />
              <PasswordField
                label="New password"
                value={newPassword}
                onChangeText={setNewPassword}
                visible={showNew}
                onToggle={() => setShowNew((v) => !v)}
                helper={`At least ${MIN_PASSWORD_LENGTH} characters.`}
              />
              <PasswordField
                label="Confirm new password"
                value={confirm}
                onChangeText={setConfirm}
                visible={showNew}
                onToggle={() => setShowNew((v) => !v)}
              />

              {showInlineError && !validation.ok && (
                <Text style={s.inlineError}>{validation.reason}</Text>
              )}
              {error && <Text style={s.inlineError}>{error}</Text>}
            </View>
          )}

          <View style={{ flex: 1 }} />

          {done ? (
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [s.cta, pressed && { opacity: 0.9 }]}
            >
              <Text style={s.ctaLabel}>Back to settings</Text>
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
                {submitting ? "Saving…" : "Update password →"}
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface PasswordFieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  visible: boolean;
  onToggle: () => void;
  helper?: string;
  autoFocus?: boolean;
}

function PasswordField({
  label,
  value,
  onChangeText,
  visible,
  onToggle,
  helper,
  autoFocus,
}: PasswordFieldProps) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={s.fieldRow}>
        <TextInput
          autoCapitalize="none"
          autoComplete="password"
          autoFocus={autoFocus}
          onChangeText={onChangeText}
          placeholder="••••••••"
          placeholderTextColor={Colors.muted}
          secureTextEntry={!visible}
          style={s.fieldInput}
          value={value}
        />
        <Pressable onPress={onToggle} hitSlop={8}>
          <MaterialIcons
            name={visible ? "visibility-off" : "visibility"}
            size={20}
            color={Colors.muted}
          />
        </Pressable>
      </View>
      {helper && <Text style={s.helper}>{helper}</Text>}
    </View>
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
  helper: {
    color: Colors.muted,
    fontSize: 11.5,
    marginTop: 4,
  },
  inlineError: {
    color: Colors.orange,
    fontSize: 13,
    marginTop: 4,
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
