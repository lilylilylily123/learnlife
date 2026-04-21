"use client";
import React from "react";
import { RecordModel } from "pocketbase";

const TEST_TIME_PRESETS = [
  { label: "9 AM", hour: 9, minute: 0 },
  { label: "10 AM", hour: 10, minute: 0 },
  { label: "1 PM", hour: 13, minute: 0 },
  { label: "1:30 PM", hour: 13, minute: 30 },
  { label: "2 PM", hour: 14, minute: 0 },
  { label: "5 PM", hour: 17, minute: 0 },
  { label: "6 PM", hour: 18, minute: 0 },
];

interface TestModePanelProps {
  testDate: string | null;
  testTime: Date | null;
  viewDate: string;
  students: RecordModel[];
  isLoading: boolean;
  setTestDate: (date: string | null) => void;
  setTestTime: (time: Date | null) => void;
  simulateScan: (uid: string) => void;
}

export function TestModePanel({
  testDate,
  testTime,
  viewDate,
  students,
  isLoading,
  setTestDate,
  setTestTime,
  simulateScan,
}: TestModePanelProps) {
  const setTestTimePreset = (hour: number, minute = 0) => {
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    setTestTime(d);
  };

  return (
    <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 mb-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-orange-800">
            Simulate Date:
          </span>
          <input
            type="date"
            value={testDate || new Date().toISOString().split("T")[0]}
            onChange={(e) => setTestDate(e.target.value || null)}
            className="px-3 py-1.5 rounded-lg bg-white text-gray-900 text-sm border border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-orange-800">
            Simulate Time:
          </span>
          <select
            value={
              testTime
                ? `${testTime.getHours()}:${testTime.getMinutes()}`
                : ""
            }
            onChange={(e) => {
              if (!e.target.value) {
                setTestTime(null);
              } else {
                const [h, m] = e.target.value.split(":").map(Number);
                setTestTimePreset(h, m);
              }
            }}
            className="px-3 py-1.5 rounded-lg bg-white text-gray-900 text-sm border border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-400"
          >
            <option value="">Use real time</option>
            {TEST_TIME_PRESETS.map((p) => (
              <option key={p.label} value={`${p.hour}:${p.minute}`}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1" />
        <div className="text-sm text-orange-700">
          <span className="font-medium">Active:</span> {viewDate}
          {testTime &&
            ` @ ${testTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
        </div>
      </div>
      {/* Simulate NFC scan */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-orange-200">
        <span className="text-sm font-medium text-orange-800">
          Simulate Scan:
        </span>
        <select
          id="sim-learner"
          className="px-3 py-1.5 rounded-lg bg-white text-gray-900 text-sm border border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-400 flex-1 max-w-xs"
          defaultValue=""
        >
          <option value="" disabled>
            Pick a learner...
          </option>
          {students
            .filter((s) => s.NFC_ID)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((s) => (
              <option key={s.id} value={s.NFC_ID}>
                {s.name} ({s.NFC_ID})
              </option>
            ))}
        </select>
        <button
          onClick={() => {
            const select = document.getElementById(
              "sim-learner",
            ) as HTMLSelectElement;
            if (select?.value) simulateScan(select.value);
          }}
          disabled={isLoading}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium ${
            isLoading
              ? "bg-gray-300 text-gray-500 cursor-not-allowed"
              : "bg-orange-500 text-white hover:bg-orange-600 cursor-pointer"
          }`}
        >
          {isLoading ? "Scanning..." : "Scan"}
        </button>
      </div>
      <p className="text-xs text-orange-600 mt-2">
        Test mode lets you simulate check-ins for different dates and times.
        Records are saved to the selected date.
      </p>
    </div>
  );
}
