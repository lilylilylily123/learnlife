"use client";
import React, { useEffect, useState, useCallback } from "react";

interface LunchEvent {
  type: 'out' | 'in';
  time: string;
}

interface AttendanceRecord {
  id: string;
  learner: string;
  date: string;
  time_in: string | null;
  time_out: string | null;
  lunch_out: string | null;
  lunch_in: string | null;
  lunch_events: LunchEvent[] | null;
  status: string | null;
  lunch_status: string | null;
  expand?: {
    learner?: {
      id: string;
      name: string;
      program: string;
    };
  };
}

interface AttendanceHistoryProps {
  learnerId?: string; // If provided, show history for specific learner
  onClose?: () => void;
}

export default function AttendanceHistory({ learnerId, onClose }: AttendanceHistoryProps) {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date: selectedDate, perPage: "100" });
      if (learnerId) params.set("learnerId", learnerId);
      const res = await fetch(`/api/attendance?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setRecords(data.items || []);
      } else {
        setRecords([]);
      }
    } catch (err) {
      console.error("Failed to fetch history:", err);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, learnerId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const formatTime = (val: string | null) => {
    if (!val) return "—";
    const d = new Date(val);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const getLunchOut = (record: AttendanceRecord): string | null => {
    if (record.lunch_events && record.lunch_events.length > 0) {
      const firstOut = record.lunch_events.find(e => e.type === 'out');
      return firstOut?.time || null;
    }
    return record.lunch_out;
  };

  const getLunchIn = (record: AttendanceRecord): string | null => {
    if (record.lunch_events && record.lunch_events.length > 0) {
      const events = record.lunch_events;
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === 'in') return events[i].time;
      }
      return null;
    }
    return record.lunch_in;
  };

  const statusBadge = (status: string | null) => {
    if (!status) return <span className="text-gray-400">—</span>;
    const colors: Record<string, string> = {
      present: "bg-green-100 text-green-800",
      late: "bg-yellow-100 text-yellow-800",
      absent: "bg-red-100 text-red-800",
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || "bg-gray-100"}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">
          {learnerId ? "Learner Attendance History" : "Attendance History"}
        </h2>
        {onClose && (
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl">
            ×
          </button>
        )}
      </div>

      {/* Date picker */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Date:</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-2 py-1 border rounded text-sm"
          />
        </div>
        <button
          onClick={fetchHistory}
          className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
        >
          Refresh
        </button>
      </div>

      {/* Records table */}
      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading...</div>
      ) : records.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No attendance records found for this date range.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left py-2 px-3 font-medium text-gray-600">Date</th>
                {!learnerId && <th className="text-left py-2 px-3 font-medium text-gray-600">Learner</th>}
                <th className="text-left py-2 px-3 font-medium text-gray-600">Status</th>
                <th className="text-left py-2 px-3 font-medium text-gray-600">Check In</th>
                <th className="text-left py-2 px-3 font-medium text-gray-600">Lunch Out</th>
                <th className="text-left py-2 px-3 font-medium text-gray-600">Lunch In</th>
                <th className="text-left py-2 px-3 font-medium text-gray-600">Lunch Status</th>
                <th className="text-left py-2 px-3 font-medium text-gray-600">Check Out</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className="border-b hover:bg-gray-50">
                  <td className="py-2 px-3 font-medium">{record.date}</td>
                  {!learnerId && (
                    <td className="py-2 px-3">{record.expand?.learner?.name || "Unknown"}</td>
                  )}
                  <td className="py-2 px-3">{statusBadge(record.status)}</td>
                  <td className="py-2 px-3">{formatTime(record.time_in)}</td>
                  <td className="py-2 px-3">{formatTime(getLunchOut(record))}</td>
                  <td className="py-2 px-3">{formatTime(getLunchIn(record))}</td>
                  <td className="py-2 px-3">{statusBadge(record.lunch_status)}</td>
                  <td className="py-2 px-3">{formatTime(record.time_out)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary stats */}
      {!loading && records.length > 0 && (
        <div className="mt-4 pt-4 border-t flex gap-6 text-sm">
          <div>
            <span className="text-gray-600">Total Days:</span>{" "}
            <span className="font-medium">{records.length}</span>
          </div>
          <div>
            <span className="text-gray-600">Present:</span>{" "}
            <span className="font-medium text-green-600">
              {records.filter((r) => r.status === "present").length}
            </span>
          </div>
          <div>
            <span className="text-gray-600">Late:</span>{" "}
            <span className="font-medium text-yellow-600">
              {records.filter((r) => r.status === "late").length}
            </span>
          </div>
          <div>
            <span className="text-gray-600">Absent:</span>{" "}
            <span className="font-medium text-red-600">
              {records.filter((r) => r.status === "absent").length}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
