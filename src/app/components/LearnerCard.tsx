"use client";
import React, { useState } from "react";
import prettyTimestamp from "../utils/format";
import { Learner } from "@/lib/pb-client";

interface LearnerCardProps {
  s: any;
  isCurrent: boolean;
  programClass: string;
  programLabel: string;
  onStatusChange: (id: string, status: string) => void;
  onCheckAction: (id: string, action: string) => void;
  onCommentUpdate?: (id: string, comment: string) => Promise<void>; // callback to update comments
  onReset?: (id: string) => void; // optional reset handler for test mode
  testTime?: Date | null; // optional override time for testing
  testMode?: boolean; // whether test mode is enabled
}

// Determine what action is currently available based on time and state
function getNextAction(
  s: any,
  now: Date,
): {
  action: string;
  label: string;
  available: boolean;
  reason?: string;
} | null {
  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeValue = hour + minute / 60; // e.g., 13.5 = 1:30 PM

  // Step 1: Morning check-in (available until they check in)

  if (!s.time_in) {
    return {
      action: "morning-in",
      label: "Check In",
      available: true,
    };
  }

  // Step 2 & 3: Lunch events (multiple possible during 1-2pm window)
  const lunchEvents = s.lunch_events || [];
  const lastLunchEvent =
    lunchEvents.length > 0 ? lunchEvents[lunchEvents.length - 1] : null;

  // If hour is 1pm (13:00) to before 2pm (14:00), allow multiple lunch events
  if (timeValue >= 13 && timeValue < 14) {
    // Determine next action based on last event
    if (!lastLunchEvent || lastLunchEvent.type === "in") {
      return {
        action: "lunch-out",
        label: `Lunch Out ${lunchEvents.length > 0 ? `(#${Math.ceil(lunchEvents.length / 2) + 1})` : ""}`,
        available: true,
      };
    } else {
      return {
        action: "lunch-in",
        label: `Lunch In ${lunchEvents.length > 1 ? `(#${Math.ceil(lunchEvents.length / 2)})` : ""}`,
        available: true,
      };
    }
  }

  // After 2pm, only allow lunch-in if currently at lunch
  if (timeValue >= 14 && lastLunchEvent && lastLunchEvent.type === "out") {
    return {
      action: "lunch-in",
      label: "Lunch In (Late!)",
      available: true,
      reason: "After 2:00 PM deadline",
    };
  }

  // Step 4: Day checkout (available at 5pm)
  if (!s.time_out) {
    if (timeValue >= 17) {
      return {
        action: "day-out",
        label: "Check Out",
        available: true,
      };
    }
    return {
      action: "day-out",
      label: "Check Out",
      available: false,
      reason: "Available at 5:00 PM",
    };
  }

  // All done for the day
  return null;
}

export const LearnerCard: React.FC<LearnerCardProps> = ({
  s,
  isCurrent,
  programClass,
  programLabel,
  onStatusChange,
  onCheckAction,
  onCommentUpdate,
  onReset,
  testTime,
  testMode,
}) => {
  const firstInitial = s?.name
    ? String(s.name.split(" ")[0][0]).toUpperCase()
    : "?";
  const formatTimestamp = (val?: string | null) =>
    prettyTimestamp(val, { compact: true });

  const now = testTime || new Date();
  const nextAction = getNextAction(s, now);

  // Comment state
  const [commentInput, setCommentInput] = useState("");
  const [isCommentExpanded, setIsCommentExpanded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Lunch events state
  const [showAllLunchEvents, setShowAllLunchEvents] = useState(false);

  const handleCommentSubmit = async () => {
    if (!commentInput.trim() || !onCommentUpdate) return;
    setIsSaving(true);
    try {
      await onCommentUpdate(s.id, commentInput.trim());
      setCommentInput("");
      setIsCommentExpanded(false);
    } catch (err) {
      console.error("Failed to save comment:", err);
    } finally {
      setIsSaving(false);
    }
  };

  // Show lunch section for all learners (removed program-based filter)
  const showLunchSection = true;

  return (
    <div
      className={`bg-white rounded-lg shadow-md p-3 max-w-64 flex flex-col items-center gap-2 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl ${isCurrent ? "border-2 border-green-400" : ""}`}
    >
      {/* Avatar + name + program */}
      <div className="flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-full bg-linear-to-br from-indigo-400 to-pink-400 flex items-center justify-center text-white font-bold text-lg">
          {firstInitial}
        </div>
        <div className="mt-3">
          <div
            title={s.name}
            className="font-semibold text-base text-gray-900 leading-tight wrap-break-word max-w-56"
          >
            {s.name}
          </div>
          <div
            className={`mt-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${programClass}`}
          >
            {programLabel}
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="w-full flex flex-col items-center mt-2">
        <div className="text-xs text-gray-900 font-medium">Status</div>
        <div className="mt-2">
          <div className="inline-flex rounded-full bg-gray-100 p-0.5 transition-all duration-200 items-center">
            <button
              onClick={() => onStatusChange(s.id, "present")}
              className={`px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-transform duration-150 active:scale-95 hover:scale-105 ${s.status === "present" ? "bg-green-200 text-green-900" : "text-gray-900"}`}
            >
              P
            </button>
            <button
              onClick={() => onStatusChange(s.id, "late")}
              className={`ml-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-transform duration-150 active:scale-95 hover:scale-105 ${s.status === "late" ? "bg-yellow-200 text-yellow-900" : "text-gray-900"}`}
            >
              L
            </button>
            <button
              onClick={() => onStatusChange(s.id, "absent")}
              className={`ml-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-transform duration-150 active:scale-95 hover:scale-105 ${s.status === "absent" ? "bg-red-200 text-red-900" : "text-gray-900"}`}
            >
              A
            </button>
            <button
              onClick={() => onStatusChange(s.id, "jLate")}
              className={`ml-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-transform duration-150 active:scale-95 hover:scale-105 ${s.status === "jLate" ? "bg-blue-200 text-blue-900" : "text-gray-900"}`}
            >
              JL
            </button>
            <button
              onClick={() => onStatusChange(s.id, "jAbsent")}
              className={`ml-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-transform duration-150 active:scale-95 hover:scale-105 ${s.status === "jAbsent" ? "bg-purple-200 text-purple-900" : "text-gray-900"}`}
            >
              JA
            </button>
          </div>
        </div>
      </div>

      {/* Timeline / Progress indicator */}
      <div className="w-full mt-3 px-2">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>Morning</span>
          {showLunchSection && <span>Lunch</span>}
          <span>Evening</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Morning check-in dot */}
          <div
            className={`w-3 h-3 rounded-full ${s.time_in ? "bg-green-500" : "bg-gray-300"}`}
            title={
              s.time_in
                ? `Checked in: ${formatTimestamp(s.time_in)}`
                : "Not checked in"
            }
          />
          <div
            className={`flex-1 h-0.5 ${s.time_in ? "bg-green-500" : "bg-gray-300"}`}
          />

          {showLunchSection && (
            <>
              {/* Lunch indicator - show based on lunch_events */}
              {(() => {
                const lunchEvents = s.lunch_events || [];
                const lastEvent =
                  lunchEvents.length > 0
                    ? lunchEvents[lunchEvents.length - 1]
                    : null;
                const hasLunch = lunchEvents.length > 0;
                const atLunch = lastEvent && lastEvent.type === "out";

                return (
                  <>
                    <div
                      className={`w-3 h-3 rounded-full ${hasLunch ? (atLunch ? "bg-yellow-500" : "bg-green-500") : "bg-gray-300"}`}
                      title={
                        hasLunch
                          ? `Lunch events: ${lunchEvents.length > 1 ? `${Math.ceil(lunchEvents.length / 2)}x` : ""} ${atLunch ? "Currently at lunch" : "Back from lunch"}`
                          : "No lunch break"
                      }
                    />
                    <div
                      className={`flex-1 h-0.5 ${hasLunch ? (atLunch ? "bg-yellow-500" : "bg-green-500") : "bg-gray-300"}`}
                    />
                    <div
                      className={`w-3 h-3 rounded-full ${hasLunch ? (atLunch ? "bg-yellow-500" : "bg-green-500") : "bg-gray-300"}`}
                      title={
                        hasLunch
                          ? atLunch
                            ? "Still at lunch"
                            : "Back from lunch"
                          : "—"
                      }
                    />
                    <div
                      className={`flex-1 h-0.5 ${s.time_out ? "bg-green-500" : hasLunch && !atLunch ? "bg-gray-300" : atLunch ? "bg-yellow-500" : "bg-gray-300"}`}
                    />
                  </>
                );
              })()}
            </>
          )}

          {!showLunchSection && (
            <div
              className={`flex-1 h-0.5 ${s.time_out ? "bg-green-500" : "bg-gray-300"}`}
            />
          )}

          {/* Day checkout dot */}
          <div
            className={`w-3 h-3 rounded-full ${s.time_out ? "bg-green-500" : "bg-gray-300"}`}
            title={
              s.time_out
                ? `Checked out: ${formatTimestamp(s.time_out)}`
                : "Not checked out"
            }
          />
        </div>
      </div>

      {/* Timestamps summary */}
      <div className="w-full grid grid-cols-2 gap-2 mt-2 text-xs">
        <div className="text-center">
          <div className="text-gray-500">In</div>
          <div className="font-medium">{formatTimestamp(s.time_in)}</div>
        </div>
        <div className="text-center">
          <div className="text-gray-500">Out</div>
          <div className="font-medium">{formatTimestamp(s.time_out)}</div>
        </div>
      </div>

      {/* Lunch timestamps and status - always visible */}
      {showLunchSection &&
        (() => {
          const lunchEvents = s.lunch_events || [];
          const lastEvent =
            lunchEvents.length > 0 ? lunchEvents[lunchEvents.length - 1] : null;
          const hasLunch = lunchEvents.length > 0;
          const atLunch = lastEvent && lastEvent.type === "out";
          const lunchCount = Math.ceil(lunchEvents.length / 2);

          return (
            <div className="w-full mt-2 border-t border-gray-100 pt-2">
              {hasLunch ? (
                <>
                  <div className="text-center text-xs mb-2">
                    <span className="font-medium text-gray-600">
                      🍽️ Lunch {lunchCount > 1 ? `(${lunchCount}x)` : ""}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 text-xs">
                    {(showAllLunchEvents
                      ? lunchEvents
                      : lunchEvents.slice(-3)
                    ).map((event: any, idx: any) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between px-2"
                      >
                        <span
                          className={
                            event.type === "out"
                              ? "text-yellow-600"
                              : "text-green-600"
                          }
                        >
                          {event.type === "out" ? "→ Out" : "← In"}
                        </span>
                        <span className="font-medium">
                          {formatTimestamp(event.time)}
                        </span>
                      </div>
                    ))}
                    {lunchEvents.length > 3 && !showAllLunchEvents && (
                      <button
                        onClick={() => setShowAllLunchEvents(true)}
                        className="text-center text-blue-500 hover:text-blue-700 cursor-pointer hover:underline"
                      >
                        ... {lunchEvents.length - 3} more
                      </button>
                    )}
                    {lunchEvents.length > 3 && showAllLunchEvents && (
                      <button
                        onClick={() => setShowAllLunchEvents(false)}
                        className="text-center text-blue-500 hover:text-blue-700 cursor-pointer hover:underline"
                      >
                        Show less
                      </button>
                    )}
                  </div>
                  {/* Lunch Status */}
                  {!atLunch && (
                    <div className="mt-2 flex flex-col items-center">
                      <div className="text-xs text-gray-500 mb-1">Status</div>
                      <div className="inline-flex rounded-full bg-gray-100 p-0.5 items-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            s.lunch_status === "present"
                              ? "bg-green-200 text-green-900"
                              : s.lunch_status === "late"
                                ? "bg-yellow-200 text-yellow-900"
                                : "bg-gray-200 text-gray-600"
                          }`}
                        >
                          {s.lunch_status === "present"
                            ? "On Time"
                            : s.lunch_status === "late"
                              ? "Late"
                              : "—"}
                        </span>
                      </div>
                    </div>
                  )}
                  {atLunch && (
                    <div className="mt-2 text-center">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                        Currently at Lunch
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center text-xs text-gray-400">
                  No lunch events
                </div>
              )}
            </div>
          );
        })()}

      {/* Next Action Button */}
      <div className="w-full mt-3">
        {nextAction ? (
          <div className="flex flex-col items-center">
            <button
              onClick={async () => {
                if (!nextAction.available) return;
                console.log(
                  `[LearnerCard] Button clicked: ${nextAction.action} for ${s.id}`,
                );
                try {
                  await onCheckAction(s.id, nextAction.action);
                  console.log(
                    `[LearnerCard] Action completed: ${nextAction.action}`,
                  );
                } catch (err) {
                  console.error(`[LearnerCard] Action failed:`, err);
                }
              }}
              disabled={!nextAction.available}
              className={`w-full py-2 px-4 rounded-lg text-sm font-semibold transition-all ${
                nextAction.available
                  ? nextAction.action === "lunch-in" && nextAction.reason
                    ? "bg-red-500 text-white hover:bg-red-600 cursor-pointer"
                    : nextAction.action === "morning-in"
                      ? "bg-green-500 text-white hover:bg-green-600 cursor-pointer"
                      : nextAction.action === "lunch-out"
                        ? "bg-yellow-500 text-white hover:bg-yellow-600 cursor-pointer"
                        : nextAction.action === "day-out"
                          ? "bg-blue-500 text-white hover:bg-blue-600 cursor-pointer"
                          : "bg-gray-500 text-white hover:bg-gray-600 cursor-pointer"
                  : "bg-gray-200 text-gray-500 cursor-not-allowed"
              }`}
            >
              {nextAction.label}
            </button>
            {nextAction.reason && (
              <div
                className={`text-xs mt-1 ${nextAction.available ? "text-red-600" : "text-gray-500"}`}
              >
                {nextAction.reason}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-2 px-4 rounded-lg bg-green-100 text-green-800 text-sm font-medium">
            ✓ Day complete
          </div>
        )}
      </div>

      {/* Reset button (test mode only) */}
      {testMode && onReset && (
        <button
          onClick={() => onReset(s.id)}
          className="w-full mt-2 py-1 px-2 rounded-lg border border-orange-300 bg-orange-50 text-orange-700 text-xs hover:bg-orange-100 cursor-pointer"
        >
          🔄 Reset Day
        </button>
      )}

      {/* Comments Section */}
      <div className="w-full mt-3 border-t border-gray-100 pt-3">
        {!isCommentExpanded ? (
          <div className="relative group">
            <button
              onClick={() => setIsCommentExpanded(true)}
              className={`w-full py-1.5 px-3 rounded-lg border text-xs hover:bg-gray-50 cursor-pointer flex items-center justify-center gap-1 ${
                s.comments
                  ? "border-blue-300 bg-blue-50 text-blue-700"
                  : "border-gray-300 bg-white text-gray-700"
              }`}
            >
              {s.comments ? "Comment" : "Add comment"}
            </button>

            {/* Tooltip on hover */}
            {s.comments && (
              <div className="absolute bottom-full left-0 right-0 mb-2 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10 pointer-events-none">
                <div className="wrap-break-word">{s.comments}</div>
                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900"></div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              placeholder={s.comments || "Add a comment..."}
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
              rows={3}
              disabled={isSaving}
            />
            <div className="flex gap-2">
              <button
                onClick={handleCommentSubmit}
                disabled={!commentInput.trim() || isSaving}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium ${
                  commentInput.trim() && !isSaving
                    ? "bg-blue-500 text-white hover:bg-blue-600 cursor-pointer"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed"
                }`}
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
              {s.comments && (
                <button
                  onClick={async () => {
                    if (!onCommentUpdate) return;
                    setIsSaving(true);
                    try {
                      await onCommentUpdate(s.id, "");
                      setCommentInput("");
                      setIsCommentExpanded(false);
                    } catch (err) {
                      console.error("Failed to clear comment:", err);
                    } finally {
                      setIsSaving(false);
                    }
                  }}
                  disabled={isSaving}
                  className="px-3 py-1.5 rounded-lg border border-red-300 bg-red-50 text-red-700 text-xs hover:bg-red-100 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Remove comment"
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => {
                  setIsCommentExpanded(false);
                  setCommentInput("");
                }}
                disabled={isSaving}
                className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xs hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export default React.memo(LearnerCard);
