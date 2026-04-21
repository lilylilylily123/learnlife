"use client";
import React, { useState } from "react";
import type { Student } from "../types";
import { programColor } from "./LearnerGrid";
import type { LunchEvent } from "@learnlife/pb-client";

// Format time only (no date) for compact display
function formatTime(val?: string | null) {
  if (!val) return "—";
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return val;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Determine lunch state from events array
function getLunchState(lunchEvents: LunchEvent[]) {
  if (lunchEvents.length === 0)
    return { state: "none" as const, lastEvent: null, count: 0 };
  const lastEvent = lunchEvents[lunchEvents.length - 1];
  const count = Math.ceil(lunchEvents.length / 2);
  if (lastEvent.type === "out") return { state: "out" as const, lastEvent, count };
  return { state: "in" as const, lastEvent, count };
}

// Morning/lunch status badge
function StatusBadge({
  status,
  type,
}: {
  status: string | undefined;
  type: "morning" | "lunch";
}) {
  if (!status) return <span className="text-gray-400 text-xs">—</span>;
  const colors: Record<string, string> = {
    present: "bg-green-100 text-green-800",
    late: "bg-yellow-100 text-yellow-800",
    absent: "bg-red-100 text-red-800",
  };
  const labels: Record<string, string> = {
    present: type === "lunch" ? "On Time" : "Present",
    late: "Late",
    absent: "Absent",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || "bg-gray-100 text-gray-600"}`}
    >
      {labels[status] || status}
    </span>
  );
}

interface LearnerListViewProps {
  filtered: Student[];
  uid: string;
  onStatusChange: (
    id: string,
    status: string,
    field?: "status" | "lunch_status",
    toggle?: boolean,
  ) => void;
  onCheckAction: (id: string, action: string) => void;
  onCommentUpdate: (id: string, comment: string) => Promise<void>;
  onTimeEdit: (
    learnerId: string,
    field: "time_in" | "time_out",
    timeStr: string,
  ) => Promise<void>;
}

export function LearnerListView({
  filtered,
  uid,
  onStatusChange,
  onCheckAction,
  onCommentUpdate,
  onTimeEdit,
}: LearnerListViewProps) {
  // Local editing state — only relevant to this view
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentEditValue, setCommentEditValue] = useState<string>("");
  const [isSavingComment, setIsSavingComment] = useState(false);
  const [editingTimeKey, setEditingTimeKey] = useState<string | null>(null); // "learnerId:field"
  const [timeEditValue, setTimeEditValue] = useState<string>("");

  return (
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
        const progClass = programColor((s.program as string) || "");
        const progLabel =
          s.program === "exp" ? "EXP" : s.program === "cre" ? "CRT" : "CHMK";
        const isCurrent = s.NFC_ID === uid;
        const lunchState = getLunchState(s.lunch_events || []);

        return (
          <div
            key={s.id}
            className={`grid grid-cols-[1.5fr_0.8fr_1.5fr_1fr_1.8fr_1fr_1.5fr] gap-3 items-center px-4 py-2 bg-white rounded-lg shadow-sm ${isCurrent ? "border-2 border-green-400" : ""}`}
          >
            {/* Name */}
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-linear-to-br from-indigo-400 to-pink-400 flex items-center justify-center text-white font-bold text-xs shrink-0">
                {s.name ? String(s.name.split(" ")[0][0]).toUpperCase() : "?"}
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
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${progClass}`}
              >
                {progLabel}
              </span>
            </div>

            {/* Morning Status */}
            <div className="flex gap-1">
              {(
                [
                  { key: "present", label: "P", activeClass: "bg-green-200 text-green-900", hoverClass: "hover:bg-green-50" },
                  { key: "late", label: "L", activeClass: "bg-yellow-200 text-yellow-900", hoverClass: "hover:bg-yellow-50" },
                  { key: "absent", label: "A", activeClass: "bg-red-200 text-red-900", hoverClass: "hover:bg-red-50" },
                  { key: "jLate", label: "JL", activeClass: "bg-blue-200 text-blue-900", hoverClass: "hover:bg-blue-50" },
                  { key: "jAbsent", label: "JA", activeClass: "bg-purple-200 text-purple-900", hoverClass: "hover:bg-purple-50" },
                ] as const
              ).map(({ key, label, activeClass, hoverClass }) => (
                <button
                  key={key}
                  onClick={() => onStatusChange(s.id, key)}
                  className={`px-1.5 py-0.5 rounded-full text-xs font-medium cursor-pointer ${
                    s.status === key
                      ? activeClass
                      : `bg-gray-100 text-gray-700 ${hoverClass}`
                  }`}
                  title={key}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Check-in */}
            <div className="flex items-center gap-1 pl-3">
              {editingTimeKey === `${s.id}:time_in` ? (
                <input
                  type="time"
                  value={timeEditValue}
                  onChange={(e) => setTimeEditValue(e.target.value)}
                  onBlur={() => {
                    if (timeEditValue)
                      onTimeEdit(s.id, "time_in", timeEditValue);
                    else setEditingTimeKey(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && timeEditValue)
                      onTimeEdit(s.id, "time_in", timeEditValue);
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
                        setTimeEditValue(
                          `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
                        );
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
                      onClick={() => onCheckAction(s.id, "morning-in")}
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
              {lunchState.state === "none" ? (
                <div className="flex items-center gap-1">
                  <span className="text-sm text-gray-400">—</span>
                  {s.time_in && (
                    <button
                      onClick={() => onCheckAction(s.id, "lunch-out")}
                      className="px-1.5 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700 cursor-pointer hover:bg-yellow-200"
                    >
                      Out
                    </button>
                  )}
                </div>
              ) : lunchState.state === "out" ? (
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                      At Lunch{" "}
                      {lunchState.count > 1 ? `(${lunchState.count})` : ""}
                    </span>
                    <button
                      onClick={() => onCheckAction(s.id, "lunch-in")}
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
                    <StatusBadge status={s.lunch_status} type="lunch" />
                    {lunchState.count > 1 && (
                      <span className="text-xs text-gray-500">
                        ×{lunchState.count}
                      </span>
                    )}
                    <button
                      onClick={() => onCheckAction(s.id, "lunch-out")}
                      className="px-1.5 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700 cursor-pointer hover:bg-yellow-200"
                    >
                      Out
                    </button>
                  </div>
                  {s.lunch_events && s.lunch_events.length > 0 && (
                    <div
                      className="text-xs text-gray-500 truncate"
                      title={s.lunch_events
                        .map(
                          (e) =>
                            `${e.type === "out" ? "Out" : "In"}: ${formatTime(e.time)}`,
                        )
                        .join(", ")}
                    >
                      {s.lunch_events.slice(-2).map((e, i) => (
                        <span key={i}>
                          {e.type === "out" ? "→" : "←"}
                          {formatTime(e.time)}
                          {i < Math.min(1, s.lunch_events!.length - 1) && " "}
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
                    if (timeEditValue)
                      onTimeEdit(s.id, "time_out", timeEditValue);
                    else setEditingTimeKey(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && timeEditValue)
                      onTimeEdit(s.id, "time_out", timeEditValue);
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
                        setTimeEditValue(
                          `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
                        );
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
                      onClick={() => onCheckAction(s.id, "day-out")}
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
                          await onCommentUpdate(s.id, commentEditValue.trim());
                          setEditingCommentId(null);
                          setCommentEditValue("");
                        } catch (err) {
                          console.error("Failed to save comment:", err);
                        } finally {
                          setIsSavingComment(false);
                        }
                      }}
                      disabled={!commentEditValue.trim() || isSavingComment}
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
  );
}
