"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { getLearnerByNfc, checkLearnerIn } from "../utils/utils";

interface NfcHookOptions {
  testTime?: Date | null;
  testDate?: string | null; // YYYY-MM-DD format
}

interface ScanJob {
  uid: string;
  timestamp: number;
}

export function useNfcLearner(options?: NfcHookOptions) {
  const [uid, setUid] = useState("");
  const [learner, setLearner] = useState<any>(null);
  const [exists, setExists] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(false);

  // Queue instead of drop-lock: scans are queued and processed sequentially
  const queueRef = useRef<ScanJob[]>([]);
  const processingRef = useRef(false);

  // Use ref to always have latest options in event listener
  const optionsRef = useRef<NfcHookOptions | undefined>(options);

  // Keep ref in sync with prop
  useEffect(() => {
    console.log(`[useNfcLearner] options changed:`, {
      testTime: options?.testTime?.toLocaleTimeString() || 'null',
      testDate: options?.testDate || 'null',
    });
    optionsRef.current = options;
  }, [options?.testTime, options?.testDate]);

  // Process the queue sequentially
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    while (queueRef.current.length > 0) {
      const job = queueRef.current.shift()!;
      const scannedUid = job.uid;

      // Skip stale scans (older than 30 seconds)
      if (Date.now() - job.timestamp > 30000) {
        console.log(`[useNfcLearner] Skipping stale scan: ${scannedUid}`);
        continue;
      }

      // Deduplicate: skip if same UID is already next in queue (double-tap)
      if (queueRef.current.length > 0 && queueRef.current[0].uid === scannedUid) {
        console.log(`[useNfcLearner] Deduplicating scan: ${scannedUid}`);
        continue;
      }

      setIsLoading(true);
      const currentOptions = optionsRef.current;
      console.log(`[useNfcLearner] Processing scan: ${scannedUid} (queue: ${queueRef.current.length} remaining)`);

      try {
        const data = await getLearnerByNfc(scannedUid);
        const learnerExists = !!data;

        setExists(learnerExists);
        setLearner(data);
        setUid(scannedUid);

        if (data) {
          console.log(`[useNfcLearner] Calling checkLearnerIn for ${data.name}`);
          await checkLearnerIn(data.NFC_ID, {
            testTime: currentOptions?.testTime,
            testDate: currentOptions?.testDate,
            learnerData: data,
          });
        }
      } catch (err) {
        console.error("[useNfcLearner] NFC handling error:", err);
      } finally {
        setIsLoading(false);
      }
    }

    processingRef.current = false;
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    (async () => {
      unlisten = await listen<string>("nfc-scanned", (event) => {
        const scannedUid = event.payload;
        console.log(`[useNfcLearner] NFC scanned, queuing: ${scannedUid}`);

        // Add to queue
        queueRef.current.push({ uid: scannedUid, timestamp: Date.now() });

        // Kick off processing (no-op if already running)
        processQueue();
      });
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, [processQueue]);

  return { uid, learner, exists, isLoading };
}
