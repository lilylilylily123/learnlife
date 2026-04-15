"use client";
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { pb } from "./pb";
import { RecordModel } from "pocketbase";
import {
  checkLearnerIn,
  createLearner,
} from "./utils/utils";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { useNfcLearner } from "./hooks/useNfcLearner";
import Account from "./components/Account";
import CreateLearnerModal from "./components/CreateLearnerModal";
import { LearnerCard } from "./components/LearnerCard";
import * as pbClient from "@/lib/pb-client";
import { UpdateNotification } from "./components/UpdateNotification";

// Note: useNfcLearner is called below after testTime state is defined

const example = {
  uid: "",
  name: "Josh John",
  email: "josh@john.com",
  dob: "1990-01-01",
  NFC_ID: null,
};

type LunchEvent = {
  type: 'out' | 'in';
  time: string;
};

type Student = RecordModel & {
  uid: string;
  name: string;
  email: string;
  dob: string;
  NFC_ID: string | null;
  time_in?: string | null;
  time_out?: string | null;
  lunch_in?: string | null;
  lunch_out?: string | null;
  lunch_events?: LunchEvent[] | null;
  status?: string;
  lunch_status?: string;
  program?: string;
  comments?: string;
};

export default function AttendancePage() {
  const [adminLoggedIn, setAdminLoggedIn] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [programFilter, setProgramFilter] = useState<string | "all">("all");
  const [attendanceFilter, setAttendanceFilter] = useState<"all" | "here" | "away" | "lunch" | "out" | "present" | "late" | "absent" | "jLate" | "jAbsent">("all");
  const [students, setStudents] = useState<RecordModel[]>([]);

  // Test mode: when enabled, can simulate different dates/times
  const [testMode, setTestMode] = useState<boolean>(false);

  // Test time: simulated time for testing the check-in flow (null = use real time)
  const [testTime, setTestTime] = useState<Date | null>(null);

  // Test date: simulated date for testing historical records (null = use today)
  const [testDate, setTestDate] = useState<string | null>(null);

  // Current viewing date (for fetching attendance)
  const viewDate =
    testMode && testDate ? testDate : new Date().toISOString().split("T")[0];

  // NFC hook - pass test options so NFC scans respect test mode
  const nfcOptions = testMode ? { testTime, testDate } : undefined;
  const { uid, learner, exists, isLoading } = useNfcLearner(nfcOptions);

  // initialize to false to keep server/client markup consistent during hydration
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Modal state for creating learner
  const [showModal, setShowModal] = useState(false);

  // History modal state
  const router = useRouter();

  // Pagination
  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(500);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);

  // View mode: grid or list
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");

  // List view comment editing state
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentEditValue, setCommentEditValue] = useState<string>("");
  const [isSavingComment, setIsSavingComment] = useState(false);

  // Time editing state: tracks which learner+field is being edited
  const [editingTimeKey, setEditingTimeKey] = useState<string | null>(null); // "learnerId:field"
  const [timeEditValue, setTimeEditValue] = useState<string>("");

  // App version from Tauri
  const [appVersion, setAppVersion] = useState<string>("");

  // Preset times for quick testing
  const testTimePresets = [
    { label: "9 AM", hour: 9 },
    { label: "10 AM", hour: 10 },
    { label: "1 PM", hour: 13 },
    { label: "1:30 PM", hour: 13, minute: 30 },
    { label: "2 PM", hour: 14 },
    { label: "5 PM", hour: 17 },
    { label: "6 PM", hour: 18 },
  ];

  const setTestTimePreset = (hour: number, minute = 0) => {
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    console.log(`[page] Setting test time to: ${d.toLocaleTimeString()}`);
    setTestTime(d);
  };

  async function handleCreateLearner(
    name: string,
    email: string,
    dob: string,
    uid: string,
  ) {
    await createLearner(name, email, "Explorer", dob, uid);
  }

  // Update logged-in state on the client after mount to avoid hydration mismatch
  useEffect(() => {
    setIsLoggedIn(pb.authStore.isValid);
    const unsubscribe = pb.authStore.onChange(() => {
      setIsLoggedIn(pb.authStore.isValid);
    });

    getVersion().then(setAppVersion).catch(() => {});

    return () => unsubscribe();
  }, []);

  // Debounce search input (300ms delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Attendance records keyed by learner ID
  const [attendanceMap, setAttendanceMap] = useState<Record<string, any>>({});
  const [isDataLoading, setIsDataLoading] = useState(false);

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

  // Initial data fetch - only when logged in
  useEffect(() => {
    if (isLoggedIn) {
      fetchLearners();
      fetchAttendance();
    }
  }, [fetchLearners, fetchAttendance, isLoggedIn]);

  // Refresh attendance data after NFC scan completes
  useEffect(() => {
    if (!isLoading && learner && isLoggedIn) {
      console.log("[page] NFC scan completed, refreshing attendance data");
      const timer = setTimeout(() => {
        fetchAttendance();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isLoading, learner, fetchAttendance, isLoggedIn]);

  // Subscribe to real-time changes via PocketBase - only when logged in
  // Debounce refetches so rapid changes (morning rush) batch into single calls
  useEffect(() => {
    if (!isLoggedIn) return;

    let learnersTimer: ReturnType<typeof setTimeout> | null = null;
    let attendanceTimer: ReturnType<typeof setTimeout> | null = null;

    let unsubscribeLearners: (() => void) | undefined;
    let unsubscribeAttendance: (() => void) | undefined;
    (async () => {
      unsubscribeLearners = await pb
        .collection("learners")
        .subscribe("*", () => {
          if (learnersTimer) clearTimeout(learnersTimer);
          learnersTimer = setTimeout(fetchLearners, 1000);
        });
      unsubscribeAttendance = await pb
        .collection("attendance")
        .subscribe("*", () => {
          if (attendanceTimer) clearTimeout(attendanceTimer);
          attendanceTimer = setTimeout(fetchAttendance, 1000);
        });
    })();

    return () => {
      if (learnersTimer) clearTimeout(learnersTimer);
      if (attendanceTimer) clearTimeout(attendanceTimer);
      if (unsubscribeLearners) unsubscribeLearners();
      if (unsubscribeAttendance) unsubscribeAttendance();
    };
  }, [fetchLearners, fetchAttendance, isLoggedIn]);

  // Merge learners with their attendance data for the current date
  const studentsWithAttendance = useMemo(() => {
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
    // Ensure alphabetical sorting by name
    return merged.sort((a, b) => a.name.localeCompare(b.name));
  }, [students, attendanceMap]);

  // Classify a learner's presence state based on attendance data
  const getPresenceState = useCallback((s: Student): "here" | "away" | "lunch" | "out" => {
    if (s.time_out) return "out";
    if (s.time_in) {
      const events = s.lunch_events || [];
      if (events.length > 0 && events[events.length - 1].type === "out") return "lunch";
      return "here";
    }
    return "away";
  }, []);

  // Compute counts for each attendance filter category
  const attendanceCounts = useMemo(() => {
    const counts = { all: 0, here: 0, away: 0, lunch: 0, out: 0, present: 0, late: 0, absent: 0, jLate: 0, jAbsent: 0 };
    for (const s of studentsWithAttendance) {
      counts.all++;
      counts[getPresenceState(s)]++;
      if (s.status === "present") counts.present++;
      else if (s.status === "late") counts.late++;
      else if (s.status === "absent") counts.absent++;
      else if (s.status === "jLate") counts.jLate++;
      else if (s.status === "jAbsent") counts.jAbsent++;
    }
    return counts;
  }, [studentsWithAttendance, getPresenceState]);

  // Update attendance field via direct PocketBase call
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

        return {
          wrote: true,
          value: fieldValue,
          attendance,
        };
      } catch (err) {
        console.error("[updateAttendance] call failed", err);
        return { wrote: false };
      }
    },
    [viewDate, fetchAttendance],
  );

  const handleSetStatus = useCallback(
    async (
      id: string,
      status: string,
      field: "status" | "lunch_status" = "status",
      toggle: boolean = true,
    ) => {
      const previousValue = attendanceMap[id]?.[field];
      // Toggle off if clicking the already-active status (only when toggle=true, i.e. direct UI clicks)
      const newValue = toggle && previousValue === status ? "" : status;

      // Optimistic update
      setAttendanceMap((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          [field]: newValue || null,
        },
      }));

      try {
        await pbClient.batchUpdateAttendance({
          learnerId: id,
          date: viewDate,
          fields: { [field]: newValue },
        });
      } catch (err: any) {
        // Retry once on 429
        if (err?.status === 429) {
          console.log("[handleSetStatus] 429, retrying in 1s...");
          await new Promise(r => setTimeout(r, 1000));
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
        // Revert on failure
        setAttendanceMap((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            [field]: previousValue,
          },
        }));
      }
    },
    [viewDate, attendanceMap],
  );

  const handleCheckAction = useCallback(
    async (id: string, action: string) => {
      console.log(`[handleCheckAction] Called with id=${id}, action=${action}`);
      // Use test time if in test mode, otherwise real time
      const now = testMode && testTime ? testTime : new Date();
      console.log(
        `[handleCheckAction] Using time: ${now.toLocaleTimeString()} (test mode: ${testMode})`,
      );

      // Get attendance from map (merged with learner data)
      const attendance = attendanceMap[id] || {};
      const { time_in, time_out, lunch_events } = attendance;
      const lunchEventsArray = lunch_events || [];
      console.log(`[handleCheckAction] Attendance state:`, {
        time_in,
        time_out,
        lunch_events: lunchEventsArray,
      });

      try {
        if (action === "morning-in") {
          if (time_in) {
            console.log("[handleCheckAction] morning-in: already checked in");
            return;
          }
          
          // Determine status first: present if before 10:01am, late if 10:01am+
          const lateTime = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            10,
            1,
            0,
            0,
          );
          const isLate = now.getTime() >= lateTime.getTime();
          const status = isLate ? "late" : "present";
          
          // Optimistic update
          const timestamp = now.toISOString();
          setAttendanceMap((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              time_in: timestamp,
              status: status,
            },
          }));
          
          const result = await updateAttendance(id, "time_in", {
            timestamp: timestamp,
          });
          if (!result.wrote) {
            // Revert on failure
            setAttendanceMap((prev) => ({
              ...prev,
              [id]: {
                ...prev[id],
                time_in: undefined,
                status: undefined,
              },
            }));
            return;
          }

          console.log(
            `[handleCheckAction] Check-in at ${now.toLocaleTimeString()}, lateTime: ${lateTime.toLocaleTimeString()}, isLate: ${isLate}, status: ${status}`,
          );
          await handleSetStatus(id, status, "status", false);
        } else if (action === "lunch-out" || action === "lunch-in") {
          if (!time_in) {
            console.log("[handleCheckAction] lunch action: must check in first");
            return;
          }
          
          // Determine next event type based on last event
          const lastEvent = lunchEventsArray.length > 0 ? lunchEventsArray[lunchEventsArray.length - 1] : null;
          const nextEventType: 'out' | 'in' = !lastEvent || lastEvent.type === 'in' ? 'out' : 'in';
          
          // If manually clicking, respect the action type
          const eventType = action === "lunch-out" ? 'out' as const : 'in' as const;
          
          // Only allow if it matches the expected next event
          if (eventType !== nextEventType) {
            console.log(`[handleCheckAction] Cannot ${eventType}, must ${nextEventType} first`);
            return;
          }
          
          const newEvent: LunchEvent = {
            type: eventType,
            time: now.toISOString()
          };
          
          const updatedEvents = [...lunchEventsArray, newEvent];
          
          // Optimistic update
          setAttendanceMap((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              lunch_events: updatedEvents,
            },
          }));
          
          try {
            await pbClient.batchUpdateAttendance({
              learnerId: id,
              date: viewDate,
              fields: { lunch_events: JSON.stringify(updatedEvents) },
            });
            
            // If checking in from lunch, update lunch_status
            if (eventType === 'in') {
              const lunchLateTime = new Date(now);
              lunchLateTime.setHours(14, 1, 0, 0);
              const lunchStatus = now >= lunchLateTime ? "late" : "present";
              await handleSetStatus(id, lunchStatus, "lunch_status", false);
              console.log(`[handleCheckAction] Lunch return at ${now.toLocaleTimeString()}, status: ${lunchStatus}`);
            } else {
              console.log(`[handleCheckAction] Lunch out at ${now.toLocaleTimeString()}`);
            }
            
            // Refresh to get updated data
            fetchAttendance();
          } catch (err) {
            // Revert on failure
            setAttendanceMap((prev) => ({
              ...prev,
              [id]: {
                ...prev[id],
                lunch_events: lunchEventsArray,
              },
            }));
            throw err;
          }
        } else if (action === "day-out") {
          if (!time_in) {
            console.log("[handleCheckAction] day-out: must check in first");
            return;
          }
          if (time_out) {
            console.log("[handleCheckAction] day-out: already checked out");
            return;
          }
          
          // Optimistic update
          const timestamp = now.toISOString();
          setAttendanceMap((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              time_out: timestamp,
            },
          }));
          
          try {
            await updateAttendance(id, "time_out", {
              timestamp: timestamp,
            });
          } catch (err) {
            // Revert on failure
            setAttendanceMap((prev) => ({
              ...prev,
              [id]: {
                ...prev[id],
                time_out: undefined,
              },
            }));
            throw err;
          }
        }
      } catch (err) {
        console.error("check action failed", err);
      }
    },
    [attendanceMap, updateAttendance, handleSetStatus, testMode, testTime, viewDate, fetchAttendance],
  );

  // Reset a learner's daily attendance (for testing)
  const handleReset = useCallback(
    async (id: string) => {
      try {
        await pbClient.resetAttendance(id, viewDate);
        // Refetch attendance data to sync
        fetchAttendance();
      } catch (err) {
        console.error("Reset failed", err);
      }
    },
    [viewDate, fetchAttendance],
  );

  // Update learner's comment
  const handleCommentUpdate = useCallback(
    async (id: string, comment: string) => {
      // Optimistic update
      const previousComment = attendanceMap[id]?.comments;
      setAttendanceMap((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          comments: comment,
        },
      }));
      
      try {
        await pbClient.updateLearnerComment(id, comment);
        // Refetch learners data to show the updated comment
        fetchAttendance();
      } catch (err) {
        console.error("Failed to update comment:", err);
        // Revert on failure
        setAttendanceMap((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            comments: previousComment,
          },
        }));
        throw err; // Re-throw so the UI can show error state
      }
    },
    [fetchAttendance, attendanceMap],
  );

  // Save an edited time value
  const handleTimeEdit = useCallback(
    async (learnerId: string, field: "time_in" | "time_out", timeStr: string) => {
      if (!timeStr) return;
      // Build a full ISO timestamp from the time input (HH:MM) and the current view date
      const [h, m] = timeStr.split(":").map(Number);
      const d = new Date(`${viewDate}T00:00:00`);
      d.setHours(h, m, 0, 0);
      const timestamp = d.toISOString();

      const previousValue = attendanceMap[learnerId]?.[field];
      // Optimistic update
      setAttendanceMap((prev) => ({
        ...prev,
        [learnerId]: {
          ...prev[learnerId],
          [field]: timestamp,
        },
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
          [learnerId]: {
            ...prev[learnerId],
            [field]: previousValue,
          },
        }));
      }
      setEditingTimeKey(null);
    },
    [viewDate, attendanceMap],
  );

  // Client-side filter for instant feedback while typing (before debounce triggers server fetch)
  // Uses studentsWithAttendance which merges learners with their attendance data
  const filtered = useMemo(() => {
    const filteredResults = studentsWithAttendance.filter((s) => {
      // Name search (local instant filter when typing ahead of debounce)
      if (search !== debouncedSearch) {
        const matchesName = s.name.toLowerCase().includes(search.toLowerCase());
        const matchesProgram =
          programFilter === "all" || s.program === programFilter;
        if (!matchesName || !matchesProgram) return false;
      }
      // Attendance presence / status filter
      if (attendanceFilter !== "all") {
        const statusFilters = ["present", "late", "absent", "jLate", "jAbsent"];
        if (statusFilters.includes(attendanceFilter)) {
          if (s.status !== attendanceFilter) return false;
        } else {
          if (getPresenceState(s) !== attendanceFilter) return false;
        }
      }
      return true;
    });
    // Sort alphabetically by name
    return filteredResults.sort((a, b) => a.name.localeCompare(b.name));
  }, [studentsWithAttendance, search, debouncedSearch, programFilter, attendanceFilter, getPresenceState]);

  // kid-friendly program colors
  const programColor = (program: string) =>
    program === "exp"
      ? "bg-rose-100 text-rose-800"
      : program === "cre"
        ? "bg-emerald-100 text-emerald-800"
        : "bg-sky-100 text-sky-800";

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
              <span className="text-xs text-gray-400 font-normal">v{appVersion}</span>
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
              onChange={(e) => setProgramFilter(e.target.value as string)}
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

            {/* Spacer */}
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

        {/* Test Mode Panel - Only visible when test mode is on */}
        {testMode && (
          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 mb-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-orange-800">
                  Simulate Date:
                </span>
                <input
                  type="date"
                  value={testDate || new Date().toISOString().split("T")[0]}
                  onChange={(e) => setTestDate(e.target.value || null)}
                  className="px-3 py-1.5 rounded-lg bg-white text-gray-900 text-sm border border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-orange-800">
                  Simulate Time:
                </span>
                <select
                  value={
                    testTime
                      ? `${testTime.getHours()}:${testTime.getMinutes()}`
                      : ""
                  }
                  onChange={(e) => {
                    if (!e.target.value) {
                      setTestTime(null);
                    } else {
                      const [h, m] = e.target.value.split(":").map(Number);
                      setTestTimePreset(h, m);
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white text-gray-900 text-sm border border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-400"
                >
                  <option value="">Use real time</option>
                  {testTimePresets.map((p) => (
                    <option key={p.label} value={`${p.hour}:${p.minute || 0}`}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1" />
              <div className="text-sm text-orange-700">
                <span className="font-medium">Active:</span> {viewDate}
                {testTime &&
                  ` @ ${testTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
              </div>
            </div>
            <p className="text-xs text-orange-600 mt-2">
              Test mode lets you simulate check-ins for different dates and
              times. Records are saved to the selected date.
            </p>
          </div>
        )}

        {/* NFC Status - Compact */}
        {uid && (
          <div
            className={`mb-4 px-4 py-2 rounded-xl text-sm inline-flex items-center gap-2 ${
              exists ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
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
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {([
            { key: "all", label: "All", color: "gray" },
            { key: "here", label: "Here", color: "green" },
            { key: "away", label: "Away", color: "gray" },
            { key: "lunch", label: "At Lunch", color: "orange" },
            { key: "out", label: "Checked Out", color: "blue" },
          ] as const).map(({ key, label, color }) => {
            const isActive = attendanceFilter === key;
            const colorStyles = {
              gray: isActive ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200",
              green: isActive ? "bg-green-600 text-white" : "bg-green-50 text-green-700 border-green-200 hover:bg-green-100",
              orange: isActive ? "bg-orange-500 text-white" : "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100",
              blue: isActive ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100",
            };
            return (
              <button
                key={key}
                onClick={() => setAttendanceFilter(key)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium cursor-pointer border transition-colors ${
                  isActive ? `${colorStyles[color]} border-transparent` : `${colorStyles[color]}`
                }`}
              >
                {label}{" "}
                <span className={`${isActive ? "text-white/80" : "text-gray-400"}`}>
                  {attendanceCounts[key]}
                </span>
              </button>
            );
          })}

          <div className="w-px h-6 bg-gray-300 mx-1" />

          {([
            { key: "present", label: "Present", color: "green" },
            { key: "late", label: "Late", color: "yellow" },
            { key: "absent", label: "Absent", color: "red" },
            { key: "jLate", label: "J. Late", color: "blue" },
            { key: "jAbsent", label: "J. Absent", color: "purple" },
          ] as const).map(({ key, label, color }) => {
            const isActive = attendanceFilter === key;
            const colorStyles = {
              green: isActive ? "bg-green-600 text-white" : "bg-green-50 text-green-700 border-green-200 hover:bg-green-100",
              yellow: isActive ? "bg-yellow-500 text-white" : "bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100",
              red: isActive ? "bg-red-600 text-white" : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100",
              blue: isActive ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100",
              purple: isActive ? "bg-purple-600 text-white" : "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100",
            };
            return (
              <button
                key={key}
                onClick={() => setAttendanceFilter(key)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium cursor-pointer border transition-colors ${
                  isActive ? `${colorStyles[color]} border-transparent` : `${colorStyles[color]}`
                }`}
              >
                {label}{" "}
                <span className={`${isActive ? "text-white/80" : "text-gray-400"}`}>
                  {attendanceCounts[key]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Students grid or list */}
        {viewMode === "grid" ? (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {filtered.map((s) => {
              const programClass = programColor((s.program as string) || "");
              const programLabel =
                s.program === "exp"
                  ? "EXP"
                  : s.program === "cre"
                    ? "CRE"
                    : "CHMK";

              return (
                <LearnerCard
                  key={s.id}
                  s={s}
                  isCurrent={s.NFC_ID === uid}
                  programClass={programClass}
                  programLabel={programLabel}
                  onStatusChange={handleSetStatus}
                  onCheckAction={(id: string, action: string) =>
                    handleCheckAction(id as any, action as any)
                  }
                  onCommentUpdate={handleCommentUpdate}
                  onReset={handleReset}
                  testTime={testMode ? testTime : undefined}
                  testMode={testMode}
                />
              );
            })}

            {filtered.length === 0 && (
              <div className="col-span-full text-center text-gray-600 py-20">
                No learners match your search / filter.
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* List header */}
            <div className="grid grid-cols-[1.5fr_0.8fr_1.5fr_1fr_1.8fr_1fr_1.5fr] gap-3 px-4 py-2 bg-gray-100 rounded-lg text-xs font-semibold text-gray-600">
              <div>Name</div>
              <div>Program</div>
              <div>Status</div>
              <div>Check-in</div>
              <div>Lunch</div>
              <div>Check-out</div>
              <div>Comments</div>
            </div>
            {filtered.map((s) => {
              const programClass = programColor((s.program as string) || "");
              const programLabel =
                s.program === "exp"
                  ? "EXP"
                  : s.program === "cre"
                    ? "CRT"
                    : "CHMK";
              const isCurrent = s.NFC_ID === uid;

              // Format time only (no date) for compact display
              const formatTime = (val?: string | null) => {
                if (!val) return "—";
                const d = new Date(val);
                if (Number.isNaN(d.getTime())) return val;
                return d.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                });
              };

              // Status badge helper
              const statusBadge = (
                status: string | undefined,
                type: "morning" | "lunch",
              ) => {
                if (!status)
                  return <span className="text-gray-400 text-xs">—</span>;
                const colors = {
                  present: "bg-green-100 text-green-800",
                  late: "bg-yellow-100 text-yellow-800",
                  absent: "bg-red-100 text-red-800",
                };
                const labels = {
                  present: type === "lunch" ? "On Time" : "Present",
                  late: "Late",
                  absent: "Absent",
                };
                return (
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status as keyof typeof colors] || "bg-gray-100 text-gray-600"}`}
                  >
                    {labels[status as keyof typeof labels] || status}
                  </span>
                );
              };

              // Lunch events helper: determine current state and what action is next
              const getLunchState = () => {
                const events = s.lunch_events || [];
                if (events.length === 0) return { state: 'none' as const, lastEvent: null, count: 0 };
                const lastEvent = events[events.length - 1];
                if (lastEvent.type === 'out') {
                  return { state: 'out' as const, lastEvent, count: Math.ceil(events.length / 2) };
                } else {
                  return { state: 'in' as const, lastEvent, count: Math.ceil(events.length / 2) };
                }
              };

              const lunchState = getLunchState();

              return (
                <div
                  key={s.id}
                  className={`grid grid-cols-[1.5fr_0.8fr_1.5fr_1fr_1.8fr_1fr_1.5fr] gap-3 items-center px-4 py-2 bg-white rounded-lg shadow-sm ${isCurrent ? "border-2 border-green-400" : ""}`}
                >
                  {/* Name */}
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-linear-to-br from-indigo-400 to-pink-400 flex items-center justify-center text-white font-bold text-xs shrink-0">
                      {s.name
                        ? String(s.name.split(" ")[0][0]).toUpperCase()
                        : "?"}
                    </div>
                    <span
                      className="font-medium text-gray-900 text-sm truncate"
                      title={s.name}
                    >
                      {s.name}
                    </span>
                  </div>
                  {/* Program */}
                  <div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${programClass}`}
                    >
                      {programLabel}
                    </span>
                  </div>
                  {/* Morning Status */}
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleSetStatus(s.id, "present")}
                      className={`px-1.5 py-0.5 rounded-full text-xs font-medium cursor-pointer ${s.status === "present" ? "bg-green-200 text-green-900" : "bg-gray-100 text-gray-700 hover:bg-green-50"}`}
                      title="Present"
                    >
                      P
                    </button>
                    <button
                      onClick={() => handleSetStatus(s.id, "late")}
                      className={`px-1.5 py-0.5 rounded-full text-xs font-medium cursor-pointer ${s.status === "late" ? "bg-yellow-200 text-yellow-900" : "bg-gray-100 text-gray-700 hover:bg-yellow-50"}`}
                      title="Late"
                    >
                      L
                    </button>
                    <button
                      onClick={() => handleSetStatus(s.id, "absent")}
                      className={`px-1.5 py-0.5 rounded-full text-xs font-medium cursor-pointer ${s.status === "absent" ? "bg-red-200 text-red-900" : "bg-gray-100 text-gray-700 hover:bg-red-50"}`}
                      title="Absent"
                    >
                      A
                    </button>
                    <button
                      onClick={() => handleSetStatus(s.id, "jLate")}
                      className={`px-1.5 py-0.5 rounded-full text-xs font-medium cursor-pointer ${s.status === "jLate" ? "bg-blue-200 text-blue-900" : "bg-gray-100 text-gray-700 hover:bg-blue-50"}`}
                      title="Justified Late"
                    >
                      JL
                    </button>
                    <button
                      onClick={() => handleSetStatus(s.id, "jAbsent")}
                      className={`px-1.5 py-0.5 rounded-full text-xs font-medium cursor-pointer ${s.status === "jAbsent" ? "bg-purple-200 text-purple-900" : "bg-gray-100 text-gray-700 hover:bg-purple-50"}`}
                      title="Justified Absent"
                    >
                      JA
                    </button>
                  </div>
                  {/* Check-in */}
                  <div className="flex items-center gap-1 pl-3">
                    {editingTimeKey === `${s.id}:time_in` ? (
                      <input
                        type="time"
                        value={timeEditValue}
                        onChange={(e) => setTimeEditValue(e.target.value)}
                        onBlur={() => {
                          if (timeEditValue) handleTimeEdit(s.id, "time_in", timeEditValue);
                          else setEditingTimeKey(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && timeEditValue) handleTimeEdit(s.id, "time_in", timeEditValue);
                          if (e.key === "Escape") setEditingTimeKey(null);
                        }}
                        className="w-20 px-1 py-0.5 text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                        autoFocus
                      />
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingTimeKey(`${s.id}:time_in`);
                            if (s.time_in) {
                              const d = new Date(s.time_in);
                              setTimeEditValue(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
                            } else {
                              setTimeEditValue("");
                            }
                          }}
                          className={`text-sm cursor-pointer hover:underline ${s.time_in ? "text-gray-900" : "text-gray-400"}`}
                          title="Click to edit"
                        >
                          {formatTime(s.time_in)}
                        </button>
                        {!s.time_in && (
                          <button
                            onClick={() => handleCheckAction(s.id, "morning-in")}
                            className="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700 cursor-pointer hover:bg-green-200"
                          >
                            +
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {/* Lunch (combined events display) */}
                  <div className="flex flex-col gap-0.5">
                    {lunchState.state === 'none' ? (
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-gray-400">—</span>
                        {s.time_in && (
                          <button
                            onClick={() => handleCheckAction(s.id, "lunch-out")}
                            className="px-1.5 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700 cursor-pointer hover:bg-yellow-200"
                          >
                            Out
                          </button>
                        )}
                      </div>
                    ) : lunchState.state === 'out' ? (
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1">
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                            At Lunch {lunchState.count > 1 ? `(${lunchState.count})` : ''}
                          </span>
                          <button
                            onClick={() => handleCheckAction(s.id, "lunch-in")}
                            className="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700 cursor-pointer hover:bg-green-200"
                          >
                            In
                          </button>
                        </div>
                        {lunchState.lastEvent && (
                          <span className="text-xs text-gray-500">
                            Out: {formatTime(lunchState.lastEvent.time)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1">
                          {statusBadge(s.lunch_status, "lunch")}
                          {lunchState.count > 1 && (
                            <span className="text-xs text-gray-500">×{lunchState.count}</span>
                          )}
                          <button
                            onClick={() => handleCheckAction(s.id, "lunch-out")}
                            className="px-1.5 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700 cursor-pointer hover:bg-yellow-200"
                          >
                            Out
                          </button>
                        </div>
                        {s.lunch_events && s.lunch_events.length > 0 && (
                          <div className="text-xs text-gray-500 truncate" title={
                            s.lunch_events.map(e => `${e.type === 'out' ? 'Out' : 'In'}: ${formatTime(e.time)}`).join(', ')
                          }>
                            {s.lunch_events.slice(-2).map((e, i) => (
                              <span key={i}>
                                {e.type === 'out' ? '→' : '←'}{formatTime(e.time)}
                                {i < Math.min(1, s.lunch_events!.length - 1) && ' '}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Check-out */}
                  <div className="flex items-center gap-1">
                    {editingTimeKey === `${s.id}:time_out` ? (
                      <input
                        type="time"
                        value={timeEditValue}
                        onChange={(e) => setTimeEditValue(e.target.value)}
                        onBlur={() => {
                          if (timeEditValue) handleTimeEdit(s.id, "time_out", timeEditValue);
                          else setEditingTimeKey(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && timeEditValue) handleTimeEdit(s.id, "time_out", timeEditValue);
                          if (e.key === "Escape") setEditingTimeKey(null);
                        }}
                        className="w-20 px-1 py-0.5 text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                        autoFocus
                      />
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingTimeKey(`${s.id}:time_out`);
                            if (s.time_out) {
                              const d = new Date(s.time_out);
                              setTimeEditValue(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
                            } else {
                              setTimeEditValue("");
                            }
                          }}
                          className={`text-sm cursor-pointer hover:underline ${s.time_out ? "text-gray-900" : "text-gray-400"}`}
                          title="Click to edit"
                        >
                          {formatTime(s.time_out)}
                        </button>
                        {s.time_in && !s.time_out && (
                          <button
                            onClick={() => handleCheckAction(s.id, "day-out")}
                            className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700 cursor-pointer hover:bg-blue-200"
                          >
                            +
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {/* Comments */}
                  <div className="relative">
                    {editingCommentId === s.id ? (
                      // Editing mode
                      <div className="flex flex-col gap-1">
                        <textarea
                          value={commentEditValue}
                          onChange={(e) => setCommentEditValue(e.target.value)}
                          placeholder="Add a comment..."
                          className="w-full px-2 py-1 text-xs border border-gray-300 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                          rows={2}
                          disabled={isSavingComment}
                          autoFocus
                        />
                        <div className="flex gap-1">
                          <button
                            onClick={async () => {
                              if (!commentEditValue.trim()) return;
                              setIsSavingComment(true);
                              try {
                                await handleCommentUpdate(
                                  s.id,
                                  commentEditValue.trim(),
                                );
                                setEditingCommentId(null);
                                setCommentEditValue("");
                              } catch (err) {
                                console.error("Failed to save comment:", err);
                              } finally {
                                setIsSavingComment(false);
                              }
                            }}
                            disabled={
                              !commentEditValue.trim() || isSavingComment
                            }
                            className={`flex-1 px-2 py-1 rounded text-xs font-medium ${
                              commentEditValue.trim() && !isSavingComment
                                ? "bg-blue-500 text-white hover:bg-blue-600 cursor-pointer"
                                : "bg-gray-200 text-gray-400 cursor-not-allowed"
                            }`}
                          >
                            {isSavingComment ? "Saving..." : "Save"}
                          </button>
                          <button
                            onClick={() => {
                              setEditingCommentId(null);
                              setCommentEditValue("");
                            }}
                            disabled={isSavingComment}
                            className="px-2 py-1 rounded text-xs border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      // Display mode with tooltip
                      <div className="group">
                        <button
                          onClick={() => {
                            setEditingCommentId(s.id);
                            setCommentEditValue(s.comments || "");
                          }}
                          className={`px-2 py-0.5 rounded text-xs cursor-pointer ${
                            s.comments
                              ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          }`}
                          title={s.comments || "Add comment"}
                        >
                          {s.comments ? "Comment" : "+ Add"}
                        </button>

                        {/* Tooltip on hover */}
                        {s.comments && (
                          <div className="absolute bottom-full left-0 mb-2 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none whitespace-normal max-w-xs">
                            {s.comments}
                            <div className="absolute top-full left-4 -mt-1 border-4 border-transparent border-t-gray-900"></div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {filtered.length === 0 && (
              <div className="text-center text-gray-600 py-20">
                No learners match your search / filter.
              </div>
            )}
          </div>
        )}

        {/* Pagination controls */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm text-gray-600">
              Showing <span className="font-semibold">{filtered.length}</span>{" "}
              of <span className="font-semibold">{totalItems}</span> learners
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
      {/* Modal for creating learner */}
      <CreateLearnerModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreate={handleCreateLearner}
        uid={uid}
      />
    </div>
  );
}
