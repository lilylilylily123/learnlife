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
import { Colors, Fonts } from "@/constants/theme";

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
          const records = await fetchCalendarEvents();
          console.log("[calendar] fetched", records.length, "records", JSON.stringify(records.map(r => ({ id: r.id, title: r.title, programs: r.programs }))));
          if (!cancelled) {
            const expanded = expandEvents(records, displayYear, displayMonth);
            console.log("[calendar] expanded keys:", Object.keys(expanded), "for", displayYear, displayMonth);
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
            <MaterialIcons name="chevron-left" size={24} color={Colors.textPrimary} />
          </Pressable>
          <View style={{ alignItems: "center" }}>
            <Text style={s.kicker}>{displayYear}</Text>
            <Text style={s.monthTitle}>{MONTHS[displayMonth]}</Text>
          </View>
          <Pressable style={s.navBtn} onPress={nextMonth}>
            <MaterialIcons name="chevron-right" size={24} color={Colors.textPrimary} />
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
            <ActivityIndicator size="small" color={Colors.lavender} />
          </View>
        ) : selectedEvents.length === 0 ? (
          <View style={s.emptyState}>
            <Text style={s.emptyEmoji}>🌙</Text>
            <Text style={s.emptyText}>Nothing scheduled!</Text>
            <Pressable style={s.emptyAddBtn} onPress={openCreateForm}>
              <Text style={s.emptyAddText}>+ Add Event</Text>
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
              <View style={s.eventBody}>
                <Text style={s.eventTitle}>{ev.title}</Text>
                <Text style={s.eventTime}>{ev.time}</Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={Colors.muted} />
            </Pressable>
          ))
        )}
      </ScrollView>

      {/* FAB */}
      <Pressable style={s.fab} onPress={openCreateForm}>
        <MaterialIcons name="add" size={26} color={Colors.background} />
      </Pressable>

      <BottomNav active="calendar" />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  calHeader: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.textPrimary,
    paddingTop: 10,
    paddingBottom: 16,
    paddingHorizontal: 20,
    zIndex: 10,
  },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.divider,
    alignItems: "center",
    justifyContent: "center",
  },
  kicker: {
    color: Colors.muted,
    fontSize: 10,
    fontFamily: Fonts.mono,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  monthTitle: {
    fontSize: 26,
    fontWeight: "700",
    fontFamily: Fonts.display,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  weekRow: { flexDirection: "row", marginBottom: 6 },
  weekDay: {
    flex: 1,
    textAlign: "center",
    fontSize: 10,
    fontWeight: "700",
    color: Colors.muted,
    fontFamily: Fonts.mono,
    letterSpacing: 1,
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: {
    width: `${100 / 7}%`,
    alignItems: "center",
    paddingVertical: 3,
    minHeight: 50,
  },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCircleSelected: { backgroundColor: Colors.textPrimary },
  dayCircleToday: { borderWidth: 1.5, borderColor: Colors.textPrimary, borderStyle: "dashed" },
  dayText: { fontSize: 14, fontWeight: "500", color: Colors.textPrimary },
  dayTextFaded: { color: Colors.muted, opacity: 0.45 },
  dayTextSelected: { color: Colors.background, fontWeight: "700" },
  dotsRow: { flexDirection: "row", gap: 2, marginTop: 3, alignItems: "center" },
  dot: { width: 4, height: 4, borderRadius: 999 },
  eventScroll: { flex: 1 },
  eventContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 120,
    gap: 0,
  },
  dayLabel: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: Fonts.display,
    color: Colors.textPrimary,
    marginBottom: 10,
    letterSpacing: -0.2,
  },
  loadingWrap: { paddingTop: 32, alignItems: "center" },
  emptyState: { alignItems: "center", paddingTop: 40, gap: 10 },
  emptyEmoji: { fontSize: 32, marginBottom: 4 },
  emptyText: { fontSize: 14, color: Colors.muted, fontWeight: "500" },
  emptyAddBtn: {
    backgroundColor: Colors.textPrimary,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  emptyAddText: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.background,
    fontFamily: Fonts.display,
  },
  eventCard: {
    backgroundColor: Colors.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 18,
    paddingRight: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    overflow: "hidden",
  },
  eventAccent: {
    position: "absolute",
    left: 0,
    top: 12,
    bottom: 12,
    width: 3,
  },
  eventBody: { flex: 1 },
  eventTitle: {
    fontSize: 14.5,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  eventTime: {
    fontSize: 11,
    color: Colors.muted,
    fontWeight: "600",
    fontFamily: Fonts.mono,
    marginTop: 2,
  },
  fab: {
    position: "absolute",
    bottom: 90,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: Colors.textPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.textPrimary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 6,
  },
});
