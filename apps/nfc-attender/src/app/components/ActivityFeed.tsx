"use client";
import { useEffect, useRef } from "react";

export interface ActivityEvent {
  id: string;
  learnerName: string;
  program: string;
  actionType: string;
  timestamp: Date;
  status?: string;
}

const ACTION_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  check_in: { label: "Checked in", icon: "→", color: "bg-green-100 text-green-700" },
  check_out: { label: "Checked out", icon: "←", color: "bg-blue-100 text-blue-700" },
  lunch_event: { label: "Lunch", icon: "🍽", color: "bg-orange-100 text-orange-700" },
  late_lunch_return: { label: "Back from lunch (late)", icon: "←", color: "bg-yellow-100 text-yellow-700" },
  "morning-in": { label: "Checked in", icon: "→", color: "bg-green-100 text-green-700" },
  "lunch-out": { label: "Lunch out", icon: "→", color: "bg-orange-100 text-orange-700" },
  "lunch-in": { label: "Back from lunch", icon: "←", color: "bg-green-100 text-green-700" },
  "day-out": { label: "Checked out", icon: "←", color: "bg-blue-100 text-blue-700" },
};

const PROGRAM_COLORS: Record<string, string> = {
  exp: "bg-rose-100 text-rose-700",
  cre: "bg-emerald-100 text-emerald-700",
  chmk: "bg-sky-100 text-sky-700",
};

const PROGRAM_LABELS: Record<string, string> = {
  exp: "EXP",
  cre: "CRE",
  chmk: "CHMK",
};

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
    <div className="fixed top-0 right-0 h-full w-80 bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-lg">📡</span>
          <h2 className="font-bold text-gray-900 text-sm">Live Activity</h2>
          <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
            {events.length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg bg-gray-200 text-gray-600 hover:bg-gray-300 flex items-center justify-center text-sm cursor-pointer"
        >
          ×
        </button>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <span className="text-3xl mb-2">👋</span>
            <p className="text-sm">Waiting for scans...</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {events.map((ev) => {
              const config = ACTION_CONFIG[ev.actionType] || {
                label: ev.actionType,
                icon: "•",
                color: "bg-gray-100 text-gray-700",
              };
              const programColor = PROGRAM_COLORS[ev.program] || "bg-gray-100 text-gray-600";
              const programLabel = PROGRAM_LABELS[ev.program] || ev.program.toUpperCase();

              return (
                <div
                  key={ev.id}
                  className="flex items-start gap-2.5 p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  {/* Action icon */}
                  <div className={`w-8 h-8 rounded-lg ${config.color} flex items-center justify-center text-sm font-bold shrink-0`}>
                    {config.icon}
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-gray-900 text-sm truncate">
                        {ev.learnerName}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${programColor}`}>
                        {programLabel}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`text-xs font-medium ${config.color.split(" ")[1]}`}>
                        {config.label}
                      </span>
                      {ev.status && ev.status !== "present" && (
                        <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-700">
                          {ev.status}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400 mt-0.5 block">
                      {formatTime(ev.timestamp)}
                    </span>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}
