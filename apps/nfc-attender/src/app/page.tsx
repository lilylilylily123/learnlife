"use client";
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { pb } from "./pb";
import { RecordModel } from "pocketbase";
import { createLearner } from "./utils/utils";
import { getVersion } from "@tauri-apps/api/app";
import { useNfcLearner } from "./hooks/useNfcLearner";
import { useAttendanceFilters } from "./hooks/useAttendanceFilters";
import { useIsPrivileged } from "./hooks/useIsPrivileged";
import { useAutoAbsentSweep } from "./hooks/useAutoAbsentSweep";
import Account from "./components/Account";
import CreateLearnerModal from "./components/CreateLearnerModal";
import { TestModePanel } from "./components/TestModePanel";
import * as pbClient from "@/lib/pb-client";
import { UpdateNotification } from "./components/UpdateNotification";
import type { ActivityEvent } from "./components/ActivityFeed";
import { AttenderD } from "./components/AttenderD";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { JustificationModal } from "./components/JustificationModal";
import { toast } from "./components/Toast";
import { KeyboardHelpOverlay } from "./components/KeyboardHelpOverlay";
import { buildDemoAttendanceMap } from "@/lib/demo-data";
import type { Student } from "./types";
import { deriveStatus } from "@learnlife/shared";
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
  const isLoggedIn = useIsPrivileged();
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

  // Activity feed (rendered inline by AttenderD's collapsible sidebar)
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);

  // Pagination
  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(500);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);

  // Raw data
  const [students, setStudents] = useState<RecordModel[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, any>>({});
  // Demo overlay (Test Mode → "Load demo"). When non-null the dashboard reads
  // from this map instead of `attendanceMap`, and ALL write handlers route
  // their changes here too — no PocketBase writes happen while the overlay is
  // on. Turning Test Mode off clears the overlay automatically.
  const [demoMap, setDemoMap] = useState<Record<string, any> | null>(null);
  const demoActive = demoMap !== null;
  // Wraps setAttendanceMap so handlers don't need to branch on demoActive.
  // When demo is on we update demoMap; when off we update the real map. The
  // updater function signature is unchanged.
  const updateAttendanceState = useCallback(
    (updater: (prev: Record<string, any>) => Record<string, any>) => {
      if (demoActive) {
        setDemoMap((prev) => updater(prev ?? {}));
      } else {
        setAttendanceMap(updater);
      }
    },
    [demoActive],
  );
  // Initial-fetch lifecycle for skeletons + retry banner. `hasLoadedOnce`
  // flips after the first successful learners+attendance fetch so subsequent
  // refreshes don't reintroduce the placeholders.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Keyboard help overlay (`?` opens, Esc closes).
  const [helpOpen, setHelpOpen] = useState(false);

  // Justification modal — opens when a guide clicks the "add reason" icon next
  // to a justified status. Stores the learner whose reason we're editing.
  const [justifyingLearnerId, setJustifyingLearnerId] = useState<string | null>(null);
  // Lift the error out of the modal's local state so a failed save doesn't
  // close the modal and lose the user's input (review #2).
  const [justifyError, setJustifyError] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  // Filters hook (needs studentsWithAttendance; we use a two-pass pattern below)
  const effectiveAttendanceMap = demoMap ?? attendanceMap;
  const studentsWithAttendance = useMemo<Student[]>(() => {
    const merged = students.map((s) => {
      const attendance = effectiveAttendanceMap[s.id] || {};
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
  }, [students, effectiveAttendanceMap]);

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

  useAutoAbsentSweep({ enabled: isLoggedIn, viewDate, testMode, testTime });

  // Global keyboard shortcuts. The handler bails when the focus is in any
  // text input/textarea/contenteditable so typing in the search bar or a
  // comment textarea doesn't trigger navigations. The `?` shortcut is treated
  // as a meta-control and fires regardless of focus — there's no realistic
  // text-entry case where `?` should also fire navigation.
  useEffect(() => {
    if (!isLoggedIn) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTyping =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        Boolean(target?.isContentEditable);
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (isTyping) return;
      if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        router.push("/history");
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        setTestMode((t) => {
          if (t) {
            setTestTime(null);
            setTestDate(null);
          }
          return !t;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isLoggedIn, router]);

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
        const prevLunch = effectiveAttendanceMap[id]?.lunch_status;
        const newLunch = toggle && prevLunch === status ? "" : status;
        updateAttendanceState((prev) => ({
          ...prev,
          [id]: { ...prev[id], lunch_status: newLunch || null },
        }));
        if (demoActive) return;
        try {
          await pbClient.batchUpdateAttendance({
            learnerId: id,
            date: viewDate,
            fields: { lunch_status: newLunch },
          });
        } catch (err) {
          console.error("Failed to save lunch status", err);
          updateAttendanceState((prev) => ({
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

      const prevRecord = effectiveAttendanceMap[id] || {};
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
      updateAttendanceState((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          arrival: next.arrival,
          justified: next.justified,
          status: nextStatus,
        },
      }));

      if (demoActive) return;

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
        updateAttendanceState((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            arrival: prevArrival,
            justified: prevJustified,
            status: prevStatus,
          },
        }));
        toast.error("Couldn't save status", {
          detail: err?.message,
        });
      }
    },
    [viewDate, effectiveAttendanceMap, demoActive, updateAttendanceState],
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
      const attendance = effectiveAttendanceMap[id] || {};
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

          updateAttendanceState((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              time_in: timestamp,
              arrival,
              justified: wasJustified,
              status,
            },
          }));

          if (demoActive) {
            pushActivityEvent(id, "morning-in", status);
            return;
          }

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
            updateAttendanceState((prev) => ({
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

          updateAttendanceState((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              lunch_events: updatedEvents,
              ...(computedLunchStatus
                ? { lunch_status: computedLunchStatus }
                : {}),
            },
          }));
          if (demoActive) {
            if (eventType === "in") {
              pushActivityEvent(id, "lunch-in", computedLunchStatus ?? undefined);
            } else {
              pushActivityEvent(id, "lunch-out");
            }
            return;
          }
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
            updateAttendanceState((prev) => ({
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
          updateAttendanceState((prev) => ({
            ...prev,
            [id]: { ...prev[id], time_out: timestamp },
          }));
          if (demoActive) {
            pushActivityEvent(id, "day-out");
            return;
          }
          try {
            await pbClient.batchUpdateAttendance({
              learnerId: id,
              date: viewDate,
              fields: { time_out: timestamp },
            });
            pushActivityEvent(id, "day-out");
          } catch (err) {
            updateAttendanceState((prev) => ({
              ...prev,
              [id]: { ...prev[id], time_out: null },
            }));
            throw err;
          }
        }
      } catch (err) {
        console.error("check action failed", err);
        toast.error("Couldn't update attendance", {
          detail: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [
      effectiveAttendanceMap,
      testMode,
      testTime,
      viewDate,
      fetchAttendance,
      pushActivityEvent,
      demoActive,
      updateAttendanceState,
    ],
  );

  // Commits the reset. The confirm dialog lives inside AttenderD (row menu) /
  // WallView (bulk reset) so the row menu and the wall bulk bar each prompt
  // once, and this handler always assumes the user has already agreed.
  const handleReset = useCallback(
    async (id: string) => {
      const student = students.find((s) => s.id === id);
      const name = (student as any)?.name as string | undefined;
      if (demoActive) {
        updateAttendanceState((prev) => ({ ...prev, [id]: { id: `demo-${id}`, learner: id } }));
        toast.success("Attendance reset (demo)", { detail: name });
        return;
      }
      try {
        await pbClient.resetAttendance(id, viewDate);
        fetchAttendance();
        toast.success("Attendance reset", { detail: name });
      } catch (err) {
        console.error("Reset failed", err);
        toast.error("Couldn't reset attendance", {
          detail: name ?? (err instanceof Error ? err.message : undefined),
        });
      }
    },
    [viewDate, fetchAttendance, students, demoActive, updateAttendanceState],
  );

  const handleCommentUpdate = useCallback(
    async (id: string, comment: string) => {
      const previousComment = effectiveAttendanceMap[id]?.comments;
      updateAttendanceState((prev) => ({
        ...prev,
        [id]: { ...prev[id], comments: comment },
      }));
      if (demoActive) {
        toast.success(comment.trim() ? "Comment saved (demo)" : "Comment cleared (demo)");
        return;
      }
      try {
        await pbClient.updateLearnerComment(id, comment);
        fetchAttendance();
        toast.success(comment.trim() ? "Comment saved" : "Comment cleared");
      } catch (err) {
        console.error("Failed to update comment:", err);
        updateAttendanceState((prev) => ({
          ...prev,
          [id]: { ...prev[id], comments: previousComment },
        }));
        toast.error("Couldn't save comment", {
          detail: err instanceof Error ? err.message : undefined,
        });
        throw err;
      }
    },
    [fetchAttendance, effectiveAttendanceMap, demoActive, updateAttendanceState],
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
      const previousValue = effectiveAttendanceMap[learnerId]?.[field];
      updateAttendanceState((prev) => ({
        ...prev,
        [learnerId]: { ...prev[learnerId], [field]: timestamp },
      }));
      if (demoActive) {
        toast.success(
          field === "time_in" ? "Check-in time updated (demo)" : "Check-out time updated (demo)",
        );
        return;
      }
      try {
        await pbClient.batchUpdateAttendance({
          learnerId,
          date: viewDate,
          fields: { [field]: timestamp },
        });
        toast.success(
          field === "time_in" ? "Check-in time updated" : "Check-out time updated",
        );
      } catch (err) {
        console.error("Failed to update time:", err);
        updateAttendanceState((prev) => ({
          ...prev,
          [learnerId]: { ...prev[learnerId], [field]: previousValue },
        }));
        toast.error("Couldn't save time", {
          detail: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [viewDate, effectiveAttendanceMap, demoActive, updateAttendanceState],
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
      const record = effectiveAttendanceMap[justifyingLearnerId];
      if (!record?.id) {
        setJustifyError("No attendance record yet — mark the day with a status first.");
        return;
      }
      if (demoActive) {
        updateAttendanceState((prev) => ({
          ...prev,
          [justifyingLearnerId]: {
            ...prev[justifyingLearnerId],
            justification_reason: reason,
            justified_at: new Date().toISOString(),
          },
        }));
        setJustifyingLearnerId(null);
        toast.success("Justification reason saved (demo)");
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
        updateAttendanceState((prev) => ({
          ...prev,
          [justifyingLearnerId]: { ...prev[justifyingLearnerId], ...updated },
        }));
        setJustifyingLearnerId(null);
        toast.success("Justification reason saved");
      } catch (err: any) {
        console.error("Failed to save reason:", err);
        setJustifyError(err?.message || "Failed to save — please try again.");
      }
    },
    [justifyingLearnerId, effectiveAttendanceMap, demoActive, updateAttendanceState],
  );

  if (!isLoggedIn) {
    return <Account />;
  }

  return (
    <>
      <UpdateNotification />
      <KeyboardHelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />

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
        onShowAddLearner={() => setShowModal(true)}
        onShowHistory={() => router.push("/history")}
        onLogout={() => pb.authStore.clear()}
        onToggleTestMode={() => {
          setTestMode((t) => !t);
          if (testMode) {
            setTestTime(null);
            setTestDate(null);
            // Clearing the overlay when leaving test mode prevents demo state
            // from lingering after the toggle goes away, which would otherwise
            // leave the dashboard pinned to synthetic data with no UI to exit.
            setDemoMap(null);
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
        onShowHelp={() => setHelpOpen(true)}
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
            demoActive={demoActive}
            onLoadDemo={() => {
              const when = testTime ?? new Date();
              setDemoMap(buildDemoAttendanceMap(students, when));
              toast.success("Demo data loaded", {
                detail: "Changes stay local — nothing is written to PocketBase.",
              });
            }}
            onClearDemo={() => {
              setDemoMap(null);
              toast.info("Demo overlay cleared");
            }}
          />
        </div>
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
        const rec = effectiveAttendanceMap[justifyingLearnerId];
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
