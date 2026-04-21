"use client";
import React from "react";
import type { AttendanceFilterKey, AttendanceCounts } from "../types";

interface AttendanceFilterPillsProps {
  attendanceFilter: AttendanceFilterKey;
  attendanceCounts: AttendanceCounts;
  setAttendanceFilter: (key: AttendanceFilterKey) => void;
}

const PRESENCE_PILLS = [
  { key: "all", label: "All", color: "gray" },
  { key: "here", label: "Here", color: "green" },
  { key: "away", label: "Away", color: "gray" },
  { key: "lunch", label: "At Lunch", color: "orange" },
  { key: "out", label: "Checked Out", color: "blue" },
] as const;

const STATUS_PILLS = [
  { key: "present", label: "Present", color: "green" },
  { key: "late", label: "Late", color: "yellow" },
  { key: "absent", label: "Absent", color: "red" },
  { key: "jLate", label: "J. Late", color: "blue" },
  { key: "jAbsent", label: "J. Absent", color: "purple" },
] as const;

const COLOR_STYLES: Record<string, { active: string; inactive: string }> = {
  gray: {
    active: "bg-gray-700 text-white border-transparent",
    inactive: "bg-gray-100 text-gray-700 hover:bg-gray-200",
  },
  green: {
    active: "bg-green-600 text-white border-transparent",
    inactive: "bg-green-50 text-green-700 border-green-200 hover:bg-green-100",
  },
  orange: {
    active: "bg-orange-500 text-white border-transparent",
    inactive:
      "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100",
  },
  blue: {
    active: "bg-blue-600 text-white border-transparent",
    inactive: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100",
  },
  yellow: {
    active: "bg-yellow-500 text-white border-transparent",
    inactive:
      "bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100",
  },
  red: {
    active: "bg-red-600 text-white border-transparent",
    inactive: "bg-red-50 text-red-700 border-red-200 hover:bg-red-100",
  },
  purple: {
    active: "bg-purple-600 text-white border-transparent",
    inactive:
      "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100",
  },
};

function Pill({
  label,
  color,
  isActive,
  count,
  onClick,
}: {
  label: string;
  color: string;
  isActive: boolean;
  count: number;
  onClick: () => void;
}) {
  const styles = COLOR_STYLES[color];
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm font-medium cursor-pointer border transition-colors ${
        isActive ? styles.active : styles.inactive
      }`}
    >
      {label}{" "}
      <span className={isActive ? "text-white/80" : "text-gray-400"}>
        {count}
      </span>
    </button>
  );
}

export function AttendanceFilterPills({
  attendanceFilter,
  attendanceCounts,
  setAttendanceFilter,
}: AttendanceFilterPillsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      {PRESENCE_PILLS.map(({ key, label, color }) => (
        <Pill
          key={key}
          label={label}
          color={color}
          isActive={attendanceFilter === key}
          count={attendanceCounts[key]}
          onClick={() => setAttendanceFilter(key)}
        />
      ))}

      <div className="w-px h-6 bg-gray-300 mx-1" />

      {STATUS_PILLS.map(({ key, label, color }) => (
        <Pill
          key={key}
          label={label}
          color={color}
          isActive={attendanceFilter === key}
          count={attendanceCounts[key]}
          onClick={() => setAttendanceFilter(key)}
        />
      ))}
    </div>
  );
}
