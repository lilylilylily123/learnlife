"use client";
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import * as pbClient from "@/lib/pb-client";
import { pb } from "@/app/pb";

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
      email: string;
      program: string;
    };
  };
}

interface Learner {
  id: string;
  name: string;
  email: string;
  program: string;
}

export default function HistoryPage() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [selectedLearnerId, setSelectedLearnerId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [learners, setLearners] = useState<Learner[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Check auth state
  useEffect(() => {
    setIsLoggedIn(pb.authStore.isValid);
    if (!pb.authStore.isValid) {
      router.push("/");
    }
  }, [router]);
  
  // Editing state
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [editForm, setEditForm] = useState({
    time_in: "",
    time_out: "",
    lunch_out: "",
    lunch_in: "",
    status: "",
    lunch_status: "",
  });

  // Fetch learners
  const fetchLearners = useCallback(async () => {
    try {
      const result = await pbClient.listLearners({ perPage: 100 });
      setLearners(result.items as unknown as Learner[]);
    } catch (err) {
      console.error("Failed to fetch learners:", err);
    }
  }, []);
  
  // Fetch attendance
  const fetchAttendance = useCallback(async () => {
    setLoading(true);
    try {
      const result = await pbClient.listAttendance({
        date: selectedDate,
        learnerId: selectedLearnerId || undefined,
        perPage: 100,
      });
      setRecords(result.items as unknown as AttendanceRecord[]);
    } catch (err) {
      console.error("Failed to fetch attendance:", err);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, selectedLearnerId]);
  
  // Initial fetch - only when logged in
  useEffect(() => {
    if (isLoggedIn) {
      fetchLearners();
    }
  }, [fetchLearners, isLoggedIn]);
  
  useEffect(() => {
    if (isLoggedIn) {
      fetchAttendance();
    }
  }, [fetchAttendance, isLoggedIn]);

  // Filter records by search query
  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      if (!searchQuery.trim()) return true;
      const name = record.expand?.learner?.name?.toLowerCase() || "";
      const email = record.expand?.learner?.email?.toLowerCase() || "";
      const query = searchQuery.toLowerCase();
      return name.includes(query) || email.includes(query);
    });
  }, [records, searchQuery]);

  const formatTime = (val: string | null) => {
    if (!val) return "—";
    const d = new Date(val);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatTimeForInput = (val: string | null) => {
    if (!val) return "";
    const d = new Date(val);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  // Derive lunch out/in from lunch_events (new format) or fall back to legacy fields
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
      // Get the last 'in' event
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
      jLate: "bg-blue-100 text-blue-800",
      jAbsent: "bg-purple-100 text-purple-800",
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || "bg-gray-100"}`}>
        {status}
      </span>
    );
  };

  const startEditing = (record: AttendanceRecord) => {
    setEditingRecord(record);
    setEditForm({
      time_in: formatTimeForInput(record.time_in),
      time_out: formatTimeForInput(record.time_out),
      lunch_out: formatTimeForInput(getLunchOut(record)),
      lunch_in: formatTimeForInput(getLunchIn(record)),
      status: record.status || "",
      lunch_status: record.lunch_status || "",
    });
  };

  const cancelEditing = () => {
    setEditingRecord(null);
    setEditForm({
      time_in: "",
      time_out: "",
      lunch_out: "",
      lunch_in: "",
      status: "",
      lunch_status: "",
    });
  };

  const saveEditing = async () => {
    if (!editingRecord) return;
    
    try {
      // Convert time inputs to ISO timestamps
      const dateBase = selectedDate;
      const updates: Array<{ field: string; value?: string; timestamp?: string }> = [];
      
      // Time fields
      const timeFields = ["time_in", "time_out"] as const;
      for (const field of timeFields) {
        const timeVal = editForm[field];
        if (timeVal) {
          const [hours, minutes] = timeVal.split(":").map(Number);
          const dt = new Date(dateBase);
          dt.setHours(hours, minutes, 0, 0);
          updates.push({ field, timestamp: dt.toISOString() });
        }
      }

      // Build lunch_events from lunch_out/lunch_in form values
      const lunchEvents: Array<{ type: 'out' | 'in'; time: string }> = [];
      if (editForm.lunch_out) {
        const [h, m] = editForm.lunch_out.split(":").map(Number);
        const dt = new Date(dateBase);
        dt.setHours(h, m, 0, 0);
        lunchEvents.push({ type: 'out', time: dt.toISOString() });
      }
      if (editForm.lunch_in) {
        const [h, m] = editForm.lunch_in.split(":").map(Number);
        const dt = new Date(dateBase);
        dt.setHours(h, m, 0, 0);
        lunchEvents.push({ type: 'in', time: dt.toISOString() });
      }
      if (lunchEvents.length > 0) {
        updates.push({ field: "lunch_events", value: JSON.stringify(lunchEvents) });
      }
      
      // Status fields
      if (editForm.status) {
        updates.push({ field: "status", value: editForm.status });
      }
      if (editForm.lunch_status) {
        updates.push({ field: "lunch_status", value: editForm.lunch_status });
      }
      
      // Batch all field updates into a single PocketBase call
      const fields: Record<string, string> = {};
      for (const update of updates) {
        fields[update.field] = update.timestamp || update.value || "";
      }
      await pbClient.batchUpdateAttendance({
        learnerId: editingRecord.learner,
        date: selectedDate,
        fields,
      });
      
      // Refresh and close editor
      await fetchAttendance();
      cancelEditing();
    } catch (err) {
      console.error("Failed to save:", err);
      alert("Failed to save changes");
    }
  };

  const resetRecord = async (record: AttendanceRecord) => {
    if (!confirm(`Reset attendance for ${record.expand?.learner?.name || "this learner"}?`)) return;
    
    try {
      await pbClient.resetAttendance(record.learner, selectedDate);
      await fetchAttendance();
    } catch (err) {
      console.error("Failed to reset:", err);
      alert("Failed to reset record");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Attendance History</h1>
          <button
            onClick={() => router.push("/")}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 cursor-pointer"
          >
            ← Back to Dashboard
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
          <div className="flex flex-wrap items-center gap-4">
            {/* Date picker */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-600">Date:</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </div>

            {/* Learner dropdown */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-600">Learner:</label>
              <select
                value={selectedLearnerId}
                onChange={(e) => setSelectedLearnerId(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm min-w-[200px]"
              >
                <option value="">All Learners</option>
                {learners.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <label className="text-sm font-medium text-gray-600">Search:</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or email..."
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm flex-1"
              />
            </div>

            <button
              onClick={() => fetchAttendance()}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 cursor-pointer"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Records table */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="text-center py-12 text-gray-500">Loading...</div>
          ) : filteredRecords.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No attendance records found for this date.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Learner</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Check In</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Lunch Out</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Lunch In</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Lunch Status</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Check Out</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((record) => (
                    <tr key={record.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div className="font-medium">{record.expand?.learner?.name || "Unknown"}</div>
                        <div className="text-xs text-gray-500">{record.expand?.learner?.email}</div>
                      </td>
                      <td className="py-3 px-4">{statusBadge(record.status)}</td>
                      <td className="py-3 px-4">{formatTime(record.time_in)}</td>
                      <td className="py-3 px-4">{formatTime(getLunchOut(record))}</td>
                      <td className="py-3 px-4">{formatTime(getLunchIn(record))}</td>
                      <td className="py-3 px-4">{statusBadge(record.lunch_status)}</td>
                      <td className="py-3 px-4">{formatTime(record.time_out)}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => startEditing(record)}
                            className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 cursor-pointer"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => resetRecord(record)}
                            className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 cursor-pointer"
                          >
                            Reset
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Summary stats */}
        {!loading && filteredRecords.length > 0 && (
          <div className="mt-4 bg-white rounded-xl shadow-sm p-4 flex gap-8 text-sm">
            <div>
              <span className="text-gray-600">Total:</span>{" "}
              <span className="font-semibold">{filteredRecords.length}</span>
            </div>
            <div>
              <span className="text-gray-600">Present:</span>{" "}
              <span className="font-semibold text-green-600">
                {filteredRecords.filter((r) => r.status === "present").length}
              </span>
            </div>
            <div>
              <span className="text-gray-600">Late:</span>{" "}
              <span className="font-semibold text-yellow-600">
                {filteredRecords.filter((r) => r.status === "late").length}
              </span>
            </div>
            <div>
              <span className="text-gray-600">Absent:</span>{" "}
              <span className="font-semibold text-red-600">
                {filteredRecords.filter((r) => r.status === "absent").length}
              </span>
            </div>
            <div>
              <span className="text-gray-600">Justified Late:</span>{" "}
              <span className="font-semibold text-blue-600">
                {filteredRecords.filter((r) => r.status === "jLate").length}
              </span>
            </div>
            <div>
              <span className="text-gray-600">Justified Absent:</span>{" "}
              <span className="font-semibold text-purple-600">
                {filteredRecords.filter((r) => r.status === "jAbsent").length}
              </span>
            </div>
            <div>
              <span className="text-gray-600">No Status:</span>{" "}
              <span className="font-semibold text-gray-600">
                {filteredRecords.filter((r) => !r.status).length}
              </span>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {editingRecord && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full">
              <h3 className="text-lg font-bold mb-4">
                Edit Attendance: {editingRecord.expand?.learner?.name}
              </h3>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Check In</label>
                    <input
                      type="time"
                      value={editForm.time_in}
                      onChange={(e) => setEditForm({ ...editForm, time_in: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Status</label>
                    <select
                      value={editForm.status}
                      onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    >
                      <option value="">— None —</option>
                      <option value="present">Present</option>
                      <option value="late">Late</option>
                      <option value="absent">Absent</option>
                      <option value="jLate">Justified Late</option>
                      <option value="jAbsent">Justified Absent</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Lunch Out</label>
                    <input
                      type="time"
                      value={editForm.lunch_out}
                      onChange={(e) => setEditForm({ ...editForm, lunch_out: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Lunch In</label>
                    <input
                      type="time"
                      value={editForm.lunch_in}
                      onChange={(e) => setEditForm({ ...editForm, lunch_in: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Lunch Status</label>
                    <select
                      value={editForm.lunch_status}
                      onChange={(e) => setEditForm({ ...editForm, lunch_status: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    >
                      <option value="">— None —</option>
                      <option value="present">Present</option>
                      <option value="late">Late</option>
                      <option value="absent">Absent</option>
                      <option value="jLate">Justified Late</option>
                      <option value="jAbsent">Justified Absent</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Check Out</label>
                    <input
                      type="time"
                      value={editForm.time_out}
                      onChange={(e) => setEditForm({ ...editForm, time_out: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={cancelEditing}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEditing}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
