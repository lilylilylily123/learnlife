"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as pbClient from "@/lib/pb-client";
import type { AttendanceRecord, Learner } from "@learnlife/pb-client";
import {
  summarizeByLearner,
  emptySummary,
  type AttendanceSummary,
} from "@learnlife/shared";

export type RangePreset = "1d" | "3d" | "7d" | "14d" | "month" | "custom";

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

/**
 * Resolve a preset to a concrete [from, to] pair.
 * Rolling N-day presets count backwards from today (inclusive). "month"
 * resolves to the 1st of the current calendar month through today.
 */
export function resolveRange(preset: RangePreset, custom?: DateRange): DateRange {
  if (preset === "custom" && custom) return custom;
  const today = new Date();
  const to = formatDate(today);

  if (preset === "month") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: formatDate(first), to };
  }

  const days = preset === "1d" ? 1 : preset === "3d" ? 3 : preset === "7d" ? 7 : 14;
  const fromDate = new Date(today);
  fromDate.setDate(today.getDate() - (days - 1));
  return { from: formatDate(fromDate), to };
}

function formatDate(d: Date): string {
  // Local-timezone YYYY-MM-DD — matches how PocketBase rows store `date`.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface UseAdminHistoryDataOptions {
  isLoggedIn: boolean;
  range: DateRange;
  programFilter: string; // "all" or a ProgramCode
}

export interface LearnerRow {
  learner: Learner;
  summary: AttendanceSummary;
  records: AttendanceRecord[]; // raw records for drill-down view, sorted by date desc
}

export function useAdminHistoryData({
  isLoggedIn,
  range,
  programFilter,
}: UseAdminHistoryDataOptions) {
  const [learners, setLearners] = useState<Learner[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLearners = useCallback(async () => {
    const result = await pbClient.listLearners({
      perPage: 500,
      program: programFilter !== "all" ? programFilter : undefined,
    });
    setLearners(result.items as unknown as Learner[]);
  }, [programFilter]);

  const fetchAttendance = useCallback(async () => {
    const items = await pbClient.listAllAttendance({
      dateFrom: range.from,
      dateTo: range.to,
      perPage: 200,
    });
    setRecords(items as unknown as AttendanceRecord[]);
  }, [range.from, range.to]);

  const refresh = useCallback(async () => {
    if (!isLoggedIn) return;
    setLoading(true);
    setError(null);
    try {
      await Promise.all([fetchLearners(), fetchAttendance()]);
    } catch (err) {
      console.error("Admin history fetch failed:", err);
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn, fetchLearners, fetchAttendance]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Build per-learner rows, including learners with zero records in range so
  // admins can spot "never showed up" cases. Pre-filter records by the
  // currently loaded learner set to keep cohort totals consistent when the
  // program filter narrows things down.
  const rows = useMemo<LearnerRow[]>(() => {
    const learnerIds = new Set(learners.map((l) => l.id));
    const scopedRecords = records.filter((r) => learnerIds.has(r.learner));
    const byLearner = summarizeByLearner(scopedRecords);
    const recordsByLearner = new Map<string, AttendanceRecord[]>();
    for (const r of scopedRecords) {
      const arr = recordsByLearner.get(r.learner);
      if (arr) arr.push(r);
      else recordsByLearner.set(r.learner, [r]);
    }
    // Sort each learner's records by date desc for drill-down display.
    for (const arr of recordsByLearner.values()) {
      arr.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    }
    return learners.map((learner) => ({
      learner,
      summary: byLearner.get(learner.id) ?? emptySummary(),
      records: recordsByLearner.get(learner.id) ?? [],
    }));
  }, [learners, records]);

  return { rows, learners, records, loading, error, refresh };
}
