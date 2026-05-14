"use client";
import { useCallback, useEffect, useRef } from "react";
import { findLearnersToMarkAbsent } from "@learnlife/shared";
import { TIME_THRESHOLDS } from "@learnlife/pb-client";
import * as pbClient from "@/lib/pb-client";

interface SweepOptions {
  enabled: boolean;
  viewDate: string;
  testMode: boolean;
  testTime: Date | null;
}

// Server-side PB cron isn't available in this hosting setup, so any open
// guide screen runs the sweep on a 1-minute timer. Idempotent — gated to
// once-per-day via lastSweptDateRef but only after every write succeeded.
export function useAutoAbsentSweep({ enabled, viewDate, testMode, testTime }: SweepOptions) {
  const lastSweptDateRef = useRef<string | null>(null);

  const runAbsentSweep = useCallback(async () => {
    const todayStr = new Date().toISOString().split("T")[0];
    if (viewDate !== todayStr) return;
    if (lastSweptDateRef.current === todayStr) return;

    const now = testMode && testTime ? testTime : new Date();

    // Pull fresh data each tick so a kiosk-only window stays consistent with
    // whatever the dashboard has been writing.
    let records: any[] = [];
    let learners: { id: string }[] = [];
    try {
      const [attResult, learnersResult] = await Promise.all([
        pbClient.listAttendance({ date: todayStr, perPage: 500 }),
        pbClient.listLearners({ page: 1, perPage: 500 }),
      ]);
      records = attResult.items;
      learners = learnersResult.items.map((l) => ({ id: l.id }));
    } catch (err) {
      console.warn("[auto-absent] fetch failed:", err);
      return;
    }

    const toMark = findLearnersToMarkAbsent(records, learners, now);

    const hour = now.getHours();
    const minute = now.getMinutes();
    const pastCutoff =
      hour > TIME_THRESHOLDS.ABSENT_HOUR ||
      (hour === TIME_THRESHOLDS.ABSENT_HOUR && minute >= TIME_THRESHOLDS.ABSENT_MINUTE);
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;

    if (toMark.length === 0) {
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
          fields: { arrival: "absent", justified: false, status: "absent" },
        });
        okCount++;
      } catch (err) {
        failedIds.push(learnerId);
        console.error(`[auto-absent] failed for ${learnerId}:`, err);
      }
    }
    console.log(`[auto-absent] ${okCount}/${toMark.length} succeeded`);
    if (failedIds.length === 0) {
      lastSweptDateRef.current = todayStr;
    } else {
      console.warn(`[auto-absent] will retry next tick for: ${failedIds.join(", ")}`);
    }
  }, [viewDate, testMode, testTime]);

  useEffect(() => {
    if (!enabled) return;
    const tick = () => { runAbsentSweep().catch(() => {}); };
    tick();
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, [enabled, runAbsentSweep]);
}
