import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BottomNav } from "@/components/bottom-nav";
import { useAuth } from "@/context/AuthContext";
import {
  CalEvent,
  expandEvents,
  fetchCalendarEvents,
} from "@/lib/pocketbase";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1; // Monday-first
}

export default function CalendarScreen() {
  const { user, role, isAuthenticated } = useAuth();
  const today = new Date();

  const [displayYear, setDisplayYear] = useState(today.getFullYear());
  const [displayMonth, setDisplayMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(
    `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`
  );
  const [events, setEvents] = useState<Record<string, CalEvent[]>>({});
  const [loading, setLoading] = useState(false);

  // Reload whenever the screen comes into focus (e.g. after creating an event)
  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      let cancelled = false;
      (async () => {
        setLoading(true);
        try {
          const monthStart = new Date(displayYear, displayMonth, 1);
          const monthEnd = new Date(displayYear, displayMonth + 1, 0, 23, 59, 59);
          const records = await fetchCalendarEvents(user.id, monthStart, monthEnd);
          if (!cancelled) {
            const expanded = expandEvents(records, displayYear, displayMonth);
            setEvents(expanded);
          }
        } catch (e: any) {
          if (!cancelled) console.error("[calendar] Failed to load events", e?.message);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }, [displayYear, displayMonth, user?.id])
  );

  const cells = useMemo(() => {
    const daysInMonth = getDaysInMonth(displayYear, displayMonth);
    const firstDay = getFirstDayOfMonth(displayYear, displayMonth);
    const prevMonthDays = getDaysInMonth(
      displayMonth === 0 ? displayYear - 1 : displayYear,
      displayMonth === 0 ? 11 : displayMonth - 1
    );
    const result: { day: number; current: boolean }[] = [];
    for (let i = firstDay - 1; i >= 0; i--) {
      result.push({ day: prevMonthDays - i, current: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      result.push({ day: d, current: true });
    }
    const rem = 7 - (result.length % 7);
    if (rem < 7) {
      for (let d = 1; d <= rem; d++) result.push({ day: d, current: false });
    }
    return result;
  }, [displayYear, displayMonth]);

  function prevMonth() {
    const newMonth = displayMonth === 0 ? 11 : displayMonth - 1;
    const newYear = displayMonth === 0 ? displayYear - 1 : displayYear;
    setDisplayMonth(newMonth);
    setDisplayYear(newYear);
  }

  function nextMonth() {
    const newMonth = displayMonth === 11 ? 0 : displayMonth + 1;
    const newYear = displayMonth === 11 ? displayYear + 1 : displayYear;
    setDisplayMonth(newMonth);
    setDisplayYear(newYear);
  }

  const todayKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  const selectedEvents = events[selectedDate] ?? [];
  const [selY, selM, selD] = selectedDate.split("-").map(Number);
  const dayLabel = new Date(selY, selM - 1, selD).toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric",
  });

  if (!isAuthenticated) return <Redirect href="/(tabs)/" />;

  function openCreateForm() {
    router.push("/(modals)/create-event");
  }

  return (
    <SafeAreaView style={s.safe}>
      {/* Calendar header card */}
      <View style={s.calHeader}>
        <View style={s.monthNav}>
          <Pressable style={s.navBtn} onPress={prevMonth}>
            <MaterialIcons name="chevron-left" size={26} color="#2D1B4E" />
          </Pressable>
          <Text style={s.monthTitle}>{MONTHS[displayMonth]} {displayYear}</Text>
          <Pressable style={s.navBtn} onPress={nextMonth}>
            <MaterialIcons name="chevron-right" size={26} color="#2D1B4E" />
          </Pressable>
        </View>

        <View style={s.weekRow}>
          {WEEKDAYS.map((d, i) => (
            <Text key={i} style={s.weekDay}>{d}</Text>
          ))}
        </View>

        <View style={s.grid}>
          {cells.map((cell, i) => {
            const dateKey = cell.current
              ? `${displayYear}-${displayMonth + 1}-${cell.day}`
              : "";
            const isSelected = dateKey === selectedDate;
            const isToday = dateKey === todayKey;
            const eventColors = cell.current && events[dateKey]
              ? events[dateKey].map((e) => e.color)
              : [];

            return (
              <Pressable
                key={i}
                style={s.dayCell}
                onPress={() => { if (cell.current) setSelectedDate(dateKey); }}
              >
                <View style={[
                  s.dayCircle,
                  isSelected && s.dayCircleSelected,
                  !isSelected && isToday && s.dayCircleToday,
                ]}>
                  <Text style={[
                    s.dayText,
                    !cell.current && s.dayTextFaded,
                    isSelected && s.dayTextSelected,
                  ]}>
                    {cell.day}
                  </Text>
                </View>
                {eventColors.length > 0 && (
                  <View style={s.dotsRow}>
                    {eventColors.slice(0, 3).map((c, di) => (
                      <View key={di} style={[s.dot, { backgroundColor: c }]} />
                    ))}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Event list */}
      <ScrollView
        style={s.eventScroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.eventContent}
      >
        <Text style={s.dayLabel}>{dayLabel}</Text>

        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="small" color="#C4F34A" />
          </View>
        ) : selectedEvents.length === 0 ? (
          <View style={s.emptyState}>
            <Text style={s.emptyEmoji}>🌙</Text>
            <Text style={s.emptyText}>Nothing scheduled!</Text>
            <Pressable style={s.emptyAddBtn} onPress={openCreateForm}>
              <Text style={s.emptyAddText}>
                {role === "lg" || role === "admin" ? "+ Add Event" : "+ Add Class"}
              </Text>
            </Pressable>
          </View>
        ) : (
          selectedEvents.map((ev) => (
            <Pressable
              key={ev.id}
              style={s.eventCard}
              onPress={() =>
                router.push({
                  pathname: "/(modals)/event-detail",
                  params: {
                    title: ev.title,
                    time: ev.time,
                    emoji: ev.emoji,
                    color: ev.color,
                    recordId: ev.recordId,
                  },
                })
              }
            >
              <View style={[s.eventAccent, { backgroundColor: ev.color }]} />
              <View style={[s.eventIconCircle, { backgroundColor: ev.color + "22" }]}>
                <Text style={s.eventEmoji}>{ev.emoji || "📅"}</Text>
              </View>
              <View style={s.eventBody}>
                <Text style={s.eventTitle}>{ev.title}</Text>
                <View style={s.eventTimeRow}>
                  <MaterialIcons name="schedule" size={14} color="#8A7E9E" />
                  <Text style={s.eventTime}>{ev.time}</Text>
                </View>
              </View>
              <MaterialIcons name="chevron-right" size={22} color="#8A7E9E" />
            </Pressable>
          ))
        )}
      </ScrollView>

      {/* FAB */}
      <Pressable style={s.fab} onPress={openCreateForm}>
        <MaterialIcons name="add" size={28} color="#2D1B4E" />
      </Pressable>

      <BottomNav active="calendar" />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F9FAFC" },
  calHeader: {
    backgroundColor: "#FFFFFF",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    paddingTop: 8,
    paddingBottom: 16,
    paddingHorizontal: 16,
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 20,
    elevation: 5,
    zIndex: 10,
  },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: "#F9FAFC",
    alignItems: "center",
    justifyContent: "center",
  },
  monthTitle: { fontSize: 22, fontWeight: "700", color: "#2D1B4E" },
  weekRow: { flexDirection: "row", marginBottom: 8 },
  weekDay: {
    flex: 1,
    textAlign: "center",
    fontSize: 13,
    fontWeight: "700",
    color: "#8A7E9E",
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: {
    width: `${100 / 7}%`,
    alignItems: "center",
    paddingVertical: 3,
    minHeight: 52,
  },
  dayCircle: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCircleSelected: { backgroundColor: "#C4F34A" },
  dayCircleToday: { borderWidth: 2, borderColor: "#C4F34A" },
  dayText: { fontSize: 15, fontWeight: "600", color: "#2D1B4E" },
  dayTextFaded: { color: "#8A7E9E", opacity: 0.45 },
  dayTextSelected: { fontWeight: "800" },
  dotsRow: { flexDirection: "row", gap: 2, marginTop: 2, alignItems: "center" },
  dot: { width: 5, height: 5, borderRadius: 999 },
  eventScroll: { flex: 1 },
  eventContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 120,
    gap: 12,
  },
  dayLabel: { fontSize: 18, fontWeight: "700", color: "#2D1B4E", marginBottom: 4 },
  loadingWrap: { paddingTop: 32, alignItems: "center" },
  emptyState: { alignItems: "center", paddingTop: 40, opacity: 0.7 },
  emptyEmoji: { fontSize: 42, marginBottom: 8 },
  emptyText: { fontSize: 16, color: "#8A7E9E", fontWeight: "600", marginBottom: 16 },
  emptyAddBtn: {
    backgroundColor: "#C4F34A",
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  emptyAddText: { fontSize: 15, fontWeight: "700", color: "#2D1B4E" },
  eventCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
    overflow: "hidden",
  },
  eventAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 6,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  eventIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
    flexShrink: 0,
  },
  eventEmoji: { fontSize: 22 },
  eventBody: { flex: 1 },
  eventTitle: { fontSize: 16, fontWeight: "700", color: "#2D1B4E" },
  eventTimeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  eventTime: { fontSize: 13, color: "#8A7E9E", fontWeight: "600" },
  fab: {
    position: "absolute",
    bottom: 90,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: "#C4F34A",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 6,
  },
});
