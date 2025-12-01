"use client";
import { useEffect, useState, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { pb } from "../pb";
import { getLearnerByNfc, checkLearnerIn } from "../utils/utils";

interface NfcHookOptions {
  testTime?: Date | null;
  testDate?: string | null; // YYYY-MM-DD format
}

export function useNfcLearner(options?: NfcHookOptions) {
  const [uid, setUid] = useState("");
  const [learner, setLearner] = useState<any>(null);
  const [exists, setExists] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(false);
  
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

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    (async () => {
      unlisten = await listen<string>("nfc-scanned", async (event) => {
        const scannedUid = event.payload;
        setIsLoading(true);
        
        // Get current options from ref
        const currentOptions = optionsRef.current;
        console.log(`[useNfcLearner] NFC scanned: ${scannedUid}`);
        console.log(`[useNfcLearner] Using options:`, {
          testTime: currentOptions?.testTime?.toLocaleTimeString() || 'real time',
          testDate: currentOptions?.testDate || 'today',
        });

        try {
          // Single DB query instead of 3 separate ones
          const data = await getLearnerByNfc(scannedUid);
          const learnerExists = !!data;
          
          setExists(learnerExists);
          setLearner(data);
          setUid(scannedUid);

          if (data) {
            console.log(`[useNfcLearner] Calling checkLearnerIn`);
            await checkLearnerIn(data.NFC_ID, {
              testTime: currentOptions?.testTime,
              testDate: currentOptions?.testDate,
            });
          }
        } catch (err) {
          console.error("NFC handling error:", err);
        } finally {
          setIsLoading(false);
        }
      });
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  return { uid, learner, exists, isLoading };
}
