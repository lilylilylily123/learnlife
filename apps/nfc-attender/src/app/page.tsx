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
import type { Student } from "./types";

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

  // Raw data
  const [students, setStudents] = useState<RecordModel[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, any>>({});

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

  // Push NFC scan results into the activity feed
  useEffect(() => {
    if (lastAction && lastAction.type !== "no_action") {
      setActivityEvents((prev) => [
        ...prev.slice(-49),
        {
          id: `${Date.now()}-${lastAction.learnerName}`,
          learnerName: lastAction.learnerName,
          program: lastAction.program,
          actionType: lastAction.type,
          timestamp: new Date(),
          status: lastAction.status,
        },
      ]);
    }
  }, [lastAction]);

  // Keep refs to the latest fetch functions for stable PocketBase subscriptions
  const fetchLearnersRef = useRef(fetchLearners);
  const fetchAttendanceRef = useRef(fetchAttendance);
  useEffect(() => { fetchLearnersRef.current = fetchLearners; }, [fetchLearners]);
  useEffect(() => { fetchAttendanceRef.current = fetchAttendance; }, [fetchAttendance]);

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
        .subscribe("*", () => {
          if (attendanceTimer) clearTimeout(attendanceTimer);
          attendanceTimer = setTimeout(() => fetchAttendanceRef.current(), 1000);
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
      const previousValue = attendanceMap[id]?.[field];
      const newValue = toggle && previousValue === status ? "" : status;

      setAttendanceMap((prev) => ({
        ...prev,
        [id]: { ...prev[id], [field]: newValue || null },
      }));

      try {
        await pbClient.batchUpdateAttendance({
          learnerId: id,
          date: viewDate,
          fields: { [field]: newValue },
        });
      } catch (err: any) {
        if (err?.status === 429) {
          await new Promise((r) => setTimeout(r, 1000));
          try {
            await pbClient.batchUpdateAttendance({
              learnerId: id,
              date: viewDate,
              fields: { [field]: newValue },
            });
            return;
          } catch (retryErr) {
            console.error("Retry failed:", retryErr);
          }
        }
        console.error("Failed to save status", err);
        setAttendanceMap((prev) => ({
          ...prev,
          [id]: { ...prev[id], [field]: previousValue },
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

  if (!isLoggedIn) {
    return <Account />;
  }

  return (
    <>
      <UpdateNotification />

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
        onCommentUpdate={handleCommentUpdate}
        onTimeEdit={handleTimeEdit}
        onReset={handleReset}
      />

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
    </>
  );
}
