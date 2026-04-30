import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAuth } from "@/context/AuthContext";
import {
  cancelRsvp,
  deleteCalendarEntry,
  fetchMyRsvp,
  fetchRsvpsForOccurrence,
  getCalendarEntry,
  submitRsvp,
} from "@/lib/pocketbase";
import { countRsvps } from "@learnlife/shared";
import type {
  CalRecord,
  EventRsvp,
  RsvpStatus,
} from "@learnlife/pb-client";
import { Colors, Fonts } from "@/constants/theme";

export default function EventDetailModal() {
  const { user, role } = useAuth();
  const params = useLocalSearchParams<{
    title: string;
    time: string;
    emoji: string;
    color: string;
    recordId: string;
    createdBy?: string;
    occurrenceDate?: string;
  }>();

  const title = params.title ?? "Event";
  const time = params.time ?? "";
  const emoji = params.emoji || "📅";
  const color = params.color || "#4F6B4A";
  const recordId = params.recordId ?? "";
  const createdBy = params.createdBy ?? "";
  // Empty string means "one-off event" — translate to null for queries.
  const occurrenceDate =
    params.occurrenceDate && params.occurrenceDate.length > 0
      ? params.occurrenceDate
      : null;

  const isGuide = role === "lg" || role === "admin";
  const isOwner = !!user?.id && user.id === createdBy;
  const canEdit = !!recordId && (isGuide || isOwner);
  const canDelete = canEdit;

  // ─── State ──────────────────────────────────────────────────────────────
  const [deleting, setDeleting] = useState(false);
  const [calRecord, setCalRecord] = useState<CalRecord | null>(null);
  const [myRsvp, setMyRsvp] = useState<EventRsvp | null>(null);
  const [roster, setRoster] = useState<EventRsvp[]>([]);
  const [submitting, setSubmitting] = useState<RsvpStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Load calendar record + roster + my RSVP. Re-runnable for refresh after
  // submit so the counts and selected state stay in sync with the server.
  const loadAll = useCallback(async () => {
    if (!recordId) {
      setLoading(false);
      return;
    }
    try {
      const [rec, mine, list] = await Promise.all([
        getCalendarEntry(recordId),
        user?.id ? fetchMyRsvp(recordId, occurrenceDate, user.id) : Promise.resolve(null),
        fetchRsvpsForOccurrence(recordId, occurrenceDate).catch(() => [] as EventRsvp[]),
      ]);
      setCalRecord(rec);
      setMyRsvp(mine);
      setRoster(list);
    } catch (err) {
      console.error("[event-detail] load failed", err);
    } finally {
      setLoading(false);
    }
  }, [recordId, occurrenceDate, user?.id]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ─── Derived RSVP state ─────────────────────────────────────────────────
  // Only events (not classes) get RSVP. Classes are personal records and
  // would never have rsvp_enabled set, but we double-gate here so the UI
  // never even tries to render the RSVP block on a class record.
  const rsvpEnabled =
    !!calRecord && calRecord.type === "event" && Boolean(calRecord.rsvp_enabled);

  const capacity =
    calRecord?.capacity != null && calRecord.capacity > 0
      ? calRecord.capacity
      : null;

  const counts = countRsvps(
    // Project EventRsvp shape onto the RsvpEntry shape countRsvps expects.
    roster.map((r) => ({
      id: r.id,
      user: r.user,
      status: r.status,
      position: r.position,
    })),
    capacity,
  );

  const deadlinePassed =
    !!calRecord?.rsvp_deadline &&
    new Date() > new Date(calRecord.rsvp_deadline);

  // ─── Handlers ───────────────────────────────────────────────────────────
  function handleEdit() {
    if (!canEdit) return;
    router.replace({
      pathname: "/(modals)/create-event",
      params: { recordId },
    });
  }

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
            // PB returns 404 for missing-or-denied to avoid leaking existence.
            const status = err?.status ?? err?.response?.status;
            const friendly =
              status === 404
                ? "You don't have permission to delete this event, or it no longer exists."
                : (err?.message ?? "Please try again.");
            console.error("[event-detail] delete failed", {
              recordId,
              status,
              message: err?.message,
              data: err?.response,
            });
            Alert.alert("Failed to delete", friendly);
            setDeleting(false);
          }
        },
      },
    ]);
  }

  async function handleRsvp(choice: "going" | "not_going") {
    if (!user?.id || !rsvpEnabled || deadlinePassed) return;
    setSubmitting(choice);
    try {
      // If user is choosing "not_going" and they have no current row,
      // there's nothing to do — server has nothing to record. Skip the
      // round-trip to avoid creating a not_going row that just sits there.
      // (The server hook would accept it, but it's noise.)
      if (choice === "not_going" && !myRsvp) {
        setSubmitting(null);
        return;
      }
      await submitRsvp({
        eventId: recordId,
        occurrenceDate,
        userId: user.id,
        choice,
      });
      await loadAll();
    } catch (err: any) {
      // Server hook throws BadRequestError with a useful .message — surface it.
      const msg = err?.message ?? "Could not save your RSVP. Please try again.";
      Alert.alert("RSVP failed", msg);
    } finally {
      setSubmitting(null);
    }
  }

  async function handleClearRsvp() {
    if (!myRsvp) return;
    setSubmitting("not_going");
    try {
      await cancelRsvp(myRsvp.id);
      await loadAll();
    } catch (err: any) {
      Alert.alert("Couldn't clear RSVP", err?.message ?? "Please try again.");
    } finally {
      setSubmitting(null);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe}>
      <View style={[s.hero, { backgroundColor: color }]}>
        <Pressable style={s.closeBtn} onPress={() => router.back()}>
          <MaterialIcons name="close" size={20} color={Colors.textPrimary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.bodyScroll}>
        <View style={s.body}>
          <View style={s.pillRow}>
            <View style={s.limePill}>
              <Text style={s.limePillText}>
                {calRecord?.type === "class" ? "CLASS" : "EVENT"}
              </Text>
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

          {/* RSVP section */}
          {loading && (
            <View style={s.rsvpLoading}>
              <ActivityIndicator size="small" color={Colors.lavender} />
            </View>
          )}

          {!loading && rsvpEnabled && (
            <View style={s.rsvpBlock}>
              <Text style={s.label}>RSVP</Text>

              {/* Status banner */}
              <View style={s.rsvpBanner}>
                <Text style={s.rsvpBannerText}>
                  {capacity != null
                    ? `${counts.going}/${capacity} going`
                    : `${counts.going} going`}
                  {counts.waitlisted > 0
                    ? ` · ${counts.waitlisted} waitlisted`
                    : ""}
                </Text>
                {calRecord?.rsvp_deadline && (
                  <Text style={s.rsvpBannerSub}>
                    {deadlinePassed
                      ? "RSVP closed"
                      : `RSVP by ${new Date(
                          calRecord.rsvp_deadline,
                        ).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}`}
                  </Text>
                )}
              </View>

              {/* My RSVP buttons (hidden for guides who created it — they
                  use the roster view instead, but still visible if they're
                  attending themselves). Disabled past the deadline. */}
              {user?.id && !deadlinePassed && (
                <View style={s.rsvpBtnRow}>
                  <Pressable
                    style={[
                      s.rsvpChoice,
                      myRsvp?.status === "going" && s.rsvpChoiceActive,
                      myRsvp?.status === "waitlisted" && s.rsvpChoiceActive,
                      submitting === "going" && s.rsvpChoiceDisabled,
                    ]}
                    disabled={submitting !== null}
                    onPress={() => handleRsvp("going")}
                  >
                    <Text
                      style={[
                        s.rsvpChoiceText,
                        (myRsvp?.status === "going" ||
                          myRsvp?.status === "waitlisted") &&
                          s.rsvpChoiceTextActive,
                      ]}
                    >
                      Going
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      s.rsvpChoice,
                      myRsvp?.status === "not_going" && s.rsvpChoiceActive,
                      submitting === "not_going" && s.rsvpChoiceDisabled,
                    ]}
                    disabled={submitting !== null}
                    onPress={() => handleRsvp("not_going")}
                  >
                    <Text
                      style={[
                        s.rsvpChoiceText,
                        myRsvp?.status === "not_going" &&
                          s.rsvpChoiceTextActive,
                      ]}
                    >
                      Not going
                    </Text>
                  </Pressable>
                </View>
              )}

              {/* User-facing status feedback */}
              {myRsvp?.status === "waitlisted" && myRsvp.position != null && (
                <Text style={s.rsvpFeedback}>
                  You're #{myRsvp.position} on the waitlist
                </Text>
              )}
              {myRsvp?.status === "going" && (
                <Text style={s.rsvpFeedback}>You're going 🎉</Text>
              )}
              {deadlinePassed && (
                <Text style={s.rsvpFeedback}>
                  RSVPs are closed for this event.
                </Text>
              )}

              {/* Clear RSVP — only when there's an existing record */}
              {myRsvp && !deadlinePassed && (
                <Pressable
                  style={s.rsvpClear}
                  disabled={submitting !== null}
                  onPress={handleClearRsvp}
                >
                  <Text style={s.rsvpClearText}>Clear my RSVP</Text>
                </Pressable>
              )}

              {/* Roster link for guides */}
              {isGuide && roster.length > 0 && (
                <Pressable
                  style={s.rosterLink}
                  onPress={() =>
                    router.push({
                      pathname: "/(modals)/event-roster",
                      params: {
                        recordId,
                        occurrenceDate: occurrenceDate ?? "",
                        title,
                      },
                    })
                  }
                >
                  <MaterialIcons name="people" size={18} color={Colors.purple} />
                  <Text style={s.rosterLinkText}>
                    View roster ({roster.length})
                  </Text>
                  <MaterialIcons name="chevron-right" size={18} color={Colors.muted} />
                </Pressable>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <View style={s.actions}>
        {canEdit && (
          <Pressable style={s.editBtn} onPress={handleEdit}>
            <MaterialIcons name="edit" size={20} color={Colors.textPrimary} />
            <Text style={s.editBtnText}>Edit Event</Text>
          </Pressable>
        )}
        {canDelete && (
          <Pressable
            style={[s.deleteBtn, deleting && s.deleteBtnDisabled]}
            onPress={handleDelete}
            disabled={deleting}
          >
            <MaterialIcons name="delete-outline" size={20} color="#FFFFFF" />
            <Text style={s.deleteBtnText}>
              {deleting ? "Deleting..." : "Delete Event"}
            </Text>
          </Pressable>
        )}
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
  bodyScroll: { flexGrow: 1 },
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

  // RSVP section
  rsvpLoading: { paddingVertical: 24, alignItems: "center" },
  rsvpBlock: {
    marginTop: 18,
    gap: 12,
  },
  label: {
    fontSize: 10.5,
    fontWeight: "700",
    color: Colors.muted,
    fontFamily: Fonts.mono,
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  rsvpBanner: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.divider,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  rsvpBannerText: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  rsvpBannerSub: {
    fontSize: 12,
    color: Colors.muted,
    fontFamily: Fonts.mono,
    fontWeight: "600",
  },
  rsvpBtnRow: { flexDirection: "row", gap: 10 },
  rsvpChoice: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.divider,
    alignItems: "center",
  },
  rsvpChoiceActive: {
    backgroundColor: Colors.lime,
    borderColor: Colors.textPrimary,
  },
  rsvpChoiceDisabled: { opacity: 0.5 },
  rsvpChoiceText: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.muted,
    fontFamily: Fonts.mono,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  rsvpChoiceTextActive: { color: Colors.purple },
  rsvpFeedback: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textPrimary,
    textAlign: "center",
  },
  rsvpClear: {
    alignSelf: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  rsvpClearText: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    fontWeight: "600",
    color: Colors.muted,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    textDecorationLine: "underline",
  },
  rosterLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.surface2,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rosterLinkText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: Colors.purple,
  },

  actions: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 10,
  },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.textPrimary,
    borderRadius: 999,
    paddingVertical: 14,
  },
  editBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
    fontFamily: Fonts.display,
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
