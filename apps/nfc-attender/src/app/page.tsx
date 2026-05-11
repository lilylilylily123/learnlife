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
import { AttendanceFilterPills } from "./components/AttendanceFilterPills";
import { LearnerGrid } from "./components/LearnerGrid";
import { LearnerListView } from "./components/LearnerListView";
import { JustificationModal } from "./components/JustificationModal";
import * as pbClient from "@/lib/pb-client";
import { UpdateNotification } from "./components/UpdateNotification";
import { ActivityFeed, type ActivityEvent } from "./components/ActivityFeed";
import type { Student } from "./types";
import {
  deriveStatus,
  findLearnersToMarkAbsent,
} from "@learnlife/shared";
import type { ArrivalStatus, AttendanceStatus } from "@learnlife/pb-client";

// Diff two attendance row snapshots and return the ActionType that occurred,
// or null if no meaningful change. Mirrors the state-machine action keys used
// by ActivityFeed's ACTION_CONFIG (check_in, check_out, lunch_event,
// late_lunch_return). Also catches the sweep's auto_absent transition where
// arrival flips to "absent" without any time_in being written.
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
  // Auto-absent sweep: arrival flips to "absent" with no time_in. Distinct
  // from a guide clicking A manually so the activity feed can label it.
  if (
    prev?.arrival !== "absent" &&
    next?.arrival === "absent" &&
    !next?.time_in
  ) {
    return "auto_absent";
  }
  return null;
}

