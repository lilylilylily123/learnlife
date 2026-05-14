"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { pb } from "../pb";
import { useNfcLearner } from "../hooks/useNfcLearner";
import { useIsPrivileged } from "../hooks/useIsPrivileged";
import { useAutoAbsentSweep } from "../hooks/useAutoAbsentSweep";
import * as pbClient from "@/lib/pb-client";
import Account from "../components/Account";
import { UpdateNotification } from "../components/UpdateNotification";
import {
  HEADING,
  KICKER,
  Avatar,
  Kicker,
  LMark,
  Pill,
  StatusPill,
  type ScanState,
} from "../components/ll-ui";

const PROGRAM_LABEL: Record<string, string> = {
  exp: "Explorers",
  cre: "Creators",
  chmk: "Changemakers",
  pf: "Pathfinders",
};

interface LatestScan {
  learnerId: string;
  learnerName: string;
  program: string;
  state: ScanState;
  action: "check_in" | "check_out" | "lunch_out" | "lunch_in";
  at: Date;
}

function presenceFromRecord(rec: any): ScanState {
  if (rec?.time_out) return "out";
  const events: any[] = Array.isArray(rec?.lunch_events) ? rec.lunch_events : [];
  if (events.length && events[events.length - 1]?.type === "out") return "lunch";
  if (rec?.time_in) return "in";
  return "absent";
}

function inferAction(
  prev: any,
  next: any,
): LatestScan["action"] | null {
  if (!prev?.time_in && next?.time_in) return "check_in";
  if (!prev?.time_out && next?.time_out) return "check_out";
  const prevEvents: any[] = Array.isArray(prev?.lunch_events) ? prev.lunch_events : [];
  const nextEvents: any[] = Array.isArray(next?.lunch_events) ? next.lunch_events : [];
  if (nextEvents.length > prevEvents.length) {
    const last = nextEvents[nextEvents.length - 1];
    return last?.type === "out" ? "lunch_out" : "lunch_in";
  }
  return null;
}

function actionLabel(action: LatestScan["action"]): string {
  switch (action) {
    case "check_in": return "Checked in";
    case "check_out": return "Checked out";
    case "lunch_out": return "Out to lunch";
    case "lunch_in": return "Back from lunch";
  }
}

function timeAgo(d: Date): string {
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

export default function KioskPage() {
  const isLoggedIn = useIsPrivileged();
  const { uid, exists } = useNfcLearner();
  const [latest, setLatest] = useState<LatestScan | null>(null);
  const prevRecordsRef = useRef<Record<string, any>>({});
  const [, forceTick] = useState(0);

  // Re-render once a second so the "X s ago" label stays fresh.
  useEffect(() => {
    if (!latest) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [latest]);

  useAutoAbsentSweep({
    enabled: isLoggedIn,
    viewDate: useMemo(() => new Date().toISOString().split("T")[0], []),
    testMode: false,
    testTime: null,
  });

  const resolveLearner = useCallback(async (learnerId: string) => {
    try {
      return await pbClient.getLearnerById(learnerId);
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    let unsub: (() => void) | undefined;

    (async () => {
      try {
        const u = await pb.collection("attendance").subscribe("*", async (e) => {
          if (e.action !== "create" && e.action !== "update") return;
          const rec = e.record as any;
          const learnerId = rec?.learner;
          if (!learnerId) return;
          const prev = prevRecordsRef.current[learnerId] ?? {};
          const action = inferAction(prev, rec);
          prevRecordsRef.current[learnerId] = rec;
          if (!action) return;
          const learner = await resolveLearner(learnerId);
          if (!learner) return;
          setLatest({
            learnerId,
            learnerName: (learner as any).name ?? "Learner",
            program: ((learner as any).program as string) ?? "",
            state: presenceFromRecord(rec),
            action,
            at: new Date(),
          });
        });
        if (cancelled) {
          try { u(); } catch {}
          return;
        }
        unsub = u;
      } catch (err) {
        console.warn("[kiosk] realtime subscribe failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      try { unsub?.(); } catch {}
    };
  }, [isLoggedIn, resolveLearner]);

  if (!isLoggedIn) {
    return <Account />;
  }

  const idle = !latest;
  const readerLive = !uid || exists;

  return (
    <>
      <UpdateNotification />
      <div
        className="flex flex-col h-screen w-screen overflow-hidden"
        style={{ background: "var(--ll-bg)", color: "var(--ll-ink)" }}
      >
        <header
          className="flex items-center justify-between shrink-0"
          style={{
            padding: "20px 32px",
            borderBottom: "1.5px solid var(--ll-divider)",
            background: "var(--ll-surface)",
          }}
        >
          <div className="flex items-center" style={{ gap: 14 }}>
            <LMark size={36} />
            <div>
              <Kicker>Attender · Kiosk</Kicker>
              <div style={{ ...HEADING, fontSize: 20, marginTop: 2 }}>
                Tap to check in
              </div>
            </div>
          </div>
          <div className="flex items-center" style={{ gap: 14 }}>
            <div
              className="flex items-center"
              style={{
                gap: 6,
                border: `1.5px solid ${readerLive ? "var(--ll-ink)" : "var(--ll-warm)"}`,
                background: "var(--ll-bg)",
                padding: "4px 10px",
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: readerLive ? "var(--ll-accent)" : "var(--ll-warm)",
                  animation: "ll-pulse 1.5s ease-in-out infinite",
                }}
              />
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.06em",
                  color: readerLive ? "var(--ll-muted)" : "var(--ll-warm)",
                  textTransform: "uppercase",
                }}
              >
                {uid && !exists ? `Unknown · ${uid.slice(0, 8)}` : "Reader live"}
              </div>
            </div>
            <Link href="/" style={{ textDecoration: "none" }}>
              <Pill size="sm">Exit kiosk</Pill>
            </Link>
          </div>
        </header>

        <main
          className="flex-1 flex flex-col items-center justify-center text-center"
          style={{ gap: 28, padding: "48px 32px" }}
        >
          {idle ? (
            <>
              <div
                style={{
                  width: 220,
                  height: 220,
                  borderRadius: 999,
                  border: `2.5px dashed ${uid && !exists ? "var(--ll-warm)" : "var(--ll-divider)"}`,
                  animation: "ll-pulse 2.4s ease-in-out infinite",
                }}
              />
              <div>
                <div
                  style={{
                    ...HEADING,
                    fontSize: 56,
                    lineHeight: 1.05,
                    color: "var(--ll-ink)",
                    letterSpacing: "-0.025em",
                  }}
                >
                  {uid && !exists ? "Card not registered" : "Tap your card to check in"}
                </div>
                <div
                  className="mt-3"
                  style={{
                    ...KICKER,
                    fontSize: 12,
                    color: "var(--ll-muted)",
                  }}
                >
                  {uid && !exists ? uid : "Hold your card to the reader"}
                </div>
              </div>
            </>
          ) : (
            <>
              <Kicker style={{ fontSize: 12 }}>
                ✓ {actionLabel(latest.action)} · {timeAgo(latest.at)}
              </Kicker>
              <Avatar name={latest.learnerName} size={220} />
              <div>
                <div
                  style={{
                    ...HEADING,
                    fontSize: 72,
                    lineHeight: 1.02,
                    letterSpacing: "-0.03em",
                  }}
                >
                  {latest.learnerName}
                </div>
                <div
                  className="mt-3"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 14,
                    color: "var(--ll-muted)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  {PROGRAM_LABEL[latest.program] || latest.program || "—"}
                </div>
              </div>
              <StatusPill state={latest.state} />
            </>
          )}
        </main>
      </div>
    </>
  );
}
