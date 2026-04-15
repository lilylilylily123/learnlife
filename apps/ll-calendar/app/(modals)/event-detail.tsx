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
  const color = params.color || "#B892FF";
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
      <View style={s.header}>
        <Pressable style={s.closeBtn} onPress={() => router.back()}>
          <MaterialIcons name="close" size={22} color="#2D1B4E" />
        </Pressable>
        <Text style={s.headerTitle}>Event Details</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={s.body}>
        <View style={[s.emojiCircle, { backgroundColor: color + "22" }]}>
          <Text style={s.emoji}>{emoji}</Text>
        </View>

        <Text style={s.title}>{title}</Text>

        <View style={s.infoRow}>
          <MaterialIcons name="schedule" size={20} color="#8A7E9E" />
          <Text style={s.infoText}>{time}</Text>
        </View>

        <View style={[s.colorStrip, { backgroundColor: color }]} />
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
  safe: { flex: 1, backgroundColor: "#F9FAFC" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(138,126,158,0.1)",
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: "#F3F5F0",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#2D1B4E",
  },
  body: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 40,
    gap: 16,
  },
  emojiCircle: {
    width: 80,
    height: 80,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: { fontSize: 36 },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#2D1B4E",
    textAlign: "center",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  infoText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2D1B4E",
  },
  colorStrip: {
    height: 6,
    width: 64,
    borderRadius: 999,
    marginTop: 8,
  },
  actions: {
    paddingHorizontal: 24,
    paddingTop: 40,
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FF6B35",
    borderRadius: 999,
    paddingVertical: 14,
  },
  deleteBtnDisabled: { opacity: 0.5 },
  deleteBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