// Map a status button label (the legacy 5-enum) to the canonical split-field
// representation. Clicking P/L/A/JL/JA writes the corresponding pair below.
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

  // NFC hook
  const nfcOptions = testMode ? { testTime, testDate } : undefined;
  const { uid, learner, exists, isLoading, lastAction, simulateScan } =
    useNfcLearner(nfcOptions);

  // Activity feed
  const [showActivityFeed, setShowActivityFeed] = useState(false);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);

  // Pagination
  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(500);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);

  // View mode
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");

  // Raw data
  const [students, setStudents] = useState<RecordModel[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, any>>({});

  // Justification modal — opens when a guide clicks the "add note" icon next
  // to a justified status. Stores the learner whose reason we're editing.
  const [justifyingLearnerId, setJustifyingLearnerId] = useState<string | null>(null);

  // Update auth state after mount to avoid hydration mismatch
  useEffect(() => {
    setIsLoggedIn(pb.authStore.isValid);
    const unsubscribe = pb.authStore.onChange(() =>
      setIsLoggedIn(pb.authStore.isValid),
    );
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

  // Fetch learners
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
    } catch (error) {
      console.error("Error fetching learners:", error);
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
    } catch (error) {
      console.error("Error fetching attendance:", error);
    }
  }, [viewDate]);

  // Initial data fetch
  useEffect(() => {
    if (isLoggedIn) {
      fetchLearners();
      fetchAttendance();
    }
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

          // Synthesise a Live Activity entry for every scan that lands in PB,
          // regardless of which device wrote it. Local USB-reader scans flow
          // through here too (with a small RTT), so this is the single source
          // of truth for the feed; the desktop kiosk no longer needs the
          // lastAction-based path it used to use.
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
        unsubLearners();
        unsubAttendance();
        return;
      }

      cleanup.unsub = () => {
        unsubLearners();
        unsubAttendance();
      };
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
  // Server-side PB cron is unreliable in this hosting setup, so the dashboard
  // itself runs the sweep on a 1-minute timer while open. The sweep is
  // idempotent (findLearnersToMarkAbsent skips anyone who already has a
  // recorded state) and gated to once-per-day via lastSweptDateRef. Front-desk
  // dashboards are open all school day, so this fires reliably in practice.
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
    if (toMark.length === 0) {
      // Pre-noon or weekend: don't claim the day as swept; try again later.
      const hour = now.getHours();
      const past = hour >= 12;
      if (past && now.getDay() !== 0 && now.getDay() !== 6) {
        lastSweptDateRef.current = todayStr;
      }
      return;
    }

    console.log(`[auto-absent] marking ${toMark.length} learner(s) absent for ${todayStr}`);
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
      } catch (err) {
        console.error(`[auto-absent] failed for ${learnerId}:`, err);
      }
    }
    lastSweptDateRef.current = todayStr;
    // Realtime subscription will pick up the writes and refresh the UI.
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
      // Lunch status stays on the legacy single-enum model — only morning
      // status gets the split arrival/justified treatment.
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
      const userId = pb.authStore.model?.id;
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
          const lateTime = new Date(
            now.getFullYear(), now.getMonth(), now.getDate(), 10, 1, 0, 0,
          );
          const isLate = now.getTime() >= lateTime.getTime();
          const status = isLate ? "late" : "present";
          const timestamp = now.toISOString();
          setAttendanceMap((prev) => ({
            ...prev,
            [id]: { ...prev[id], time_in: timestamp, status },
          }));
          const result = await updateAttendance(id, "time_in", { timestamp });
          if (!result.wrote) {
            setAttendanceMap((prev) => ({
              ...prev,
              [id]: { ...prev[id], time_in: undefined, status: undefined },
            }));
            return;
          }
          await handleSetStatus(id, status, "status", false);
          pushActivityEvent(id, "morning-in", status);
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
          setAttendanceMap((prev) => ({
            ...prev,
            [id]: { ...prev[id], lunch_events: updatedEvents },
          }));
          try {
            await pbClient.batchUpdateAttendance({
              learnerId: id,
              date: viewDate,
              fields: { lunch_events: JSON.stringify(updatedEvents) },
            });
            if (eventType === "in") {
              const lunchLateTime = new Date(now);
              lunchLateTime.setHours(14, 1, 0, 0);
              const lunchStatus = now >= lunchLateTime ? "late" : "present";
              await handleSetStatus(id, lunchStatus, "lunch_status", false);
              pushActivityEvent(id, "lunch-in", lunchStatus);
            } else {
              pushActivityEvent(id, "lunch-out");
            }
            fetchAttendance();
          } catch (err) {
            setAttendanceMap((prev) => ({
              ...prev,
              [id]: { ...prev[id], lunch_events: lunchEventsArray },
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
            await updateAttendance(id, "time_out", { timestamp });
            pushActivityEvent(id, "day-out");
          } catch (err) {
            setAttendanceMap((prev) => ({
              ...prev,
              [id]: { ...prev[id], time_out: undefined },
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
      updateAttendance,
      handleSetStatus,
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

  // Persist a justification reason for the currently-modal-edited learner.
  // Uses the dedicated justifyAttendance helper so justified_by/_at land too.
  const handleSaveJustificationReason = useCallback(
    async (reason: string) => {
      if (!justifyingLearnerId) return;
      const record = attendanceMap[justifyingLearnerId];
      if (!record?.id) {
        console.warn("No attendance record to attach reason to");
        return;
      }
      const userId = pb.authStore.model?.id || "";
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
      } catch (err) {
        console.error("Failed to save reason:", err);
      } finally {
        setJustifyingLearnerId(null);
      }
    },
    [justifyingLearnerId, attendanceMap],
  );

  if (!isLoggedIn) {
    return <Account />;
  }

  return (
    <div className="min-h-screen bg-yellow-50 p-4 sm:p-6 font-sans">
      <UpdateNotification />
      <div className="w-full max-w-7xl mx-auto">
        {/* Header Row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-baseline gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              Attender
            </h1>
            {appVersion && (
              <span className="text-xs text-gray-400 font-normal">
                v{appVersion}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowModal(true)}
              className="cursor-pointer px-3 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium shadow hover:bg-blue-600"
            >
              + Learner
            </button>
            <button
              onClick={() => setShowActivityFeed((v) => !v)}
              className={`cursor-pointer px-3 py-2 rounded-xl text-sm font-medium shadow ${
                showActivityFeed
                  ? "bg-green-500 text-white hover:bg-green-600"
                  : "bg-green-100 text-green-700 hover:bg-green-200"
              }`}
            >
              📡 Live
              {activityEvents.length > 0 ? ` (${activityEvents.length})` : ""}
            </button>
            <button
              onClick={() => router.push("/history")}
              className="cursor-pointer px-3 py-2 rounded-xl bg-purple-500 text-white text-sm font-medium shadow hover:bg-purple-600"
            >
              📊 History
            </button>
            <button
              onClick={() => pb.authStore.clear()}
              className="px-3 py-2 rounded-xl bg-gray-200 text-gray-700 text-sm cursor-pointer hover:bg-gray-300"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Controls Row */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-xl border border-gray-200 flex-1 min-w-[200px] max-w-md">
              <svg
                className="w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search learners..."
                className="outline-none text-sm bg-transparent flex-1"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              )}
            </div>

            {/* Program Filter */}
            <select
              value={programFilter}
              onChange={(e) => setProgramFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm cursor-pointer"
            >
              <option value="all">All programs</option>
              <option value="exp">Explorers</option>
              <option value="cre">Creators</option>
              <option value="chmk">Changemakers</option>
            </select>

            {/* View toggle */}
            <div className="flex rounded-xl overflow-hidden border border-gray-200">
              <button
                onClick={() => setViewMode("grid")}
                className={`px-3 py-2 text-sm cursor-pointer ${viewMode === "grid" ? "bg-blue-500 text-white" : "bg-gray-50 text-gray-700 hover:bg-gray-100"}`}
              >
                ▦ Grid
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`px-3 py-2 text-sm cursor-pointer ${viewMode === "list" ? "bg-blue-500 text-white" : "bg-gray-50 text-gray-700 hover:bg-gray-100"}`}
              >
                ☰ List
              </button>
            </div>

            <div className="flex-1" />

            {/* Test Mode Toggle */}
            <button
              onClick={() => {
                setTestMode((t) => !t);
                if (testMode) {
                  setTestTime(null);
                  setTestDate(null);
                }
              }}
              className={`px-3 py-2 rounded-xl text-sm cursor-pointer font-medium ${
                testMode
                  ? "bg-orange-500 text-white"
                  : "bg-gray-50 border border-gray-200 text-gray-700 hover:bg-gray-100"
              }`}
            >
              {testMode ? "🧪 Test Mode ON" : "🧪 Test Mode"}
            </button>
          </div>
        </div>

        {/* Test Mode Panel */}
        {testMode && (
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
        )}

        {/* NFC Status */}
        {uid && (
          <div
            className={`mb-4 px-4 py-2 rounded-xl text-sm inline-flex items-center gap-2 ${
              exists
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            <span className="font-medium">NFC:</span>
            <code className="font-mono">{uid}</code>
            <span>•</span>
            <span>{exists ? "✓ Learner found" : "✗ Not registered"}</span>
          </div>
        )}

        {/* Date indicator (non-test mode) */}
        {!testMode && (
          <div className="mb-4 text-sm text-gray-500">
            Showing attendance for{" "}
            <span className="font-medium text-gray-700">
              {new Date(viewDate).toLocaleDateString(undefined, {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
          </div>
        )}

        {/* Attendance filter pills */}
        <AttendanceFilterPills
          attendanceFilter={attendanceFilter}
          attendanceCounts={attendanceCounts}
          setAttendanceFilter={setAttendanceFilter}
        />

        {/* Learner grid or list */}
        {viewMode === "grid" ? (
          <LearnerGrid
            filtered={filtered}
            uid={uid}
            testMode={testMode}
            testTime={testTime}
            onStatusChange={handleSetStatus}
            onCheckAction={handleCheckAction}
            onCommentUpdate={handleCommentUpdate}
            onReset={handleReset}
            onOpenJustification={(id) => setJustifyingLearnerId(id)}
          />
        ) : (
          <LearnerListView
            filtered={filtered}
            uid={uid}
            onStatusChange={handleSetStatus}
            onCheckAction={handleCheckAction}
            onCommentUpdate={handleCommentUpdate}
            onTimeEdit={handleTimeEdit}
            onOpenJustification={(id) => setJustifyingLearnerId(id)}
          />
        )}

        {/* Pagination controls */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm text-gray-600">
              Showing{" "}
              <span className="font-semibold">{filtered.length}</span> of{" "}
              <span className="font-semibold">{totalItems}</span> learners
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${page <= 1 ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-gray-100 text-gray-700 hover:bg-gray-200 cursor-pointer"}`}
              >
                ← Prev
              </button>

              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 text-sm">
                <span className="text-gray-500">Page</span>
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={page}
                  onChange={(e) =>
                    setPage(
                      Math.max(
                        1,
                        Math.min(totalPages, Number(e.target.value || 1)),
                      ),
                    )
                  }
                  className="w-12 text-center text-sm outline-none bg-white border border-gray-200 rounded px-1 py-0.5"
                />
                <span className="text-gray-500">of {totalPages}</span>
              </div>

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${page >= totalPages ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-gray-100 text-gray-700 hover:bg-gray-200 cursor-pointer"}`}
              >
                Next →
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Show:</span>
              <select
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value));
                  setPage(1);
                }}
                className="px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 text-sm cursor-pointer"
              >
                <option value={4}>4</option>
                <option value={8}>8</option>
                <option value={12}>12</option>
                <option value={24}>24</option>
                <option value={500}>All</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Activity feed panel */}
      {showActivityFeed && (
        <ActivityFeed
          events={activityEvents}
          onClose={() => setShowActivityFeed(false)}
        />
      )}

      {/* Modal for creating learner */}
      <CreateLearnerModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreate={handleCreateLearner}
        uid={uid}
      />

      {/* Justification reason modal */}
      {justifyingLearnerId && (() => {
        const rec = attendanceMap[justifyingLearnerId];
        const learner = students.find((s) => s.id === justifyingLearnerId);
        return (
          <JustificationModal
            learnerName={(learner as any)?.name || "Learner"}
            currentReason={rec?.justification_reason || ""}
            justifiedBy={rec?.justified_by || null}
            justifiedAt={rec?.justified_at || null}
            onSave={handleSaveJustificationReason}
            onClose={() => setJustifyingLearnerId(null)}
          />
        );
      })()}
    </div>
  );
}
