import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { deleteCalendarEntry } from "@/lib/pocketbase";
import { Colors, Fonts } from "@/constants/theme";

export default function EventDetailModal() {
  const params = useLocalSearchParams<{
    title: string;
    time: string;
    emoji: string;
    color: string;
    recordId: string;
  }>();

  const [deleting, setDeleting] = useState(false);

  const title = params.title ?? "Event";
  const time = params.time ?? "";
  const emoji = params.emoji || "📅";
  const color = params.color || "#4F6B4A";
  const recordId = params.recordId ?? "";

  function handleDelete() {
    if (!recordId) return;
    Alert.alert("Delete event", `Remove "${title}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteCalendarEntry(recordId);
            router.back();
          } catch (err: any) {
            Alert.alert("Failed to delete", err?.message ?? "Please try again.");
            setDeleting(false);
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={[s.hero, { backgroundColor: color }]}>
        <Pressable style={s.closeBtn} onPress={() => router.back()}>
          <MaterialIcons name="close" size={20} color={Colors.textPrimary} />
        </Pressable>
      </View>

      <View style={s.body}>
        <View style={s.pillRow}>
          <View style={s.limePill}>
            <Text style={s.limePillText}>EVENT</Text>
          </View>
          <View style={s.outlinePill}>
            <Text style={s.outlinePillText}>DETAILS</Text>
          </View>
        </View>

        <Text style={s.title}>{emoji} {title}</Text>

        <Text style={s.timeText}>{time}</Text>

        <View style={s.divider} />

        <View style={s.infoRow}>
          <MaterialIcons name="schedule" size={18} color={Colors.muted} />
          <Text style={s.infoText}>{time || "No time set"}</Text>
        </View>
      </View>

      <View style={s.actions}>
        <Pressable
          style={[s.deleteBtn, deleting && s.deleteBtnDisabled]}
          onPress={handleDelete}
          disabled={deleting || !recordId}
        >
          <MaterialIcons name="delete-outline" size={20} color="#FFFFFF" />
          <Text style={s.deleteBtnText}>
            {deleting ? "Deleting..." : "Delete Event"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  hero: {
    height: 180,
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.textPrimary,
    padding: 14,
    alignItems: "flex-start",
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.textPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    paddingHorizontal: 24,
    paddingTop: 20,
    gap: 10,
  },
  pillRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 2,
  },
  limePill: {
    backgroundColor: Colors.lime,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  limePillText: {
    color: Colors.textPrimary,
    fontSize: 10,
    fontWeight: "800",
    fontFamily: Fonts.mono,
    letterSpacing: 0.8,
  },
  outlinePill: {
    borderWidth: 1.5,
    borderColor: Colors.textPrimary,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  outlinePillText: {
    color: Colors.textPrimary,
    fontSize: 10,
    fontWeight: "800",
    fontFamily: Fonts.mono,
    letterSpacing: 0.8,
  },
  title: {
    fontSize: 30,
    fontFamily: Fonts.display,
    fontWeight: "700",
    color: Colors.textPrimary,
    letterSpacing: -0.5,
    lineHeight: 34,
    marginTop: 4,
  },
  timeText: {
    fontSize: 12,
    color: Colors.muted,
    fontFamily: Fonts.mono,
    fontWeight: "600",
  },
  divider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginVertical: 14,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  infoText: {
    fontSize: 14.5,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  actions: {
    paddingHorizontal: 24,
    paddingTop: "auto" as any,
    paddingBottom: 24,
    marginTop: "auto" as any,
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.orange,
    borderRadius: 999,
    paddingVertical: 14,
  },
  deleteBtnDisabled: { opacity: 0.5 },
  deleteBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
    fontFamily: Fonts.display,
  },
});
