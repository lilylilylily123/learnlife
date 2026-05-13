"use client";
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { pb } from "./pb";
import { RecordModel } from "pocketbase";
import { createLearner } from "./utils/utils";
import { getVersion } from "@tauri-apps/api/app";
import { useNfcLearner } from "./hooks/useNfcLearner";
import { useAttendanceFilters } from "./hooks/useAttendanceFilters";
import Account from "./components/Account";
import CreateLearnerModal from "./components/CreateLearnerModal";
import { TestModePanel } from "./components/TestModePanel";
import * as pbClient from "@/lib/pb-client";
import { UpdateNotification } from "./components/UpdateNotification";
import { ActivityFeed, type ActivityEvent } from "./components/ActivityFeed";
import { AttenderD } from "./components/AttenderD";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { JustificationModal } from "./components/JustificationModal";
import type { Student } from "./types";
import { deriveStatus, findLearnersToMarkAbsent } from "@learnlife/shared";
import {
  TIME_THRESHOLDS,
  type ArrivalStatus,
  type AttendanceStatus,
} from "@learnlife/pb-client";

// Diff two attendance row snapshots and return the ActionType that occurred,
// or null if no meaningful change. Used to synthesise Live Activity entries
// from PocketBase realtime events so any scanner (local USB reader OR the
// standalone ESP32 firmware) populates the feed. The "auto_absent" branch
// catches sweep-generated writes where arrival flips to "absent" with no
// time_in — distinct from a guide pressing the A button.
function inferAttendanceAction(
  prev: any,
  next: any,
): "check_in" | "check_out" | "lunch_event" | "late_lunch_return" | "auto_absent" | null {
  if (!prev?.time_in && next?.time_in) return "check_in";
  if (!prev?.time_out && next?.time_out) return "check_out";
  const prevEvents: any[] = Array.isArray(prev?.lunch_events) ? prev.lunch_events : [];
  const nextEvents: any[] = Array.isArray(next?.lunch_events) ? next.lunch_events : [];
  if (nextEvents.length > prevEvents.length) {
    const last = nextEvents[nextEvents.length - 1];
    if (last?.type === "in" && next.lunch_status === "late") {
      return "late_lunch_return";
    }
    return "lunch_event";
  }
  if (
    prev?.arrival !== "absent" &&
    next?.arrival === "absent" &&
    !next?.time_in
  ) {
    return "auto_absent";
  }
  return null;
}

// Map a legacy 5-enum status (the value the P/L/A/JL/JA buttons emit) to the
// canonical split-field pair. Clicking a button writes the corresponding pair.
const STATUS_BUTTON_MAP: Record<AttendanceStatus, { arrival: ArrivalStatus; justified: boolean }> = {
  present: { arrival: "present", justified: false },
  late: { arrival: "late", justified: false },
  absent: { arrival: "absent", justified: false },
  jLate: { arrival: "late", justified: true },
  jAbsent: { arrival: "absent", justified: true },
};

