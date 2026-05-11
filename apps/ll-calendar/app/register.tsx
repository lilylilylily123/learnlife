import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useState, useMemo } from "react";
import {
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
import { lookupInvite, redeemInvite } from "../lib/pocketbase";
import { mapInviteError, mapPbError } from "../lib/errors";

type Step = "code" | "password";

export default function RegisterScreen() {
  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState("");
  const [learnerName, setLearnerName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const canVerifyCode = useMemo(
    () => code.trim().length === 6 && !isLoading,
    [code, isLoading],
  );

  const canRegister = useMemo(
    () =>
      password.length >= 8 &&
      password === passwordConfirm &&
      !isLoading,
    [password, passwordConfirm, isLoading],
  );

  async function handleVerifyCode() {
    setIsLoading(true);
    try {
      const invite = await lookupInvite(code.trim());
      if (!invite) {
        Alert.alert("Invalid Code", "This invite code is invalid or has expired. Please check with your facilitator.");
        return;
      }
      setLearnerName(invite.expand?.learner?.name ?? invite.email);
      setStep("password");
    } catch (error: unknown) {
      Alert.alert("Invalid Code", mapInviteError(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRegister() {
    setIsLoading(true);
    try {
      const result = await redeemInvite(code.trim(), password);
      if (!result.success) {
        // redeemInvite returns its own copy; if it slipped a raw PB payload
        // through we'd rather show a neutral fallback than echo it.
        const safe = result.error && result.error.length < 120 ? result.error : "We couldn't create your account. Please try again.";
        Alert.alert("Registration Failed", safe);
        return;
      }
      // Auth state change is picked up by AuthContext automatically
      router.replace("/(tabs)/");
    } catch (error: unknown) {
      Alert.alert("Error", mapPbError(error, "We couldn't create your account. Please try again."));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back button */}
          <Pressable style={s.backBtn} onPress={() => router.back()}>
            <MaterialIcons name="arrow-back" size={24} color="#1F1B16" />
          </Pressable>

          <View style={s.hero}>
            <View style={s.heroIcon}>
              <MaterialIcons name="mail" size={42} color="#1F1B16" />
            </View>
            <Text style={s.heroTitle}>
              {step === "code" ? "Enter Invite Code" : `Welcome, ${learnerName}!`}
            </Text>
            <Text style={s.heroSubtitle}>
              {step === "code"
                ? "Your facilitator should have given you a 6-character code."
                : "Set a password to finish creating your account."}
            </Text>
          </View>

          <View style={s.card}>
            {step === "code" ? (
              <>
                <View style={s.fieldGroup}>
                  <Text style={s.label}>Invite Code</Text>
                  <View style={s.inputWrap}>
                    <MaterialIcons name="vpn-key" size={20} color="#807663" />
                    <TextInput
                      autoCapitalize="characters"
                      autoCorrect={false}
                      maxLength={6}
                      onChangeText={(t) => setCode(t.toUpperCase())}
                      placeholder="ABC123"
                      placeholderTextColor="#807663"
                      style={[s.input, s.codeInput]}
                      value={code}
                    />
                  </View>
                </View>

                <Pressable
                  onPress={handleVerifyCode}
                  disabled={!canVerifyCode}
                  style={({ pressed }) => [
                    s.btn,
                    pressed && canVerifyCode && s.btnPressed,
                    !canVerifyCode && s.btnDisabled,
                  ]}
                >
                  <View style={s.btnShadow} />
                  <View style={s.btnFace}>
                    <MaterialIcons name="search" size={20} color="#1F1B16" />
                    <Text style={s.btnLabel}>
                      {isLoading ? "CHECKING..." : "VERIFY CODE"}
                    </Text>
                  </View>
                </Pressable>
              </>
            ) : (
              <>
                <View style={s.fieldGroup}>
                  <Text style={s.label}>Password</Text>
                  <View style={s.inputWrap}>
                    <MaterialIcons name="lock" size={20} color="#807663" />
                    <TextInput
                      autoComplete="new-password"
                      onChangeText={setPassword}
                      placeholder="At least 8 characters"
                      placeholderTextColor="#807663"
                      secureTextEntry={!showPassword}
                      style={s.input}
                      value={password}
                    />
                    <Pressable onPress={() => setShowPassword((p) => !p)}>
                      <MaterialIcons
                        name={showPassword ? "visibility-off" : "visibility"}
                        size={20}
                        color="#807663"
                      />
                    </Pressable>
                  </View>
                </View>

                <View style={s.fieldGroup}>
                  <Text style={s.label}>Confirm Password</Text>
                  <View style={s.inputWrap}>
                    <MaterialIcons name="lock-outline" size={20} color="#807663" />
                    <TextInput
                      autoComplete="new-password"
                      onChangeText={setPasswordConfirm}
                      placeholder="Re-enter password"
                      placeholderTextColor="#807663"
                      secureTextEntry={!showPassword}
                      style={s.input}
                      value={passwordConfirm}
                    />
                  </View>
                  {passwordConfirm.length > 0 && password !== passwordConfirm && (
                    <Text style={s.errorHint}>Passwords don&apos;t match</Text>
                  )}
                </View>

                <Pressable
                  onPress={handleRegister}
                  disabled={!canRegister}
                  style={({ pressed }) => [
                    s.btn,
                    pressed && canRegister && s.btnPressed,
                    !canRegister && s.btnDisabled,
                  ]}
                >
                  <View style={s.btnShadow} />
                  <View style={s.btnFace}>
                    <MaterialIcons name="how-to-reg" size={20} color="#1F1B16" />
                    <Text style={s.btnLabel}>
                      {isLoading ? "CREATING ACCOUNT..." : "CREATE ACCOUNT"}
                    </Text>
                  </View>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F3EEE5" },
  flex: { flex: 1 },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 30,
    gap: 18,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#1F1B16",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  hero: { alignItems: "center", gap: 6 },
  heroIcon: {
    alignItems: "center",
    backgroundColor: "#4F6B4A",
    borderRadius: 999,
    height: 84,
    justifyContent: "center",
    marginBottom: 6,
    width: 84,
  },
  heroTitle: { color: "#1F1B16", fontSize: 30, fontWeight: "800", textAlign: "center" },
  heroSubtitle: {
    color: "#3A342A",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderLeftColor: "#4F6B4A",
    borderLeftWidth: 4,
    borderRadius: 24,
    elevation: 3,
    gap: 16,
    padding: 20,
    shadowColor: "#1F1B16",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
  },
  fieldGroup: { gap: 8 },
  label: { color: "#1F1B16", fontSize: 14, fontWeight: "700", paddingLeft: 2 },
  inputWrap: {
    alignItems: "center",
    backgroundColor: "#EAE3D3",
    borderRadius: 16,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.select({ ios: 14, default: 10 }),
  },
  input: { color: "#1F1B16", flex: 1, fontSize: 16 },
  codeInput: { letterSpacing: 6, fontWeight: "700", fontSize: 20, textAlign: "center" },
  errorHint: { color: "#C26B3C", fontSize: 13, fontWeight: "600", paddingLeft: 2 },
  btn: { marginTop: 2, minHeight: 58, position: "relative" as const },
  btnPressed: { transform: [{ translateY: 3 }] },
  btnShadow: {
    backgroundColor: "#A8BE6E",
    borderRadius: 999,
    bottom: 0,
    left: 0,
    position: "absolute" as const,
    right: 0,
    top: 6,
  },
  btnFace: {
    alignItems: "center",
    backgroundColor: "#C4D98B",
    borderRadius: 999,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 16,
  },
  btnDisabled: { opacity: 0.55 },
  btnLabel: { color: "#1F1B16", fontSize: 18, fontWeight: "800", letterSpacing: 0.5 },
});
