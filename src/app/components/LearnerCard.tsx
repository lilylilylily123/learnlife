"use client";
import React from "react";
import prettyTimestamp from "../utils/format";

interface LearnerCardProps {
  s: any;
  isCurrent: boolean;
  programClass: string;
  programLabel: string;
  onStatusChange: (id: string, status: string) => void;
  onCheckAction: (id: string, action: string) => void;
  onReset?: (id: string) => void; // optional reset handler for test mode
  testTime?: Date | null; // optional override time for testing
  testMode?: boolean; // whether test mode is enabled
}

// Determine what action is currently available based on time and state
function getNextAction(s: any, now: Date): { action: string; label: string; available: boolean; reason?: string } | null {
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

  // Step 2: Lunch out (available after 1pm, only if not already out)
  if (!s.lunch_out) {
    if (timeValue >= 13) {
      return {
        action: "lunch-out",
        label: "Lunch Out",
        available: true,
      };
    }
    // Before lunch window, show as upcoming
    return {
      action: "lunch-out",
      label: "Lunch Out",
      available: false,
      reason: "Available at 1:00 PM",
    };
  }

  // Step 3: Lunch in (if they went to lunch, must return before 2pm)
  if (s.lunch_out && !s.lunch_in) {
    const isLate = timeValue >= 14;
    return {
      action: "lunch-in",
      label: isLate ? "Lunch In (Late!)" : "Lunch In",
      available: true,
      reason: isLate ? "After 2:00 PM deadline" : undefined,
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
  onReset,
  testTime,
  testMode,
}) => {
  const firstInitial = s?.name ? String(s.name.split(" ")[0][0]).toUpperCase() : "?";
  const formatTimestamp = (val?: string | null) => prettyTimestamp(val, { compact: true });
  
  const now = testTime || new Date();
  const nextAction = getNextAction(s, now);

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
          <div title={s.name} className="font-semibold text-base text-gray-900 leading-tight wrap-break-word max-w-56">
            {s.name}
          </div>
          <div className={`mt-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${programClass}`}>
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
              className={`px-2 py-0.5 rounded-full text-sm font-medium cursor-pointer transition-transform duration-150 active:scale-95 hover:scale-105 ${s.status === "present" ? "bg-green-200 text-green-900" : "text-gray-900"}`}
            >
              Present
            </button>
            <button
              onClick={() => onStatusChange(s.id, "late")}
              className={`ml-1 px-2 py-0.5 rounded-full text-sm font-medium cursor-pointer transition-transform duration-150 active:scale-95 hover:scale-105 ${s.status === "late" ? "bg-yellow-200 text-yellow-900" : "text-gray-900"}`}
            >
              Late
            </button>
            <button
              onClick={() => onStatusChange(s.id, "absent")}
              className={`ml-1 px-2 py-0.5 rounded-full text-sm font-medium cursor-pointer transition-transform duration-150 active:scale-95 hover:scale-105 ${s.status === "absent" ? "bg-red-200 text-red-900" : "text-gray-900"}`}
            >
              Absent
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
          <div className={`w-3 h-3 rounded-full ${s.time_in ? "bg-green-500" : "bg-gray-300"}`} title={s.time_in ? `Checked in: ${formatTimestamp(s.time_in)}` : "Not checked in"} />
          <div className={`flex-1 h-0.5 ${s.time_in ? "bg-green-500" : "bg-gray-300"}`} />
          
          {showLunchSection && (
            <>
              {/* Lunch out dot */}
              <div className={`w-3 h-3 rounded-full ${s.lunch_out ? "bg-yellow-500" : "bg-gray-300"}`} title={s.lunch_out ? `Lunch out: ${formatTimestamp(s.lunch_out)}` : "No lunch break"} />
              <div className={`flex-1 h-0.5 ${s.lunch_in ? "bg-green-500" : s.lunch_out ? "bg-yellow-500" : "bg-gray-300"}`} />
              {/* Lunch in dot */}
              <div className={`w-3 h-3 rounded-full ${s.lunch_in ? "bg-green-500" : s.lunch_out ? "bg-yellow-500" : "bg-gray-300"}`} title={s.lunch_in ? `Back from lunch: ${formatTimestamp(s.lunch_in)}` : s.lunch_out ? "Still at lunch" : "—"} />
              <div className={`flex-1 h-0.5 ${s.time_out ? "bg-green-500" : s.lunch_in || !s.lunch_out ? (s.time_in ? "bg-gray-300" : "bg-gray-300") : "bg-yellow-500"}`} />
            </>
          )}
          
          {!showLunchSection && (
            <div className={`flex-1 h-0.5 ${s.time_out ? "bg-green-500" : "bg-gray-300"}`} />
          )}
          
          {/* Day checkout dot */}
          <div className={`w-3 h-3 rounded-full ${s.time_out ? "bg-green-500" : "bg-gray-300"}`} title={s.time_out ? `Checked out: ${formatTimestamp(s.time_out)}` : "Not checked out"} />
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
      {showLunchSection && (
        <div className="w-full mt-2 border-t border-gray-100 pt-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="text-center">
              <div className="text-yellow-600">🍽️ Lunch out</div>
              <div className="font-medium">{formatTimestamp(s.lunch_out)}</div>
            </div>
            <div className="text-center">
              <div className="text-green-600">🍽️ Lunch in</div>
              <div className="font-medium">{formatTimestamp(s.lunch_in)}</div>
            </div>
          </div>
          {/* Lunch Status */}
          {s.lunch_out && (
            <div className="mt-2 flex flex-col items-center">
              <div className="text-xs text-gray-500 mb-1">Lunch Status</div>
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
                  {s.lunch_status === "present" ? "On Time" : s.lunch_status === "late" ? "Late" : s.lunch_in ? "—" : "At Lunch"}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Next Action Button */}
      <div className="w-full mt-3">
        {nextAction ? (
          <div className="flex flex-col items-center">
            <button
              onClick={async () => {
                if (!nextAction.available) return;
                console.log(`[LearnerCard] Button clicked: ${nextAction.action} for ${s.id}`);
                try {
                  await onCheckAction(s.id, nextAction.action);
                  console.log(`[LearnerCard] Action completed: ${nextAction.action}`);
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
              <div className={`text-xs mt-1 ${nextAction.available ? "text-red-600" : "text-gray-500"}`}>
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
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export default React.memo(LearnerCard);
