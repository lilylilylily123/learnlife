"use client";
import { useState, useCallback, useMemo, useEffect } from "react";
import type { Student, AttendanceFilterKey, AttendanceCounts } from "../types";

export type { AttendanceCounts };

export function useAttendanceFilters(studentsWithAttendance: Student[]) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [programFilter, setProgramFilter] = useState<string>("all");
  const [attendanceFilter, setAttendanceFilter] =
    useState<AttendanceFilterKey>("all");

  // Debounce search input (300ms delay)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Classify a learner's presence state based on attendance data
  const getPresenceState = useCallback(
    (s: Student): "here" | "away" | "lunch" | "out" => {
      if (s.time_out) return "out";
      if (s.time_in) {
        const events = s.lunch_events || [];
        if (events.length > 0 && events[events.length - 1].type === "out")
          return "lunch";
        return "here";
      }
      return "away";
    },
    [],
  );

  // Compute counts for each attendance filter category
  const attendanceCounts = useMemo<AttendanceCounts>(() => {
    const counts: AttendanceCounts = {
      all: 0,
      here: 0,
      away: 0,
      lunch: 0,
      out: 0,
      present: 0,
      late: 0,
      absent: 0,
      jLate: 0,
      jAbsent: 0,
    };
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

  // Client-side filter for instant feedback while typing (before debounce triggers server fetch)
  const filtered = useMemo(() => {
    const results = studentsWithAttendance.filter((s) => {
      // Name search (local instant filter when typing ahead of debounce)
      if (search !== debouncedSearch) {
        const matchesName = s.name.toLowerCase().includes(search.toLowerCase());
        const matchesProgram =
          programFilter === "all" || s.program === programFilter;
        if (!matchesName || !matchesProgram) return false;
      }
      // Attendance presence / status filter
      if (attendanceFilter !== "all") {
        const statusFilters = [
          "present",
          "late",
          "absent",
          "jLate",
          "jAbsent",
        ];
        if (statusFilters.includes(attendanceFilter)) {
          if (s.status !== attendanceFilter) return false;
        } else {
          if (getPresenceState(s) !== attendanceFilter) return false;
        }
      }
      return true;
    });
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }, [
    studentsWithAttendance,
    search,
    debouncedSearch,
    programFilter,
    attendanceFilter,
    getPresenceState,
  ]);

  return {
    search,
    setSearch,
    debouncedSearch,
    programFilter,
    setProgramFilter,
    attendanceFilter,
    setAttendanceFilter,
    filtered,
    attendanceCounts,
    getPresenceState,
  };
}
