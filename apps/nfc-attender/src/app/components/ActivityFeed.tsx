"use client";
import { useEffect, useRef } from "react";
import {
  HEADING,
  KICKER,
  Kicker,
  Avatar,
  StatusPill,
  type ScanState,
} from "./ll-ui";

export interface ActivityEvent {
  id: string;
  learnerName: string;
  program: string;
  actionType: string;
  timestamp: Date;
  status?: string;
}

const ACTION_LABEL: Record<string, string> = {
  check_in: "Checked in",
  check_out: "Checked out",
  lunch_event: "Lunch",
  late_lunch_return: "Back from lunch · late",
  "morning-in": "Checked in",
  "lunch-out": "Out for lunch",
  "lunch-in": "Back from lunch",
  "day-out": "Checked out",
};

const PROGRAM_LABELS: Record<string, string> = {
  exp: "EXP",
  cre: "CRE",
  chmk: "CHMK",
};

function actionState(actionType: string): ScanState {
  if (actionType === "lunch-out" || actionType === "lunch_event") return "lunch";
  if (actionType === "day-out" || actionType === "check_out") return "out";
  return "in";
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

interface ActivityFeedProps {
  events: ActivityEvent[];
  onClose: () => void;
}

export function ActivityFeed({ events, onClose }: ActivityFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <aside
      className="fixed top-0 right-0 h-full flex flex-col z-50"
      style={{
        width: 340,
        background: "var(--ll-surface)",
        borderLeft: "1.5px solid var(--ll-ink)",
        color: "var(--ll-ink)",
        boxShadow: "-12px 0 28px -16px rgba(31, 27, 22, 0.25)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{
          padding: "16px 20px 14px",
          borderBottom: "1.5px solid var(--ll-ink)",
          background: "var(--ll-bg)",
          gap: 12,
        }}
      >
        <div className="flex items-baseline" style={{ gap: 10 }}>
          <Kicker>Live activity</Kicker>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--ll-muted)",
              letterSpacing: "0.04em",
            }}
          >
            {events.length} today
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="cursor-pointer ll-link"
          style={{
            ...KICKER,
            background: "transparent",
            border: "1px solid var(--ll-ink-2)",
            padding: "3px 9px",
            color: "var(--ll-ink)",
            fontSize: 12,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center h-full text-center"
            style={{ padding: 32, gap: 8 }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 999,
                border: "2px dashed var(--ll-divider)",
                animation: "ll-pulse 2s ease-in-out infinite",
              }}
            />
            <div style={{ ...HEADING, fontSize: 18, color: "var(--ll-ink-2)" }}>
              Nothing yet today.
            </div>
            <Kicker>Tap a card to begin</Kicker>
          </div>
        ) : (
          <>
            {events.map((ev, i) => {
              const fresh = i === events.length - 1;
              const state = actionState(ev.actionType);
              const programLabel =
                PROGRAM_LABELS[ev.program] ||
                (ev.program ? ev.program.toUpperCase() : "—");
              const label = ACTION_LABEL[ev.actionType] || ev.actionType;

              return (
                <div
                  key={ev.id}
                  className="flex items-center"
                  style={{
                    gap: 12,
                    padding: "11px 20px",
                    borderBottom: "1px solid var(--ll-divider)",
                    background: fresh
                      ? "color-mix(in srgb, var(--ll-accent) 12%, transparent)"
                      : "transparent",
                  }}
                >
                  <div
                    className="shrink-0"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--ll-muted)",
                      letterSpacing: "0.04em",
                      width: 56,
                      lineHeight: 1.2,
                    }}
                  >
                    {formatTime(ev.timestamp)}
                  </div>
                  <Avatar name={ev.learnerName} size={30} />
                  <div className="flex-1 min-w-0">
                    <div
                      className="truncate"
                      style={{ fontWeight: 600, fontSize: 13.5, lineHeight: 1.25 }}
                      title={ev.learnerName}
                    >
                      {ev.learnerName}
                    </div>
                    <div
                      className="truncate"
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10.5,
                        color: "var(--ll-muted)",
                        letterSpacing: "0.04em",
                        marginTop: 2,
                      }}
                    >
                      {programLabel} · {label}
                      {ev.status && ev.status !== "present" && ` · ${ev.status}`}
                    </div>
                  </div>
                  <StatusPill state={state} />
                </div>
              );
            })}
            <div ref={bottomRef} />
          </>
        )}
      </div>
    </aside>
  );
}