export default function AttendancePage() {
  // Auth / app state
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("");
  const router = useRouter();

  // Test mode
  const [testMode, setTestMode] = useState(false);
  const [testTime, setTestTime] = useState<Date | null>(null);
  const [testDate, setTestDate] = useState<string | null>(null);
  const viewDate =
    testMode && testDate ? testDate : new Date().toISOString().split("T")[0];

  // NFC hook (lastAction is consumed via the PocketBase realtime listener
  // below — every tap lands in PB and is read back through the subscription
  // so external scanners light up the Activity feed too.)
  const nfcOptions = testMode ? { testTime, testDate } : undefined;
  const { uid, learner, exists, isLoading, simulateScan } =
    useNfcLearner(nfcOptions);

  // Activity feed
  const [showActivityFeed, setShowActivityFeed] = useState(false);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);

  // Pagination
  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(500);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);

  // Raw data
  const [students, setStudents] = useState<RecordModel[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, any>>({});
  // Initial-fetch lifecycle for skeletons + retry banner. `hasLoadedOnce`
  // flips after the first successful learners+attendance fetch so subsequent
  // refreshes don't reintroduce the placeholders.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Justification modal — opens when a guide clicks the "add reason" icon next
  // to a justified status. Stores the learner whose reason we're editing.
  const [justifyingLearnerId, setJustifyingLearnerId] = useState<string | null>(null);
  // Lift the error out of the modal's local state so a failed save doesn't
  // close the modal and lose the user's input (review #2).
  const [justifyError, setJustifyError] = useState<string | null>(null);

  // Update auth state after mount to avoid hydration mismatch.
  // Treat learner-role accounts as logged out — nfc-attender is a guide tool.
  useEffect(() => {
    const isPrivileged = () => {
      const role = (pb.authStore.record as { role?: string } | null)?.role;
      return pb.authStore.isValid && (role === "admin" || role === "lg");
    };
    setIsLoggedIn(isPrivileged());
    const unsubscribe = pb.authStore.onChange(() => setIsLoggedIn(isPrivileged()));
    getVersion().then(setAppVersion).catch(() => {});
    return () => unsubscribe();
  }, []);

  // Filters hook (needs studentsWithAttendance; we use a two-pass pattern below)
  const studentsWithAttendance = useMemo<Student[]>(() => {
    const merged = students.map((s) => {
      const attendance = attendanceMap[s.id] || {};
      return {
        ...s,
        time_in: attendance.time_in || null,
        time_out: attendance.time_out || null,
        lunch_in: attendance.lunch_in || null,
        lunch_out: attendance.lunch_out || null,
        lunch_events: attendance.lunch_events || null,
        status: attendance.status || null,
        lunch_status: attendance.lunch_status || null,
        arrival: attendance.arrival ?? null,
        justified: Boolean(attendance.justified),
        justification_reason: attendance.justification_reason ?? null,
        justified_by: attendance.justified_by ?? null,
        justified_at: attendance.justified_at ?? null,
        attendanceId: attendance.id || null,
      } as Student & { attendanceId: string | null };
    });
    return merged.sort((a, b) => a.name.localeCompare(b.name));
  }, [students, attendanceMap]);

  const {
    search,
    setSearch,
    debouncedSearch,
    programFilter,
    setProgramFilter,
    attendanceFilter,
    setAttendanceFilter,
    filtered,
    attendanceCounts,
  } = useAttendanceFilters(studentsWithAttendance);

  // Fetch learners. Errors are captured into `fetchError` so the dashboard
  // surfaces a retry banner — silently logging would leave the user staring
  // at a perpetually-empty list.
  const fetchLearners = useCallback(async () => {
    try {
      const result = await pbClient.listLearners({
        page,
        perPage,
        search: debouncedSearch.trim() || undefined,
        program: programFilter !== "all" ? programFilter : undefined,
      });
      setStudents(result.items as unknown as RecordModel[]);
      setTotalItems(result.totalItems);
      setTotalPages(result.totalPages);
      return true;
    } catch (error) {
      console.error("Error fetching learners:", error);
      setFetchError(
        error instanceof Error
          ? `Couldn't load learners: ${error.message}`
          : "Couldn't load learners.",
      );
      return false;
    }
  }, [page, perPage, debouncedSearch, programFilter]);

  // Fetch attendance
  const fetchAttendance = useCallback(async () => {
    try {
      const result = await pbClient.listAttendance({
        date: viewDate,
        perPage: 500,
      });
      const map: Record<string, any> = {};
      for (const record of result.items) {
        map[record.learner] = record;
      }
      setAttendanceMap(map);
      return true;
    } catch (error) {
      console.error("Error fetching attendance:", error);
      setFetchError(
        error instanceof Error
          ? `Couldn't load attendance: ${error.message}`
          : "Couldn't load attendance.",
      );
      return false;
    }
  }, [viewDate]);

  // Wrapper used by the retry banner — clears the error optimistically, runs
  // both fetches, and only flips `hasLoadedOnce` once both succeed so the
  // skeleton stays visible during a recovery attempt.
  const retryFetch = useCallback(async () => {
    setFetchError(null);
    const [a, b] = await Promise.all([fetchLearners(), fetchAttendance()]);
    if (a && b) setHasLoadedOnce(true);
  }, [fetchLearners, fetchAttendance]);

  // Initial data fetch
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    (async () => {
      const [a, b] = await Promise.all([fetchLearners(), fetchAttendance()]);
      if (cancelled) return;
      if (a && b) setHasLoadedOnce(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchLearners, fetchAttendance, isLoggedIn]);

  // Refresh attendance after NFC scan completes
  useEffect(() => {
    if (!isLoading && learner && isLoggedIn) {
      const timer = setTimeout(() => fetchAttendance(), 500);
      return () => clearTimeout(timer);
    }
  }, [isLoading, learner, fetchAttendance, isLoggedIn]);

  // Keep refs to the latest fetch functions + state snapshots so the
  // PocketBase realtime subscription can diff against current state without
  // resubscribing on every render.
  const fetchLearnersRef = useRef(fetchLearners);
  const fetchAttendanceRef = useRef(fetchAttendance);
  const attendanceMapRef = useRef(attendanceMap);
  const studentsRef = useRef(students);
  useEffect(() => { fetchLearnersRef.current = fetchLearners; }, [fetchLearners]);
  useEffect(() => { fetchAttendanceRef.current = fetchAttendance; }, [fetchAttendance]);
  useEffect(() => { attendanceMapRef.current = attendanceMap; }, [attendanceMap]);
  useEffect(() => { studentsRef.current = students; }, [students]);

  // Subscribe to real-time PocketBase changes once per login session
  useEffect(() => {
    if (!isLoggedIn) return;

    let learnersTimer: ReturnType<typeof setTimeout> | null = null;
    let attendanceTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const setup = async () => {
      try {
        const unsubLearners = await pb
          .collection("learners")
          .subscribe("*", () => {
            if (learnersTimer) clearTimeout(learnersTimer);
            learnersTimer = setTimeout(() => fetchLearnersRef.current(), 1000);
          });
        const unsubAttendance = await pb
          .collection("attendance")
          .subscribe("*", (e) => {
            if (attendanceTimer) clearTimeout(attendanceTimer);
            attendanceTimer = setTimeout(() => fetchAttendanceRef.current(), 1000);

            // Synthesise a Live Activity entry for every scan that lands in
            // PB, regardless of which device wrote it. Local USB-reader scans
            // flow through here too (with a small RTT), so this is the single
            // source of truth for the feed — the lastAction-based path it
            // used to use is gone.
            if (e.action !== "create" && e.action !== "update") return;
            const rec = e.record as any;
            const learnerId = rec?.learner;
            if (!learnerId) return;
            const prev = attendanceMapRef.current[learnerId] ?? {};
            const actionType = inferAttendanceAction(prev, rec);
            if (!actionType) return;
            const student = studentsRef.current.find((s) => s.id === learnerId);
            const name = (student as any)?.name ?? learnerId;
            const program = ((student as any)?.program as string) ?? "";
            setActivityEvents((arr) => [
              ...arr.slice(-49),
              {
                id: `${rec.id}-${actionType}-${Date.now()}`,
                learnerName: name,
                program,
                actionType,
                timestamp: new Date(),
                status: rec.status ?? undefined,
              },
            ]);
          });

        if (cancelled) {
          // Page navigated away while subscribe() was awaiting. Tear the
          // freshly-created subscriptions down quietly — calling unsub on a
          // half-dead client can itself 404, which is harmless.
          try {
            unsubLearners();
            unsubAttendance();
          } catch {}
          return;
        }

        cleanup.unsub = () => {
          try {
            unsubLearners();
            unsubAttendance();
          } catch {}
        };
      } catch (err) {
        // PocketBase realtime can 404 with "Missing or invalid client id"
        // during fast navigation when the SSE client_id goes stale. Logging
        // the cause here is enough — the next page load will re-subscribe.
        console.warn("Realtime subscribe failed:", err);
      }
    };

    const cleanup: { unsub?: () => void } = {};
    setup();

    return () => {
      cancelled = true;
      if (learnersTimer) clearTimeout(learnersTimer);
      if (attendanceTimer) clearTimeout(attendanceTimer);
      cleanup.unsub?.();
    };
  }, [isLoggedIn]);

  // ── Auto-absent sweep ────────────────────────────────────────────────────
  // Server-side PB cron isn't available in this hosting setup, so the dashboard
  // itself runs the sweep on a 1-minute timer while open. The sweep is
  // idempotent (findLearnersToMarkAbsent skips anyone who already has a
  // recorded state) and gated to once-per-day via lastSweptDateRef — but only
  // after every write succeeded. A partial failure leaves the ref unchanged
  // so the next tick retries the laggards (review #6).
  const lastSweptDateRef = useRef<string | null>(null);

  const runAbsentSweep = useCallback(async () => {
    // Only sweep when we're looking at *today* — historical view modes must
    // never trigger a write against the real-time dashboard's date.
    const todayStr = new Date().toISOString().split("T")[0];
    if (viewDate !== todayStr) return;
    if (lastSweptDateRef.current === todayStr) return;

    const now = testMode && testTime ? testTime : new Date();
    const records = Object.values(attendanceMapRef.current) as any[];
    const learners = studentsRef.current.map((s) => ({ id: s.id }));

    const toMark = findLearnersToMarkAbsent(records, learners, now);

    // Compute "past the cutoff" using the threshold constants (review #5).
    const hour = now.getHours();
    const minute = now.getMinutes();
    const pastCutoff =
      hour > TIME_THRESHOLDS.ABSENT_HOUR ||
      (hour === TIME_THRESHOLDS.ABSENT_HOUR && minute >= TIME_THRESHOLDS.ABSENT_MINUTE);
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;

    if (toMark.length === 0) {
      // Nothing to do; only "close the day" when we're past the cutoff on a
      // weekday — otherwise leave the ref unchanged so the next tick retries.
      if (pastCutoff && !isWeekend) {
        lastSweptDateRef.current = todayStr;
      }
      return;
    }

    console.log(`[auto-absent] marking ${toMark.length} learner(s) absent for ${todayStr}`);
    let okCount = 0;
    const failedIds: string[] = [];
    for (const learnerId of toMark) {
      try {
        await pbClient.batchUpdateAttendance({
          learnerId,
          date: todayStr,
          fields: {
            arrival: "absent",
            justified: false,
            status: "absent",
          },
        });
        okCount++;
      } catch (err) {
        failedIds.push(learnerId);
        console.error(`[auto-absent] failed for ${learnerId}:`, err);
      }
    }
    console.log(`[auto-absent] ${okCount}/${toMark.length} succeeded`);
    // Only close the day when every learner was written successfully — a
    // partial failure means the next tick should retry the laggards.
    if (failedIds.length === 0) {
      lastSweptDateRef.current = todayStr;
    } else {
      console.warn(`[auto-absent] will retry next tick for: ${failedIds.join(", ")}`);
    }
  }, [viewDate, testMode, testTime]);

  useEffect(() => {
    if (!isLoggedIn) return;
    // Fire once on mount (so a dashboard opened after noon catches up
    // immediately) and then every minute.
    const tick = () => { runAbsentSweep().catch(() => {}); };
    tick();
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, [isLoggedIn, runAbsentSweep]);

  // Update attendance field via PocketBase
  const updateAttendance = useCallback(
    async (
      learnerId: string,
      field: string,
      options?: { value?: string; timestamp?: string },
    ): Promise<{ wrote: boolean; value?: string; attendance?: any }> => {
      try {
        const fieldValue = options?.timestamp || options?.value || "";
        const { attendance } = await pbClient.batchUpdateAttendance({
          learnerId,
          date: viewDate,
          fields: { [field]: fieldValue },
        });
        return { wrote: true, value: fieldValue, attendance };
      } catch (err) {
        console.error("[updateAttendance] call failed", err);
        return { wrote: false };
      }
    },
    [viewDate],
  );

  const handleSetStatus = useCallback(
    async (
      id: string,
      status: string,
      field: "status" | "lunch_status" = "status",
      toggle: boolean = true,
    ) => {
      // Lunch status keeps the legacy single-enum model — only morning status
      // gets the split arrival/justified treatment.
      if (field === "lunch_status") {
        const prevLunch = attendanceMap[id]?.lunch_status;
        const newLunch = toggle && prevLunch === status ? "" : status;
        setAttendanceMap((prev) => ({
          ...prev,
          [id]: { ...prev[id], lunch_status: newLunch || null },
        }));
        try {
          await pbClient.batchUpdateAttendance({
            learnerId: id,
            date: viewDate,
            fields: { lunch_status: newLunch },
          });
        } catch (err) {
          console.error("Failed to save lunch status", err);
          setAttendanceMap((prev) => ({
            ...prev,
            [id]: { ...prev[id], lunch_status: prevLunch },
          }));
        }
        return;
      }

      const target = STATUS_BUTTON_MAP[status as AttendanceStatus];
      if (!target) {
        console.warn(`handleSetStatus: unknown status "${status}"`);
        return;
      }

      const prevRecord = attendanceMap[id] || {};
      const prevArrival = (prevRecord.arrival ?? null) as ArrivalStatus | null;
      const prevJustified = Boolean(prevRecord.justified);
      const prevStatus = prevRecord.status || null;

      // Toggle: clicking the button that exactly matches the current state
      // clears the day. Anything else applies the button's target pair.
      const matches = prevArrival === target.arrival && prevJustified === target.justified;
      const next = toggle && matches
        ? { arrival: null as ArrivalStatus | null, justified: false }
        : target;

      const nextStatus = deriveStatus(next.arrival, next.justified);

      // Optimistic UI update.
      setAttendanceMap((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          arrival: next.arrival,
          justified: next.justified,
          status: nextStatus,
        },
      }));

      // Only set justified_by / justified_at when we're flipping it on.
      const userId = pb.authStore.record?.id;
      const patch: Record<string, unknown> = {
        arrival: next.arrival,
        justified: next.justified,
        status: nextStatus,
      };
      if (next.justified && !prevJustified) {
        patch.justified_by = userId || null;
        patch.justified_at = new Date().toISOString();
      }

      try {
        await pbClient.batchUpdateAttendance({
          learnerId: id,
          date: viewDate,
          fields: patch,
        });
      } catch (err: any) {
        if (err?.status === 429) {
          await new Promise((r) => setTimeout(r, 1000));
          try {
            await pbClient.batchUpdateAttendance({
              learnerId: id,
              date: viewDate,
              fields: patch,
            });
            return;
          } catch (retryErr) {
            console.error("Retry failed:", retryErr);
          }
        }
        console.error("Failed to save status", err);
        // Roll back the optimistic update on failure.
        setAttendanceMap((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            arrival: prevArrival,
            justified: prevJustified,
            status: prevStatus,
          },
        }));
      }
    },
    [viewDate, attendanceMap],
  );

  // Push a manual action into the activity feed
  const pushActivityEvent = useCallback(
    (learnerId: string, action: string, status?: string) => {
      const student = students.find((s) => s.id === learnerId);
      if (!student) return;
      setActivityEvents((prev) => [
        ...prev.slice(-49),
        {
          id: `${Date.now()}-${student.name}`,
          learnerName: student.name,
          program: (student.program as string) || "",
          actionType: action,
          timestamp: new Date(),
          status,
        },
      ]);
    },
    [students],
  );

  const handleCheckAction = useCallback(
    async (id: string, action: string) => {
      const now = testMode && testTime ? testTime : new Date();
      const attendance = attendanceMap[id] || {};
      const { time_in, time_out, lunch_events } = attendance;
      const lunchEventsArray = lunch_events || [];

      try {
        if (action === "morning-in") {
          if (time_in) return;
          // Single atomic write — set time_in + arrival + (derived) status in
          // one PB call so the realtime subscription never observes a record
          // with time_in present but arrival/status still null.
          const lateTime = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            TIME_THRESHOLDS.LATE_HOUR,
            TIME_THRESHOLDS.LATE_MINUTE,
            0,
            0,
          );
          const isLate = now.getTime() >= lateTime.getTime();
          const arrival: ArrivalStatus = isLate ? "late" : "present";
          // Preserve any prior justification — see state-machine for the
          // same invariant when an NFC scan beats a pre-marked jAbsent.
          const wasJustified =
            attendance.justified === true ||
            attendance.status === "jLate" ||
            attendance.status === "jAbsent";
          const status = deriveStatus(arrival, wasJustified) as AttendanceStatus;
          const timestamp = now.toISOString();

          setAttendanceMap((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              time_in: timestamp,
              arrival,
              justified: wasJustified,
              status,
            },
          }));

          try {
            await pbClient.batchUpdateAttendance({
              learnerId: id,
              date: viewDate,
              fields: {
                time_in: timestamp,
                arrival,
                justified: wasJustified,
                status,
              },
            });
            pushActivityEvent(id, "morning-in", status);
          } catch (err) {
            setAttendanceMap((prev) => ({
              ...prev,
              [id]: {
                ...prev[id],
                time_in: null,
                arrival: attendance.arrival ?? null,
                justified: Boolean(attendance.justified),
                status: attendance.status ?? null,
              },
            }));
            throw err;
          }
        } else if (action === "lunch-out" || action === "lunch-in") {
          if (!time_in) return;
          const lastEvent =
            lunchEventsArray.length > 0
              ? lunchEventsArray[lunchEventsArray.length - 1]
              : null;
          const nextEventType: "out" | "in" =
            !lastEvent || lastEvent.type === "in" ? "out" : "in";
          const eventType =
            action === "lunch-out" ? ("out" as const) : ("in" as const);
          if (eventType !== nextEventType) return;
          const newEvent = { type: eventType, time: now.toISOString() };
          const updatedEvents = [...lunchEventsArray, newEvent];

          // Compute lunch_status atomically when returning from lunch.
          const lunchPatch: Record<string, unknown> = {
            lunch_events: JSON.stringify(updatedEvents),
          };
          let computedLunchStatus: AttendanceStatus | null = null;
          if (eventType === "in") {
            const lunchLateTime = new Date(
              now.getFullYear(),
              now.getMonth(),
              now.getDate(),
              TIME_THRESHOLDS.LUNCH_LATE_HOUR,
              TIME_THRESHOLDS.LUNCH_LATE_MINUTE,
              0,
              0,
            );
            computedLunchStatus =
              now.getTime() >= lunchLateTime.getTime() ? "late" : "present";
            lunchPatch.lunch_status = computedLunchStatus;
          }

          setAttendanceMap((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              lunch_events: updatedEvents,
              ...(computedLunchStatus
                ? { lunch_status: computedLunchStatus }
                : {}),
            },
          }));
          try {
            await pbClient.batchUpdateAttendance({
              learnerId: id,
              date: viewDate,
              fields: lunchPatch,
            });
            if (eventType === "in") {
              pushActivityEvent(id, "lunch-in", computedLunchStatus ?? undefined);
            } else {
              pushActivityEvent(id, "lunch-out");
            }
            fetchAttendance();
          } catch (err) {
            setAttendanceMap((prev) => ({
              ...prev,
              [id]: {
                ...prev[id],
                lunch_events: lunchEventsArray,
                lunch_status: attendance.lunch_status ?? null,
              },
            }));
            throw err;
          }
        } else if (action === "day-out") {
          if (!time_in || time_out) return;
          const timestamp = now.toISOString();
          setAttendanceMap((prev) => ({
            ...prev,
            [id]: { ...prev[id], time_out: timestamp },
          }));
          try {
            await pbClient.batchUpdateAttendance({
              learnerId: id,
              date: viewDate,
              fields: { time_out: timestamp },
            });
            pushActivityEvent(id, "day-out");
          } catch (err) {
            setAttendanceMap((prev) => ({
              ...prev,
              [id]: { ...prev[id], time_out: null },
            }));
            throw err;
          }
        }
      } catch (err) {
        console.error("check action failed", err);
      }
    },
    [
      attendanceMap,
      testMode,
      testTime,
      viewDate,
      fetchAttendance,
      pushActivityEvent,
    ],
  );

  const handleReset = useCallback(
    async (id: string) => {
      try {
        await pbClient.resetAttendance(id, viewDate);
        fetchAttendance();
      } catch (err) {
        console.error("Reset failed", err);
      }
    },
    [viewDate, fetchAttendance],
  );

  const handleCommentUpdate = useCallback(
    async (id: string, comment: string) => {
      const previousComment = attendanceMap[id]?.comments;
      setAttendanceMap((prev) => ({
        ...prev,
        [id]: { ...prev[id], comments: comment },
      }));
      try {
        await pbClient.updateLearnerComment(id, comment);
        fetchAttendance();
      } catch (err) {
        console.error("Failed to update comment:", err);
        setAttendanceMap((prev) => ({
          ...prev,
          [id]: { ...prev[id], comments: previousComment },
        }));
        throw err;
      }
    },
    [fetchAttendance, attendanceMap],
  );

  const handleTimeEdit = useCallback(
    async (
      learnerId: string,
      field: "time_in" | "time_out",
      timeStr: string,
    ) => {
      if (!timeStr) return;
      const [h, m] = timeStr.split(":").map(Number);
      const d = new Date(`${viewDate}T00:00:00`);
      d.setHours(h, m, 0, 0);
      const timestamp = d.toISOString();
      const previousValue = attendanceMap[learnerId]?.[field];
      setAttendanceMap((prev) => ({
        ...prev,
        [learnerId]: { ...prev[learnerId], [field]: timestamp },
      }));
      try {
        await pbClient.batchUpdateAttendance({
          learnerId,
          date: viewDate,
          fields: { [field]: timestamp },
        });
      } catch (err) {
        console.error("Failed to update time:", err);
        setAttendanceMap((prev) => ({
          ...prev,
          [learnerId]: { ...prev[learnerId], [field]: previousValue },
        }));
      }
    },
    [viewDate, attendanceMap],
  );

  async function handleCreateLearner(
    name: string,
    email: string,
    program: string,
    dob: string,
    nfcUid: string,
  ) {
    await createLearner(name, email, program, dob, nfcUid);
  }

  // Persist a justification reason. Only closes the modal on success — a
  // network blip surfaces inline so the user doesn't lose their typed reason
  // (review #2).
  const handleSaveJustificationReason = useCallback(
    async (reason: string) => {
      if (!justifyingLearnerId) return;
      const record = attendanceMap[justifyingLearnerId];
      if (!record?.id) {
        setJustifyError("No attendance record yet — mark the day with a status first.");
        return;
      }
      const userId = pb.authStore.record?.id || "";
      setJustifyError(null);
      try {
        const updated = await pbClient.justifyAttendance({
          attendanceId: record.id,
          justified: Boolean(record.justified),
          reason,
          userId,
        });
        setAttendanceMap((prev) => ({
          ...prev,
          [justifyingLearnerId]: { ...prev[justifyingLearnerId], ...updated },
        }));
        setJustifyingLearnerId(null);
      } catch (err: any) {
        console.error("Failed to save reason:", err);
        setJustifyError(err?.message || "Failed to save — please try again.");
      }
    },
    [justifyingLearnerId, attendanceMap],
  );

  if (!isLoggedIn) {
    return <Account />;
  }

  return (
    <>
      <UpdateNotification />

      <ErrorBoundary label="dashboard">
      <AttenderD
        appVersion={appVersion}
        viewDate={viewDate}
        testMode={testMode}
        uid={uid}
        exists={exists}
        search={search}
        setSearch={setSearch}
        programFilter={programFilter}
        setProgramFilter={setProgramFilter}
        attendanceFilter={attendanceFilter}
        setAttendanceFilter={setAttendanceFilter}
        attendanceCounts={attendanceCounts}
        filtered={filtered}
        totalItems={totalItems}
        page={page}
        perPage={perPage}
        totalPages={totalPages}
        setPage={setPage}
        setPerPage={setPerPage}
        activityEvents={activityEvents}
        onShowActivityFeed={() => setShowActivityFeed((v) => !v)}
        onShowAddLearner={() => setShowModal(true)}
        onShowHistory={() => router.push("/history")}
        onLogout={() => pb.authStore.clear()}
        onToggleTestMode={() => {
          setTestMode((t) => !t);
          if (testMode) {
            setTestTime(null);
            setTestDate(null);
          }
        }}
        onCheckAction={handleCheckAction}
        onStatusChange={handleSetStatus}
        onCommentUpdate={handleCommentUpdate}
        onTimeEdit={handleTimeEdit}
        onReset={handleReset}
        onOpenJustification={(id: string) => {
          setJustifyError(null);
          setJustifyingLearnerId(id);
        }}
        isInitialLoading={!hasLoadedOnce && !fetchError}
        fetchError={fetchError}
        onRetryFetch={retryFetch}
      />
      </ErrorBoundary>

      {testMode && (
        <div
          className="fixed bottom-4 left-4 right-4 z-30"
          style={{ maxWidth: 720, margin: "0 auto" }}
        >
          <TestModePanel
            testDate={testDate}
            testTime={testTime}
            viewDate={viewDate}
            students={students}
            isLoading={isLoading}
            setTestDate={setTestDate}
            setTestTime={setTestTime}
            simulateScan={simulateScan}
          />
        </div>
      )}

      {showActivityFeed && (
        <ActivityFeed
          events={activityEvents}
          onClose={() => setShowActivityFeed(false)}
        />
      )}

      <CreateLearnerModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreate={handleCreateLearner}
        uid={uid}
      />

      {/* Justification reason modal. justifiedByName resolves the user FK
          via the currently-logged-in user (matches the common case where the
          guide who applies it is also the guide reading it back). */}
      {justifyingLearnerId && (() => {
        const rec = attendanceMap[justifyingLearnerId];
        const learner = students.find((s) => s.id === justifyingLearnerId);
        const me = pb.authStore.record as { id?: string; name?: string } | null;
        const justifiedByName =
          rec?.expand?.justified_by?.name ||
          (rec?.justified_by && me?.id === rec.justified_by ? me?.name : null) ||
          null;
        return (
          <JustificationModal
            learnerName={(learner as any)?.name || "Learner"}
            currentReason={rec?.justification_reason || ""}
            justifiedByName={justifiedByName}
            justifiedAt={rec?.justified_at || null}
            error={justifyError}
            onSave={handleSaveJustificationReason}
            onClose={() => {
              setJustifyingLearnerId(null);
              setJustifyError(null);
            }}
          />
        );
      })()}
    </>
  );
}
