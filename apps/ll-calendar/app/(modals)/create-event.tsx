import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
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
import { useAuth } from "@/context/AuthContext";
import {
  createCalendarEntry,
  getCalendarEntry,
  updateCalendarEntry,
} from "@/lib/pocketbase";
import { Colors, Fonts } from "@/constants/theme";

// 12 evenly-spaced hues plus the deep-green brand accent at the center.
// hsl(hue, 62%, 58%) gives a soft editorial palette that reads well on paper bg.
const WHEEL_HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
const WHEEL_COLORS = WHEEL_HUES.map((h) => `hsl(${h}, 62%, 58%)`);
const COLORS = [Colors.lavender, ...WHEEL_COLORS];

const WHEEL_SIZE = 220;
const WHEEL_SWATCH = 34;
const WHEEL_RADIUS = WHEEL_SIZE / 2 - WHEEL_SWATCH / 2 - 6;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PROGRAMS = [
  { code: "chmk", label: "Changemakers", short: "CHMK" },
  { code: "cre", label: "Creators", short: "CRE" },
  { code: "exp", label: "Explorers", short: "EXP" },
] as const;

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

/**
 * A single date-or-time field. Uses iOS's native `compact` display so the
 * value renders inline as a tappable system control (no separate panel).
 * On Android, falls back to a tappable pill that opens the system modal.
 */
