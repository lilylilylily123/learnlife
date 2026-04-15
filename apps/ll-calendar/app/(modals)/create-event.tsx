import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
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
import { useAuth } from "@/context/AuthContext";
import { createCalendarEntry } from "@/lib/pocketbase";

const COLORS = [
  "#B892FF",
  "#FF6B35",
  "#C4F34A",
  "#4ADE80",
  "#60A5FA",
  "#F97316",
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const EMOJIS = [
  "📅","📚","🎨","🎸","⚽","🏊","🧘","🍳","🌿","🎭",
  "🖥️","📐","🔬","🎺","🏋️","🎯","✏️","🎤","🌍","🧩",
  "🎻","🏄","🎲","📷","🧪","🎹","🏃","🌱","🎬","🤸",
];

function combineDateTime(date: Date, time: Date): string {
  const combined = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    time.getHours(),
    time.getMinutes(),
    0
  );
  return combined.toISOString();
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type PickerMode = "date" | "time-start" | "time-end" | null;

export default function CreateEventModal() {
  const { role, user } = useAuth();
  const params = useLocalSearchParams<{ date?: string }>();

  const isGuide = role === "lg" || role === "admin";
  const title = isGuide ? "New Event" : "Add Class";

  // Parse initial date from params (format: "YYYY-M-D" from makeDateKey)
  function parseInitialDate(): Date {
    if (params.date) {
      const parts = params.date.split("-");
      if (parts.length === 3) {
        const d = new Date(
          parseInt(parts[0]),
          parseInt(parts[1]) - 1,
          parseInt(parts[2])
        );
        if (!isNaN(d.getTime())) return d;
      }
    }
    return new Date();
  }

  // Shared
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [emoji, setEmoji] = useState(isGuide ? "📅" : "📚");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Date / time state
  const [eventDate, setEventDate] = useState(parseInitialDate);
  const [startTime, setStartTime] = useState(() => {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    return d;
  });
  const [endTime, setEndTime] = useState(() => {
    const d = new Date();
    d.setHours(10, 0, 0, 0);
    return d;
  });

  // Picker visibility (Android needs explicit show/hide)
  const [activePicker, setActivePicker] = useState<PickerMode>(null);

  // Learner
  const [recurrence, setRecurrence] = useState<"none" | "weekly">("weekly");
  const [selectedDays, setSelectedDays] = useState<number[]>([0]);

  function toggleDay(index: number) {
    setSelectedDays((prev) =>
      prev.includes(index) ? prev.filter((d) => d !== index) : [...prev, index]
    );
  }

  function onPickerChange(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === "android") setActivePicker(null);
    if (event.type === "dismissed" || !selected) return;

    if (activePicker === "date") setEventDate(selected);
    else if (activePicker === "time-start") setStartTime(selected);
    else if (activePicker === "time-end") setEndTime(selected);
  }

  async function handleSubmit() {
    if (!name.trim()) {
      Alert.alert("Missing title", "Please enter a title.");
      return;
    }
    if (!user?.id) return;

    if (!isGuide && recurrence === "weekly" && selectedDays.length === 0) {
      Alert.alert("No days selected", "Pick at least one day.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isGuide) {
        await createCalendarEntry({
          title: name.trim(),
          start: combineDateTime(eventDate, startTime),
          end: combineDateTime(eventDate, endTime),
          color,
          emoji,
          type: "event",
          recurrence: "none",
          recurrence_days: [],
          recurrence_end: "",
          created_by: user.id,
        });
      } else {
        const anchorDate = eventDate;
        await createCalendarEntry({
          title: name.trim(),
          start: combineDateTime(anchorDate, startTime),
          end: combineDateTime(anchorDate, endTime),
          color,
          emoji,
          type: "class",
          recurrence,
          recurrence_days: recurrence === "weekly" ? selectedDays : [],
          recurrence_end: "",
          created_by: user.id,
        });
      }
      router.back();
    } catch (err: any) {
      Alert.alert("Failed to save", err?.message ?? "Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const showingDate = activePicker === "date";
  const showingTime = activePicker === "time-start" || activePicker === "time-end";

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <Pressable style={s.closeBtn} onPress={() => router.back()}>
          <MaterialIcons name="close" size={22} color="#2D1B4E" />
        </Pressable>
        <Text style={s.headerTitle}>{title}</Text>
        <Pressable
          style={[s.saveBtn, isSubmitting && s.saveBtnDisabled]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          <Text style={s.saveBtnText}>{isSubmitting ? "Saving…" : "Save"}</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Title */}
          <View style={s.field}>
            <Text style={s.label}>Title</Text>
            <TextInput
              style={s.input}
              placeholder={isGuide ? "e.g. Morning Surf Session" : "e.g. Math Class"}
              placeholderTextColor="#8A7E9E"
              value={name}
              onChangeText={setName}
            />
          </View>

          {/* Emoji picker */}
          <View style={s.field}>
            <Text style={s.label}>Emoji</Text>
            <Pressable
              style={s.emojiBtn}
              onPress={() => setShowEmojiPicker((v) => !v)}
            >
              <Text style={s.emojiDisplay}>{emoji}</Text>
              <MaterialIcons name="expand-more" size={20} color="#8A7E9E" />
            </Pressable>
            {showEmojiPicker && (
              <View style={s.emojiGrid}>
                {EMOJIS.map((e) => (
                  <Pressable
                    key={e}
                    style={[s.emojiCell, emoji === e && s.emojiCellActive]}
                    onPress={() => {
                      setEmoji(e);
                      setShowEmojiPicker(false);
                    }}
                  >
                    <Text style={s.emojiCellText}>{e}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* Color */}
          <View style={s.field}>
            <Text style={s.label}>Color</Text>
            <View style={s.swatchRow}>
              {COLORS.map((c) => (
                <Pressable
                  key={c}
                  style={[
                    s.swatch,
                    { backgroundColor: c },
                    color === c && s.swatchActive,
                  ]}
                  onPress={() => setColor(c)}
                />
              ))}
            </View>
          </View>

          {/* ── Guide fields ── */}
          {isGuide && (
            <>
              <View style={s.field}>
                <Text style={s.label}>Date</Text>
                <Pressable
                  style={s.pickerBtn}
                  onPress={() => setActivePicker("date")}
                >
                  <MaterialIcons name="calendar-today" size={18} color="#8A7E9E" />
                  <Text style={s.pickerBtnText}>{formatDate(eventDate)}</Text>
                </Pressable>
              </View>

              <View style={s.row}>
                <View style={[s.field, { flex: 1 }]}>
                  <Text style={s.label}>Start</Text>
                  <Pressable
                    style={s.pickerBtn}
                    onPress={() => setActivePicker("time-start")}
                  >
                    <MaterialIcons name="schedule" size={18} color="#8A7E9E" />
                    <Text style={s.pickerBtnText}>{formatTime(startTime)}</Text>
                  </Pressable>
                </View>
                <View style={[s.field, { flex: 1 }]}>
                  <Text style={s.label}>End</Text>
                  <Pressable
                    style={s.pickerBtn}
                    onPress={() => setActivePicker("time-end")}
                  >
                    <MaterialIcons name="schedule" size={18} color="#8A7E9E" />
                    <Text style={s.pickerBtnText}>{formatTime(endTime)}</Text>
                  </Pressable>
                </View>
              </View>

              {/* iOS: inline pickers */}
              {Platform.OS === "ios" && showingDate && (
                <View style={s.inlinePicker}>
                  <DateTimePicker
                    mode="date"
                    display="inline"
                    value={eventDate}
                    onChange={onPickerChange}
                    themeVariant="light"
                  />
                </View>
              )}
              {Platform.OS === "ios" && showingTime && (
                <View style={s.inlinePicker}>
                  <DateTimePicker
                    mode="time"
                    display="spinner"
                    value={activePicker === "time-start" ? startTime : endTime}
                    onChange={onPickerChange}
                    themeVariant="light"
                  />
                </View>
              )}
            </>
          )}

          {/* ── Learner fields ── */}
          {!isGuide && (
            <>
              <View style={s.field}>
                <Text style={s.label}>Schedule</Text>
                <View style={s.toggleRow}>
                  <Pressable
                    style={[
                      s.toggleBtn,
                      recurrence === "weekly" && s.toggleBtnActive,
                    ]}
                    onPress={() => setRecurrence("weekly")}
                  >
                    <Text
                      style={[
                        s.toggleText,
                        recurrence === "weekly" && s.toggleTextActive,
                      ]}
                    >
                      Weekly
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      s.toggleBtn,
                      recurrence === "none" && s.toggleBtnActive,
                    ]}
                    onPress={() => setRecurrence("none")}
                  >
                    <Text
                      style={[
                        s.toggleText,
                        recurrence === "none" && s.toggleTextActive,
                      ]}
                    >
                      One-off
                    </Text>
                  </Pressable>
                </View>
              </View>

              {recurrence === "weekly" && (
                <View style={s.field}>
                  <Text style={s.label}>Days</Text>
                  <View style={s.daysRow}>
                    {WEEKDAYS.map((day, i) => (
                      <Pressable
                        key={day}
                        style={[
                          s.dayBtn,
                          selectedDays.includes(i) && s.dayBtnActive,
                        ]}
                        onPress={() => toggleDay(i)}
                      >
                        <Text
                          style={[
                            s.dayText,
                            selectedDays.includes(i) && s.dayTextActive,
                          ]}
                        >
                          {day}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              {recurrence === "none" && (
                <View style={s.field}>
                  <Text style={s.label}>Date</Text>
                  <Pressable
                    style={s.pickerBtn}
                    onPress={() => setActivePicker("date")}
                  >
                    <MaterialIcons name="calendar-today" size={18} color="#8A7E9E" />
                    <Text style={s.pickerBtnText}>{formatDate(eventDate)}</Text>
                  </Pressable>
                  {Platform.OS === "ios" && showingDate && (
                    <View style={s.inlinePicker}>
                      <DateTimePicker
                        mode="date"
                        display="inline"
                        value={eventDate}
                        onChange={onPickerChange}
                        themeVariant="light"
                      />
                    </View>
                  )}
                </View>
              )}

              <View style={s.row}>
                <View style={[s.field, { flex: 1 }]}>
                  <Text style={s.label}>Start</Text>
                  <Pressable
                    style={s.pickerBtn}
                    onPress={() => setActivePicker("time-start")}
                  >
                    <MaterialIcons name="schedule" size={18} color="#8A7E9E" />
                    <Text style={s.pickerBtnText}>{formatTime(startTime)}</Text>
                  </Pressable>
                </View>
                <View style={[s.field, { flex: 1 }]}>
                  <Text style={s.label}>End</Text>
                  <Pressable
                    style={s.pickerBtn}
                    onPress={() => setActivePicker("time-end")}
                  >
                    <MaterialIcons name="schedule" size={18} color="#8A7E9E" />
                    <Text style={s.pickerBtnText}>{formatTime(endTime)}</Text>
                  </Pressable>
                </View>
              </View>

              {Platform.OS === "ios" && showingTime && (
                <View style={s.inlinePicker}>
                  <DateTimePicker
                    mode="time"
                    display="spinner"
                    value={activePicker === "time-start" ? startTime : endTime}
                    onChange={onPickerChange}
                    themeVariant="light"
                  />
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Android: modal-style pickers */}
      {Platform.OS === "android" && activePicker !== null && (
        <DateTimePicker
          mode={activePicker === "date" ? "date" : "time"}
          display="default"
          value={
            activePicker === "date"
              ? eventDate
              : activePicker === "time-start"
              ? startTime
              : endTime
          }
          onChange={onPickerChange}
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
  saveBtn: {
    backgroundColor: "#C4F34A",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { fontSize: 15, fontWeight: "700", color: "#2D1B4E" },
  scroll: {
    padding: 20,
    gap: 20,
  },
  field: { gap: 8 },
  label: { fontSize: 13, fontWeight: "700", color: "#2D1B4E" },
  input: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 14 : 10,
    fontSize: 16,
    color: "#2D1B4E",
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  // Emoji
  emojiBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  emojiDisplay: { fontSize: 24 },
  emojiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 10,
    gap: 4,
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  emojiCell: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiCellActive: { backgroundColor: "#C4F34A" },
  emojiCellText: { fontSize: 22 },
  // Color
  swatchRow: { flexDirection: "row", gap: 12 },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 999,
  },
  swatchActive: {
    borderWidth: 3,
    borderColor: "#2D1B4E",
  },
  // Picker button
  pickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  pickerBtnText: { fontSize: 16, color: "#2D1B4E", fontWeight: "500" },
  inlinePicker: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    overflow: "hidden",
  },
  // Layout
  row: { flexDirection: "row", gap: 12 },
  toggleRow: { flexDirection: "row", gap: 10 },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  toggleBtnActive: { backgroundColor: "#C4F34A" },
  toggleText: { fontSize: 15, fontWeight: "600", color: "#8A7E9E" },
  toggleTextActive: { color: "#2D1B4E", fontWeight: "700" },
  daysRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dayBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  dayBtnActive: { backgroundColor: "#C4F34A" },
  dayText: { fontSize: 14, fontWeight: "600", color: "#8A7E9E" },
  dayTextActive: { color: "#2D1B4E", fontWeight: "700" },
});
