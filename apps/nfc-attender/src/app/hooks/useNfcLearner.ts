"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { checkLearnerIn, type CheckInResult } from "../utils/utils";
import { getLearnerByNfc } from "@/lib/pb-client";
import { pb } from "@/app/pb";
import { debug } from "@/lib/debug";

interface NfcHookOptions {
  testTime?: Date | null;   // Simulated time (overrides real clock for check-in logic)
  testDate?: string | null; // Simulated date in YYYY-MM-DD format (overrides real date)
}

/** A single NFC scan job waiting to be processed. */
interface ScanJob {
  uid: string;
  timestamp: number; // ms since epoch — used to detect and discard stale scans
}

/**
 * React hook that listens for NFC card scans via a Tauri IPC event, processes
 * them sequentially through a queue, and exposes the latest scan result.
 *
 * Queue design: NFC readers can fire multiple events for a single card swipe
 * (card dwell time). Rather than dropping scans while one is in-flight (which
 * loses legitimate back-to-back scans during busy arrival periods), all scans
 * are queued and processed one at a time. Stale scans (>30 s old) and
 * consecutive duplicate UIDs are discarded before processing.
 */
export function useNfcLearner(options?: NfcHookOptions) {
  const [uid, setUid] = useState("");
  const [learner, setLearner] = useState<any>(null); // TODO: type as Learner from pb-client
  const [exists, setExists] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lastAction, setLastAction] = useState<CheckInResult | null>(null);

  // Pending scan jobs; a ref keeps the queue mutable without triggering re-renders.
  const queueRef = useRef<ScanJob[]>([]);
  // Prevents concurrent processQueue invocations.
  const processingRef = useRef(false);

  // Keep a ref to the latest options so the Tauri event listener (registered
  // once) always reads the most recent testTime/testDate without needing to
  // re-register itself.
  const optionsRef = useRef<NfcHookOptions | undefined>(options);

  // Sync the ref whenever the caller's options change.
  useEffect(() => {
    debug.log(`[useNfcLearner] options changed:`, {
      testTime: options?.testTime?.toLocaleTimeString() || 'null',
      testDate: options?.testDate || 'null',
    });
    optionsRef.current = options;
  }, [options?.testTime, options?.testDate]);

  /**
   * Drain the scan queue one job at a time.
   * `processingRef` acts as a mutex so only one invocation runs at a time.
   */
  const processQueue = useCallback(async () => {
    if (processingRef.current) return; // another invocation is already running
    processingRef.current = true;

    while (queueRef.current.length > 0) {
      const job = queueRef.current.shift()!;
      const scannedUid = job.uid;

      // Discard scans that were queued more than 30 seconds ago (e.g. during
      // an offline period or a previous processing backlog).
      if (Date.now() - job.timestamp > 30000) {
        debug.log(`[useNfcLearner] Skipping stale scan`);
        continue;
      }

      // Deduplicate consecutive scans of the same card: if the very next item
      // in the queue is the same UID, this was a double-tap and we skip it.
      if (queueRef.current.length > 0 && queueRef.current[0].uid === scannedUid) {
        debug.log(`[useNfcLearner] Deduplicating scan`);
        continue;
      }

      setIsLoading(true);
      // Capture options at the time of processing, not at event arrival.
      const currentOptions = optionsRef.current;
      debug.log(`[useNfcLearner] Processing scan (queue: ${queueRef.current.length} remaining)`);

      try {
        const data = await getLearnerByNfc(scannedUid);
        const learnerExists = !!data;

        setExists(learnerExists);
        setLearner(data);
        setUid(scannedUid);

        if (data) {
          debug.log(`[useNfcLearner] Calling checkLearnerIn`);
          const result = await checkLearnerIn(scannedUid, {
            testTime: currentOptions?.testTime,
            testDate: currentOptions?.testDate,
            learnerData: data, // pass the already-fetched record to save a round-trip
          });
          if (result) setLastAction(result);
        }
      } catch (err) {
        debug.error("[useNfcLearner] NFC handling error:", err);
      } finally {
        setIsLoading(false);
      }
    }

    processingRef.current = false;
  }, []);

  // Register the Tauri event listener once on mount; enqueue every scan.
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    (async () => {
      unlisten = await listen<string>("nfc-scanned", (event) => {
        // Drop scans when no privileged user is signed in — prevents writes
        // landing under a stale or learner-role session.
        const role = (pb.authStore.record as { role?: string } | null)?.role;
        if (!pb.authStore.isValid || (role !== "admin" && role !== "lg")) {
          return;
        }

        const scannedUid = event.payload;
        debug.log(`[useNfcLearner] NFC scanned, queuing`);

        queueRef.current.push({ uid: scannedUid, timestamp: Date.now() });

        // Kick off queue processing (no-op if already running).
        processQueue();
      });
    })();

    // Whenever the auth state changes (login/logout), drop any queued scans
    // so an in-flight job can't write under a previous session's identity.
    const unsubscribeAuth = pb.authStore.onChange(() => {
      if (queueRef.current.length > 0) {
        debug.log(
          `[useNfcLearner] Auth changed, dropping ${queueRef.current.length} queued scan(s)`,
        );
        queueRef.current = [];
      }
    });

    return () => {
      if (unlisten) unlisten();
      unsubscribeAuth();
    };
  }, [processQueue]);

  /** Simulate an NFC scan without a physical reader (for test mode). */
  const simulateScan = useCallback((nfcUid: string) => {
    debug.log(`[useNfcLearner] Simulating scan`);
    queueRef.current.push({ uid: nfcUid, timestamp: Date.now() });
    processQueue();
  }, [processQueue]);

  return { uid, learner, exists, isLoading, lastAction, simulateScan };
}