function PickerField({
  label,
  mode,
  value,
  onChange,
  androidOnPress,
  formatted,
  icon,
}: {
  label: string;
  mode: "date" | "time";
  value: Date;
  onChange: (e: DateTimePickerEvent, selected?: Date) => void;
  androidOnPress: () => void;
  formatted: string;
  icon: "calendar-today" | "schedule";
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      {Platform.OS === "ios" ? (
        <View style={s.pickerBtn}>
          <MaterialIcons name={icon} size={18} color={Colors.muted} />
          <View style={{ flex: 1 }} />
          <DateTimePicker
            mode={mode}
            display="compact"
            value={value}
            onChange={onChange}
            themeVariant="light"
            accentColor={Colors.lavender}
          />
        </View>
      ) : (
        <Pressable style={s.pickerBtn} onPress={androidOnPress}>
          <MaterialIcons name={icon} size={18} color={Colors.muted} />
          <Text style={s.pickerBtnText}>{formatted}</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function CreateEventModal() {
  const { role, user } = useAuth();
  const params = useLocalSearchParams<{ date?: string; recordId?: string }>();
  const editingId = params.recordId ?? "";
  const isEditing = editingId.length > 0;

  const isGuide = role === "lg" || role === "admin";
  const title = isEditing
    ? isGuide
      ? "Edit Event"
      : "Edit Class"
    : isGuide
      ? "New Event"
      : "Add Class";

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
  const [isLoading, setIsLoading] = useState(isEditing);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  // Guide: program selector + recurrence
  const [selectedPrograms, setSelectedPrograms] = useState<string[]>([]);
  const [guideRecurrence, setGuideRecurrence] = useState<"none" | "weekly">("none");
  const [guideDays, setGuideDays] = useState<number[]>([0]);

  // Guide: RSVP config (events only)
  const [rsvpEnabled, setRsvpEnabled] = useState(false);
  const [capacityText, setCapacityText] = useState(""); // string so user can clear it
  const [allowWaitlist, setAllowWaitlist] = useState(true);
  const [rsvpDeadline, setRsvpDeadline] = useState<Date | null>(null);
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);

  function toggleProgram(code: string) {
    setSelectedPrograms((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  // Learner
  const [recurrence, setRecurrence] = useState<"none" | "weekly">("weekly");
  const [selectedDays, setSelectedDays] = useState<number[]>([0]);

  function toggleDay(index: number) {
    setSelectedDays((prev) =>
      prev.includes(index) ? prev.filter((d) => d !== index) : [...prev, index]
    );
  }

  // Load existing record when editing
  useEffect(() => {
    if (!isEditing) return;
    let cancelled = false;
    (async () => {
      try {
        const rec = await getCalendarEntry(editingId);
        if (cancelled) return;
        const start = new Date(rec.start);
        const end = new Date(rec.end);
        setName(rec.title);
        setColor(rec.color || COLORS[0]);
        setEmoji(rec.emoji || (isGuide ? "📅" : "📚"));
        setEventDate(start);
        setStartTime(start);
        setEndTime(end);
        const days = Array.isArray(rec.recurrence_days) ? rec.recurrence_days : [];
        const isWeekly = rec.recurrence === "weekly" || days.length > 0;
        if (rec.type === "event" || isGuide) {
          setGuideRecurrence(isWeekly ? "weekly" : "none");
          setGuideDays(isWeekly && days.length > 0 ? days : [0]);
          setSelectedPrograms(Array.isArray(rec.programs) ? rec.programs : []);
          setRsvpEnabled(Boolean(rec.rsvp_enabled));
          setCapacityText(
            rec.capacity != null && rec.capacity > 0 ? String(rec.capacity) : "",
          );
          setAllowWaitlist(rec.allow_waitlist !== false);
          setRsvpDeadline(rec.rsvp_deadline ? new Date(rec.rsvp_deadline) : null);
        } else {
          setRecurrence(isWeekly ? "weekly" : "none");
          setSelectedDays(isWeekly && days.length > 0 ? days : [0]);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Could not load event.";
        setLoadError(msg);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEditing, editingId, isGuide]);

  function toggleGuideDay(index: number) {
    setGuideDays((prev) =>
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

    if (isGuide && guideRecurrence === "weekly" && guideDays.length === 0) {
      Alert.alert("No days selected", "Pick at least one day for weekly events.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isGuide) {
        // Capacity: only sent when RSVP is enabled and a positive integer
        // was entered. Empty / zero / NaN all mean "unlimited".
        const capacityNum = parseInt(capacityText, 10);
        const capacityValue =
          rsvpEnabled && Number.isFinite(capacityNum) && capacityNum > 0
            ? capacityNum
            : null;

        const payload = {
          title: name.trim(),
          start: combineDateTime(eventDate, startTime),
          end: combineDateTime(eventDate, endTime),
          color,
          emoji,
          type: "event" as const,
          recurrence: guideRecurrence,
          recurrence_days: guideRecurrence === "weekly" ? guideDays : [],
          recurrence_end: "",
          created_by: user.id,
          programs: selectedPrograms.length > 0 ? selectedPrograms : undefined,
          rsvp_enabled: rsvpEnabled,
          capacity: capacityValue,
          rsvp_deadline:
            rsvpEnabled && rsvpDeadline ? rsvpDeadline.toISOString() : null,
          allow_waitlist: rsvpEnabled ? allowWaitlist : false,
        };
        if (isEditing) {
          await updateCalendarEntry(editingId, payload);
        } else {
          await createCalendarEntry(payload);
        }
      } else {
        const anchorDate = eventDate;
        const payload = {
          title: name.trim(),
          start: combineDateTime(anchorDate, startTime),
          end: combineDateTime(anchorDate, endTime),
          color,
          emoji,
          type: "class" as const,
          recurrence,
          recurrence_days: recurrence === "weekly" ? selectedDays : [],
          recurrence_end: "",
          created_by: user.id,
        };
        if (isEditing) {
          await updateCalendarEntry(editingId, payload);
        } else {
          await createCalendarEntry(payload);
        }
      }
      router.back();
    } catch (err: any) {
      Alert.alert("Failed to save", err?.message ?? "Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <Pressable style={s.closeBtn} onPress={() => router.back()}>
          <MaterialIcons name="close" size={22} color={Colors.textPrimary} />
        </Pressable>
        <Text style={s.headerTitle}>{title}</Text>
        <Pressable
          style={[
            s.saveBtn,
            (isSubmitting || isLoading) && s.saveBtnDisabled,
          ]}
          onPress={handleSubmit}
          disabled={isSubmitting || isLoading}
        >
          <Text style={s.saveBtnText}>
            {isSubmitting ? "Saving…" : isEditing ? "Update" : "Save"}
          </Text>
        </Pressable>
      </View>

      {isLoading && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator size="small" color={Colors.lavender} />
        </View>
      )}
      {loadError && !isLoading && (
        <View style={s.errorBanner}>
          <Text style={s.errorBannerText}>{loadError}</Text>
        </View>
      )}

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
              placeholderTextColor={Colors.muted}
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
              <MaterialIcons name="expand-more" size={20} color={Colors.muted} />
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

          {/* Color wheel */}
          <View style={s.field}>
            <Text style={s.label}>Color</Text>
            <View style={s.wheelWrap}>
              <View style={s.wheel}>
                {/* Center swatch shows current pick + acts as the brand-accent button */}
                <Pressable
                  onPress={() => setColor(Colors.lavender)}
                  style={[
                    s.wheelCenter,
                    { backgroundColor: color },
                    color === Colors.lavender && s.wheelSwatchActive,
                  ]}
                />
                {WHEEL_COLORS.map((c, i) => {
                  const angle = (i / WHEEL_COLORS.length) * 2 * Math.PI - Math.PI / 2;
                  const cx = WHEEL_SIZE / 2 + Math.cos(angle) * WHEEL_RADIUS - WHEEL_SWATCH / 2;
                  const cy = WHEEL_SIZE / 2 + Math.sin(angle) * WHEEL_RADIUS - WHEEL_SWATCH / 2;
                  const active = color === c;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => setColor(c)}
                      style={[
                        s.wheelSwatch,
                        {
                          left: cx,
                          top: cy,
                          backgroundColor: c,
                        },
                        active && s.wheelSwatchActive,
                      ]}
                    />
                  );
                })}
              </View>
            </View>
          </View>

          {/* ── Guide fields ── */}
          {isGuide && (
            <>
              {/* Program selector (multi-select) */}
              <View style={s.field}>
                <Text style={s.label}>Who can see this?</Text>
                <Text style={s.sublabel}>
                  {selectedPrograms.length === 0
                    ? "Just you (tap programs to share)"
                    : selectedPrograms.length === 3
                    ? "Everyone"
                    : `${selectedPrograms.map(c => PROGRAMS.find(p => p.code === c)?.short).join(" + ")}`}
                </Text>
                <View style={s.programRow}>
                  {PROGRAMS.map((p) => (
                    <Pressable
                      key={p.code}
                      style={[
                        s.programBtn,
                        selectedPrograms.includes(p.code) && s.programBtnActive,
                      ]}
                      onPress={() => toggleProgram(p.code)}
                    >
                      <Text
                        style={[
                          s.programText,
                          selectedPrograms.includes(p.code) && s.programTextActive,
                        ]}
                      >
                        {p.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* RSVP config */}
              <View style={s.field}>
                <Pressable
                  style={s.rsvpToggleRow}
                  onPress={() => setRsvpEnabled((v) => !v)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.label}>Require RSVP</Text>
                    <Text style={s.sublabel}>
                      {rsvpEnabled
                        ? "Learners can mark themselves going / not going"
                        : "Off — anyone can show up"}
                    </Text>
                  </View>
                  <View
                    style={[
                      s.switch,
                      rsvpEnabled && s.switchOn,
                    ]}
                  >
                    <View
                      style={[
                        s.switchKnob,
                        rsvpEnabled && s.switchKnobOn,
                      ]}
                    />
                  </View>
                </Pressable>
              </View>

              {rsvpEnabled && (
                <>
                  <View style={s.field}>
                    <Text style={s.label}>Capacity</Text>
                    <Text style={s.sublabel}>Leave blank for unlimited</Text>
                    <TextInput
                      style={s.input}
                      placeholder="e.g. 20"
                      placeholderTextColor={Colors.muted}
                      value={capacityText}
                      onChangeText={(t) => setCapacityText(t.replace(/[^0-9]/g, ""))}
                      keyboardType="number-pad"
                    />
                  </View>

                  {capacityText.length > 0 && parseInt(capacityText, 10) > 0 && (
                    <View style={s.field}>
                      <Pressable
                        style={s.rsvpToggleRow}
                        onPress={() => setAllowWaitlist((v) => !v)}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={s.label}>Allow waitlist</Text>
                          <Text style={s.sublabel}>
                            {allowWaitlist
                              ? "Extras join a waitlist when full"
                              : "Extras are turned away when full"}
                          </Text>
                        </View>
                        <View
                          style={[
                            s.switch,
                            allowWaitlist && s.switchOn,
                          ]}
                        >
                          <View
                            style={[
                              s.switchKnob,
                              allowWaitlist && s.switchKnobOn,
                            ]}
                          />
                        </View>
                      </Pressable>
                    </View>
                  )}

                  <View style={s.field}>
                    <Text style={s.label}>RSVP deadline (optional)</Text>
                    {rsvpDeadline ? (
                      <View style={s.deadlineRow}>
                        <Pressable
                          style={[s.pickerBtn, { flex: 1 }]}
                          onPress={() => {
                            if (Platform.OS === "android") {
                              setShowDeadlinePicker(true);
                            }
                          }}
                        >
                          <MaterialIcons name="event" size={18} color={Colors.muted} />
                          {Platform.OS === "ios" ? (
                            <>
                              <View style={{ flex: 1 }} />
                              <DateTimePicker
                                mode="datetime"
                                display="compact"
                                value={rsvpDeadline}
                                onChange={(_e, d) => d && setRsvpDeadline(d)}
                                themeVariant="light"
                                accentColor={Colors.lavender}
                              />
                            </>
                          ) : (
                            <Text style={s.pickerBtnText}>
                              {formatDate(rsvpDeadline)} {formatTime(rsvpDeadline)}
                            </Text>
                          )}
                        </Pressable>
                        <Pressable
                          style={s.deadlineClearBtn}
                          onPress={() => setRsvpDeadline(null)}
                        >
                          <MaterialIcons name="close" size={18} color={Colors.muted} />
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        style={s.pickerBtn}
                        onPress={() => {
                          // Default to event date, 1h before start.
                          const d = new Date(eventDate);
                          d.setHours(startTime.getHours(), startTime.getMinutes(), 0, 0);
                          d.setHours(d.getHours() - 1);
                          setRsvpDeadline(d);
                          if (Platform.OS === "android") setShowDeadlinePicker(true);
                        }}
                      >
                        <MaterialIcons name="add" size={18} color={Colors.muted} />
                        <Text style={s.pickerBtnText}>Add deadline</Text>
                      </Pressable>
                    )}
                  </View>
                </>
              )}

              {/* Schedule type */}
              <View style={s.field}>
                <Text style={s.label}>Schedule</Text>
                <View style={s.toggleRow}>
                  <Pressable
                    style={[
                      s.toggleBtn,
                      guideRecurrence === "none" && s.toggleBtnActive,
                    ]}
                    onPress={() => setGuideRecurrence("none")}
                  >
                    <Text
                      style={[
                        s.toggleText,
                        guideRecurrence === "none" && s.toggleTextActive,
                      ]}
                    >
                      One-off
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      s.toggleBtn,
                      guideRecurrence === "weekly" && s.toggleBtnActive,
                    ]}
                    onPress={() => setGuideRecurrence("weekly")}
                  >
                    <Text
                      style={[
                        s.toggleText,
                        guideRecurrence === "weekly" && s.toggleTextActive,
                      ]}
                    >
                      Weekly
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* Weekly days selector for guides */}
              {guideRecurrence === "weekly" && (
                <View style={s.field}>
                  <Text style={s.label}>Days</Text>
                  <View style={s.daysRow}>
                    {WEEKDAYS.map((day, i) => (
                      <Pressable
                        key={day}
                        style={[
                          s.dayBtn,
                          guideDays.includes(i) && s.dayBtnActive,
                        ]}
                        onPress={() => toggleGuideDay(i)}
                      >
                        <Text
                          style={[
                            s.dayText,
                            guideDays.includes(i) && s.dayTextActive,
                          ]}
                        >
                          {day}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              <PickerField
                label="Date"
                mode="date"
                value={eventDate}
                icon="calendar-today"
                formatted={formatDate(eventDate)}
                onChange={(_e, d) => d && setEventDate(d)}
                androidOnPress={() => setActivePicker("date")}
              />

              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <PickerField
                    label="Start"
                    mode="time"
                    value={startTime}
                    icon="schedule"
                    formatted={formatTime(startTime)}
                    onChange={(_e, d) => d && setStartTime(d)}
                    androidOnPress={() => setActivePicker("time-start")}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <PickerField
                    label="End"
                    mode="time"
                    value={endTime}
                    icon="schedule"
                    formatted={formatTime(endTime)}
                    onChange={(_e, d) => d && setEndTime(d)}
                    androidOnPress={() => setActivePicker("time-end")}
                  />
                </View>
              </View>
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
                <PickerField
                  label="Date"
                  mode="date"
                  value={eventDate}
                  icon="calendar-today"
                  formatted={formatDate(eventDate)}
                  onChange={(_e, d) => d && setEventDate(d)}
                  androidOnPress={() => setActivePicker("date")}
                />
              )}

              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <PickerField
                    label="Start"
                    mode="time"
                    value={startTime}
                    icon="schedule"
                    formatted={formatTime(startTime)}
                    onChange={(_e, d) => d && setStartTime(d)}
                    androidOnPress={() => setActivePicker("time-start")}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <PickerField
                    label="End"
                    mode="time"
                    value={endTime}
                    icon="schedule"
                    formatted={formatTime(endTime)}
                    onChange={(_e, d) => d && setEndTime(d)}
                    androidOnPress={() => setActivePicker("time-end")}
                  />
                </View>
              </View>
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

      {Platform.OS === "android" && showDeadlinePicker && rsvpDeadline && (
        <DateTimePicker
          mode="datetime"
          display="default"
          value={rsvpDeadline}
          onChange={(_e, d) => {
            setShowDeadlinePicker(false);
            if (d) setRsvpDeadline(d);
          }}
        />
      )}
    </SafeAreaView>
  );
}

const FIELD_BORDER = 1;
const CARD_RADIUS = 14;

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  // ─── Header ───
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
    letterSpacing: -0.2,
  },
  saveBtn: {
    backgroundColor: Colors.lime,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderWidth: 1.5,
    borderColor: Colors.textPrimary,
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: Colors.purple,
    fontFamily: Fonts.mono,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },

  // ─── Layout ───
  scroll: { padding: 20, gap: 22 },
  field: { gap: 8 },
  row: { flexDirection: "row", gap: 12 },

  // Mono caps kicker matches the home/inbox label style
  label: {
    fontSize: 10.5,
    fontWeight: "700",
    color: Colors.muted,
    fontFamily: Fonts.mono,
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  sublabel: {
    fontSize: 12.5,
    fontWeight: "500",
    color: Colors.textSecondary,
    marginBottom: 2,
  },

  // ─── Inputs ───
  input: {
    backgroundColor: Colors.surface,
    borderRadius: CARD_RADIUS,
    borderWidth: FIELD_BORDER,
    borderColor: Colors.divider,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 14 : 10,
    fontSize: 16,
    color: Colors.textPrimary,
  },

  // Emoji
  emojiBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: CARD_RADIUS,
    borderWidth: FIELD_BORDER,
    borderColor: Colors.divider,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  emojiDisplay: { fontSize: 24 },
  emojiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: Colors.surface,
    borderRadius: CARD_RADIUS,
    borderWidth: FIELD_BORDER,
    borderColor: Colors.divider,
    padding: 10,
    gap: 4,
  },
  emojiCell: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiCellActive: { backgroundColor: Colors.lime },
  emojiCellText: { fontSize: 22 },

  // Color wheel
  wheelWrap: {
    alignItems: "center",
    paddingVertical: 8,
  },
  wheel: {
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  wheelSwatch: {
    position: "absolute",
    width: WHEEL_SWATCH,
    height: WHEEL_SWATCH,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.surface,
  },
  wheelSwatchActive: {
    borderWidth: 3,
    borderColor: Colors.textPrimary,
  },
  wheelCenter: {
    width: WHEEL_SWATCH + 22,
    height: WHEEL_SWATCH + 22,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: Colors.textPrimary,
  },

  // Date / time picker buttons
  pickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: CARD_RADIUS,
    borderWidth: FIELD_BORDER,
    borderColor: Colors.divider,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  pickerBtnText: {
    fontSize: 15,
    color: Colors.textPrimary,
    fontWeight: "600",
  },
  inlinePicker: {
    backgroundColor: Colors.surface,
    borderRadius: CARD_RADIUS,
    borderWidth: FIELD_BORDER,
    borderColor: Colors.divider,
    overflow: "hidden",
    marginTop: 4,
  },

  // Pill toggle (One-off / Weekly)
  toggleRow: { flexDirection: "row", gap: 10 },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
    alignItems: "center",
  },
  toggleBtnActive: {
    backgroundColor: Colors.lime,
    borderColor: Colors.textPrimary,
    borderWidth: 1.5,
  },
  toggleText: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.muted,
    fontFamily: Fonts.mono,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  toggleTextActive: {
    color: Colors.purple,
  },

  // Program pills (multi-select)
  programRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  programBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  programBtnActive: {
    backgroundColor: Colors.lavender,
    borderColor: Colors.lavender,
  },
  programText: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.muted,
    fontFamily: Fonts.mono,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  programTextActive: { color: Colors.background },

  // Day pills
  daysRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dayBtn: {
    minWidth: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
    alignItems: "center",
  },
  dayBtnActive: {
    backgroundColor: Colors.lime,
    borderColor: Colors.textPrimary,
    borderWidth: 1.5,
  },
  dayText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.muted,
    fontFamily: Fonts.mono,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  dayTextActive: { color: Colors.purple },

  // RSVP config
  rsvpToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: CARD_RADIUS,
    borderWidth: FIELD_BORDER,
    borderColor: Colors.divider,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  switch: {
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.divider,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  switchOn: {
    backgroundColor: Colors.lime,
    borderColor: Colors.textPrimary,
  },
  switchKnob: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  switchKnobOn: {
    transform: [{ translateX: 18 }],
    backgroundColor: Colors.purple,
    borderColor: Colors.textPrimary,
  },
  deadlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  deadlineClearBtn: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: Colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },

  // Status / errors
  loadingOverlay: {
    paddingVertical: 24,
    alignItems: "center",
  },
  errorBanner: {
    marginHorizontal: 20,
    marginTop: 12,
    padding: 12,
    backgroundColor: "rgba(194, 107, 60, 0.1)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.orange,
  },
  errorBannerText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.orange,
  },
});
