import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAuth } from "@/context/AuthContext";
import { fetchRsvpsForOccurrence } from "@/lib/pocketbase";
import type { EventRsvp, RsvpStatus } from "@learnlife/pb-client";
import { Colors, Fonts } from "@/constants/theme";

type Tab = "going" | "waitlist" | "not_going";

const TABS: { key: Tab; label: string; status: RsvpStatus }[] = [
  { key: "going", label: "Going", status: "going" },
  { key: "waitlist", label: "Waitlist", status: "waitlisted" },
  { key: "not_going", label: "Not going", status: "not_going" },
];

export default function EventRosterModal() {
  const { role } = useAuth();
  const params = useLocalSearchParams<{
    recordId: string;
    occurrenceDate?: string;
    title?: string;
  }>();
  const recordId = params.recordId ?? "";
  const occurrenceDate =
    params.occurrenceDate && params.occurrenceDate.length > 0
      ? params.occurrenceDate
      : null;
  const title = params.title ?? "Event";

  const isGuide = role === "lg" || role === "admin";

  const [loading, setLoading] = useState(true);
  const [roster, setRoster] = useState<EventRsvp[]>([]);
  const [tab, setTab] = useState<Tab>("going");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!recordId) {
        setLoading(false);
        return;
      }
      try {
        const list = await fetchRsvpsForOccurrence(recordId, occurrenceDate);
        if (!cancelled) setRoster(list);
      } catch (err) {
        console.error("[event-roster] load failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recordId, occurrenceDate]);

  // Bucket the roster once. Waitlist sorted by position so the modal shows
  // the queue in promotion order; the others fall back to responded_at.
  const bucketed = useMemo(() => {
    const going = roster
      .filter((r) => r.status === "going")
      .sort((a, b) => a.responded_at.localeCompare(b.responded_at));
    const waitlist = roster
      .filter((r) => r.status === "waitlisted")
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const notGoing = roster
      .filter((r) => r.status === "not_going")
      .sort((a, b) => a.responded_at.localeCompare(b.responded_at));
    return { going, waitlist, notGoing };
  }, [roster]);

  const visible =
    tab === "going"
      ? bucketed.going
      : tab === "waitlist"
        ? bucketed.waitlist
        : bucketed.notGoing;

  // Guide gate: kick non-guides out of this modal — it leaks who said "not
  // going", which is private. The List rule on event_rsvps already
  // restricts learners to their own rows; this is just defense-in-depth.
  if (!isGuide) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <Pressable style={s.closeBtn} onPress={() => router.back()}>
            <MaterialIcons name="close" size={20} color={Colors.textPrimary} />
          </Pressable>
          <Text style={s.headerTitle}>Roster</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={s.empty}>
          <Text style={s.emptyText}>This view is for guides only.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.closeBtn} onPress={() => router.back()}>
          <MaterialIcons name="close" size={20} color={Colors.textPrimary} />
        </Pressable>
        <Text style={s.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={s.tabRow}>
        {TABS.map((t) => {
          const count =
            t.key === "going"
              ? bucketed.going.length
              : t.key === "waitlist"
                ? bucketed.waitlist.length
                : bucketed.notGoing.length;
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              style={[s.tabBtn, active && s.tabBtnActive]}
              onPress={() => setTab(t.key)}
            >
              <Text style={[s.tabText, active && s.tabTextActive]}>
                {t.label} {count > 0 && `(${count})`}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={s.empty}>
          <ActivityIndicator color={Colors.lavender} />
        </View>
      ) : visible.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>No one in this list yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.list}>
          {visible.map((r) => {
            const expanded = r.expand?.user;
            const name = expanded?.name ?? expanded?.username ?? r.user;
            return (
              <View key={r.id} style={s.row}>
                {tab === "waitlist" && r.position != null && (
                  <View style={s.posBadge}>
                    <Text style={s.posBadgeText}>#{r.position}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={s.rowName}>{name}</Text>
                  {expanded?.username && expanded.username !== name && (
                    <Text style={s.rowMeta}>@{expanded.username}</Text>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
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
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: Colors.textPrimary,
    fontFamily: Fonts.display,
    letterSpacing: -0.2,
    textAlign: "center",
    paddingHorizontal: 8,
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
    alignItems: "center",
  },
  tabBtnActive: {
    backgroundColor: Colors.lime,
    borderColor: Colors.textPrimary,
    borderWidth: 1.5,
  },
  tabText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.muted,
    fontFamily: Fonts.mono,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  tabTextActive: { color: Colors.purple },

  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.muted,
    fontWeight: "600",
  },

  list: { paddingHorizontal: 20, paddingVertical: 8, gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  posBadge: {
    minWidth: 38,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: Colors.lime,
    alignItems: "center",
  },
  posBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    fontFamily: Fonts.mono,
    color: Colors.purple,
  },
  rowName: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  rowMeta: {
    fontSize: 12,
    color: Colors.muted,
    fontFamily: Fonts.mono,
    fontWeight: "500",
    marginTop: 2,
  },
});
