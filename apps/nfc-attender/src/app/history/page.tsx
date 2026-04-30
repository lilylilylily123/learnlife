"use client";
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import * as pbClient from "@/lib/pb-client";
import { pb } from "@/app/pb";
import type { AttendanceRecord, Learner } from "@learnlife/pb-client";
import {
  HEADING,
  KICKER,
  Kicker,
  Pill,
  StatusBadge,
  Avatar,
  LMark,
  InkInput,
  InkSelect,
} from "../components/ll-ui";

export default function HistoryPage() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    () => new Date().toISOString().split("T")[0],
  );
  const [selectedLearnerId, setSelectedLearnerId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [learners, setLearners] = useState<Learner[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setIsLoggedIn(pb.authStore.isValid);
    if (!pb.authStore.isValid) {
      router.push("/");
    }
  }, [router]);

  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(
    null,
  );
  const [editForm, setEditForm] = useState({
    time_in: "",
    time_out: "",
    lunch_out: "",
    lunch_in: "",
    status: "",
    lunch_status: "",
  });

  const fetchLearners = useCallback(async () => {
    try {
      const result = await pbClient.listLearners({ perPage: 100 });
      setLearners(result.items as unknown as Learner[]);
    } catch (err) {
      console.error("Failed to fetch learners:", err);
    }
  }, []);

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

  useEffect(() => {
    if (isLoggedIn) fetchLearners();
  }, [fetchLearners, isLoggedIn]);

  useEffect(() => {
    if (isLoggedIn) fetchAttendance();
  }, [fetchAttendance, isLoggedIn]);

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
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const formatTimeForInput = (val: string | null) => {
    if (!val) return "";
    const d = new Date(val);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  const getLunchOut = (record: AttendanceRecord): string | null => {
    if (record.lunch_events && record.lunch_events.length > 0) {
      const firstOut = record.lunch_events.find((e) => e.type === "out");
      return firstOut?.time || null;
    }
    return record.lunch_out;
  };

  const getLunchIn = (record: AttendanceRecord): string | null => {
    if (record.lunch_events && record.lunch_events.length > 0) {
      const events = record.lunch_events;
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === "in") return events[i].time;
      }
      return null;
    }
    return record.lunch_in;
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
      const dateBase = selectedDate;
      const updates: Array<{
        field: string;
        value?: string;
        timestamp?: string;
      }> = [];

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

      const lunchEvents: Array<{ type: "out" | "in"; time: string }> = [];
      if (editForm.lunch_out) {
        const [h, m] = editForm.lunch_out.split(":").map(Number);
        const dt = new Date(dateBase);
        dt.setHours(h, m, 0, 0);
        lunchEvents.push({ type: "out", time: dt.toISOString() });
      }
      if (editForm.lunch_in) {
        const [h, m] = editForm.lunch_in.split(":").map(Number);
        const dt = new Date(dateBase);
        dt.setHours(h, m, 0, 0);
        lunchEvents.push({ type: "in", time: dt.toISOString() });
      }
      if (lunchEvents.length > 0) {
        updates.push({
          field: "lunch_events",
          value: JSON.stringify(lunchEvents),
        });
      }

      if (editForm.status)
        updates.push({ field: "status", value: editForm.status });
      if (editForm.lunch_status)
        updates.push({ field: "lunch_status", value: editForm.lunch_status });

      const fields: Record<string, string> = {};
      for (const update of updates) {
        fields[update.field] = update.timestamp || update.value || "";
      }
      await pbClient.batchUpdateAttendance({
        learnerId: editingRecord.learner,
        date: selectedDate,
        fields,
      });

      await fetchAttendance();
      cancelEditing();
    } catch (err) {
      console.error("Failed to save:", err);
      alert("Failed to save changes");
    }
  };

  const resetRecord = async (record: AttendanceRecord) => {
    if (
      !confirm(
        `Reset attendance for ${record.expand?.learner?.name || "this learner"}?`,
      )
    )
      return;

    try {
      await pbClient.resetAttendance(record.learner, selectedDate);
      await fetchAttendance();
    } catch (err) {
      console.error("Failed to reset:", err);
      alert("Failed to reset record");
    }
  };

  const counts = useMemo(() => {
    const total = filteredRecords.length;
    const present = filteredRecords.filter((r) => r.status === "present").length;
    const late = filteredRecords.filter((r) => r.status === "late").length;
    const absent = filteredRecords.filter((r) => r.status === "absent").length;
    const jLate = filteredRecords.filter((r) => r.status === "jLate").length;
    const jAbsent = filteredRecords.filter((r) => r.status === "jAbsent").length;
    const noStatus = filteredRecords.filter((r) => !r.status).length;
    return { total, present, late, absent, jLate, jAbsent, noStatus };
  }, [filteredRecords]);

  const dateLabel = new Date(selectedDate + "T00:00:00").toLocaleDateString(
    undefined,
    { weekday: "long", month: "long", day: "numeric", year: "numeric" },
  );

  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden"
      style={{ background: "var(--ll-bg)", color: "var(--ll-ink)" }}
    >
      {/* ─── Top bar ───────────────────────────────────────── */}
      <header
        className="flex items-stretch shrink-0"
        style={{
          padding: "18px 28px",
          gap: 22,
          borderBottom: "1.5px solid var(--ll-ink)",
          background: "var(--ll-surface)",
        }}
      >
        <div
          className="flex items-center"
          style={{
            gap: 14,
            paddingRight: 22,
            borderRight: "1px solid var(--ll-divider)",
          }}
        >
          <LMark size={38} />
          <div>
            <Kicker>Attender · History</Kicker>
            <div
              style={{ ...HEADING, fontSize: 22, lineHeight: 1.15, marginTop: 2 }}
            >
              {dateLabel}
            </div>
          </div>
        </div>

        <div className="flex-1" />

        <div className="flex items-center" style={{ gap: 6 }}>
          <Pill size="sm" onClick={() => fetchAttendance()}>
            ↻ Refresh
          </Pill>
          <Pill
            size="sm"
            variant="accent"
            onClick={() => router.push("/history/admin")}
          >
            ↗ Reports
          </Pill>
          <Pill size="sm" variant="ink" onClick={() => router.push("/")}>
            ← Dashboard
          </Pill>
        </div>
      </header>

      {/* ─── Filter toolbar ────────────────────────────────── */}
      <div
        className="flex items-center shrink-0 flex-wrap"
        style={{
          padding: "14px 28px",
          gap: 12,
          borderBottom: "1px solid var(--ll-divider)",
          background: "var(--ll-bg)",
        }}
      >
        <Kicker>Date</Kicker>
        <InkInput
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
        />

        <div
          className="self-stretch"
          style={{ width: 1, background: "var(--ll-divider)", margin: "0 4px" }}
        />
        <Kicker>Learner</Kicker>
        <InkSelect
          value={selectedLearnerId}
          onChange={(e) => setSelectedLearnerId(e.target.value)}
          style={{ minWidth: 200 }}
        >
          <option value="">All learners</option>
          {learners.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </InkSelect>

        <div
          className="self-stretch"
          style={{ width: 1, background: "var(--ll-divider)", margin: "0 4px" }}
        />
        <div
          className="flex items-center flex-1 min-w-[220px]"
          style={{
            background: "var(--ll-surface)",
            border: "1.5px solid var(--ll-ink)",
            padding: "7px 12px",
            gap: 9,
            maxWidth: 380,
          }}
        >
          <span style={{ fontSize: 13, color: "var(--ll-muted)" }}>🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or email…"
            className="bg-transparent outline-none flex-1"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 14,
              color: "var(--ll-ink)",
              minWidth: 0,
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="cursor-pointer"
              style={{ color: "var(--ll-muted)", fontSize: 16 }}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* ─── Records table ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Header */}
        <div
          className="grid items-center shrink-0"
          style={{
            gridTemplateColumns:
              "44px minmax(0,1.6fr) 110px 100px 100px 100px 110px 100px 130px",
            padding: "11px 28px",
            borderBottom: "1px solid var(--ll-divider)",
            background: "var(--ll-surface)",
            ...KICKER,
            color: "var(--ll-muted)",
          }}
        >
          <div></div>
          <div>Learner</div>
          <div>Status</div>
          <div>Check-in</div>
          <div>Lunch out</div>
          <div>Lunch in</div>
          <div>Lunch</div>
          <div>Check-out</div>
          <div className="text-right">Actions</div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div
              className="text-center"
              style={{
                padding: "80px 24px",
                color: "var(--ll-muted)",
              }}
            >
              <div style={{ ...HEADING, fontSize: 22 }}>Loading…</div>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div
              className="text-center"
              style={{
                padding: "80px 24px",
                color: "var(--ll-muted)",
              }}
            >
              <div style={{ ...HEADING, fontSize: 22 }}>
                Nothing on the page.
              </div>
              <div style={{ ...KICKER, marginTop: 10 }}>
                No attendance records for this date
              </div>
            </div>
          ) : (
            filteredRecords.map((record, i) => {
              const name = record.expand?.learner?.name || "Unknown";
              const email = record.expand?.learner?.email || "";
              return (
                <div
                  key={record.id}
                  className="grid items-center ll-row"
                  style={{
                    gridTemplateColumns:
                      "44px minmax(0,1.6fr) 110px 100px 100px 100px 110px 100px 130px",
                    padding: "10px 28px",
                    borderBottom: "1px solid var(--ll-divider)",
                    fontSize: 14,
                    background:
                      i % 2 ? "var(--ll-bg)" : "var(--ll-surface)",
                  }}
                >
                  <Avatar name={name} size={32} />
                  <div className="min-w-0 pr-3">
                    <div
                      className="truncate"
                      style={{ fontWeight: 600, lineHeight: 1.2, fontSize: 14 }}
                      title={name}
                    >
                      {name}
                    </div>
                    {email && (
                      <div
                        className="truncate"
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 10.5,
                          color: "var(--ll-muted)",
                          letterSpacing: "0.04em",
                          marginTop: 2,
                        }}
                        title={email}
                      >
                        {email}
                      </div>
                    )}
                  </div>
                  <div>
                    <StatusBadge status={record.status} />
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12.5,
                    }}
                  >
                    {formatTime(record.time_in)}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12.5,
                      color: "var(--ll-muted)",
                    }}
                  >
                    {formatTime(getLunchOut(record))}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12.5,
                      color: "var(--ll-muted)",
                    }}
                  >
                    {formatTime(getLunchIn(record))}
                  </div>
                  <div>
                    <StatusBadge status={record.lunch_status} />
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12.5,
                    }}
                  >
                    {formatTime(record.time_out)}
                  </div>
                  <div
                    className="flex justify-end items-center"
                    style={{ gap: 6 }}
                  >
                    <button
                      onClick={() => startEditing(record)}
                      className="cursor-pointer ll-mini"
                      style={{
                        background: "transparent",
                        color: "var(--ll-ink)",
                        border: "1px solid var(--ll-ink-2)",
                      }}
                      title="Edit"
                    >
                      ✎ Edit
                    </button>
                    <button
                      onClick={() => resetRecord(record)}
                      className="cursor-pointer ll-icon"
                      title="Reset record"
                      aria-label="Reset"
                      style={{ color: "var(--ll-muted)" }}
                    >
                      ↺
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Summary footer */}
        {!loading && filteredRecords.length > 0 && (
          <div
            className="flex items-center shrink-0 flex-wrap"
            style={{
              gap: 24,
              padding: "14px 28px",
              borderTop: "1px solid var(--ll-divider)",
              background: "var(--ll-surface)",
            }}
          >
            <SummaryCell label="Total" value={counts.total} />
            <Sep />
            <SummaryCell
              label="Present"
              value={counts.present}
              tone="accent"
            />
            <SummaryCell label="Late" value={counts.late} tone="lime" />
            <SummaryCell label="Absent" value={counts.absent} tone="warm" />
            <Sep />
            <SummaryCell label="J·Late" value={counts.jLate} />
            <SummaryCell label="J·Absent" value={counts.jAbsent} />
            <SummaryCell label="No status" value={counts.noStatus} />
          </div>
        )}
      </div>

      {/* ─── Edit modal ────────────────────────────────────── */}
      {editingRecord && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(31,27,22,0.55)" }}
          onClick={cancelEditing}
        >
          <div
            className="w-full max-w-lg"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--ll-surface)",
              border: "1.5px solid var(--ll-ink)",
              padding: 24,
            }}
          >
            <Kicker>Edit attendance</Kicker>
            <div
              style={{
                ...HEADING,
                fontSize: 22,
                marginTop: 4,
                marginBottom: 16,
              }}
            >
              {editingRecord.expand?.learner?.name || "Learner"}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Check in">
                <InkInput
                  type="time"
                  value={editForm.time_in}
                  onChange={(e) =>
                    setEditForm({ ...editForm, time_in: e.target.value })
                  }
                  className="w-full"
                />
              </Field>
              <Field label="Status">
                <InkSelect
                  value={editForm.status}
                  onChange={(e) =>
                    setEditForm({ ...editForm, status: e.target.value })
                  }
                  className="w-full"
                >
                  <option value="">— None —</option>
                  <option value="present">Present</option>
                  <option value="late">Late</option>
                  <option value="absent">Absent</option>
                  <option value="jLate">Justified late</option>
                  <option value="jAbsent">Justified absent</option>
                </InkSelect>
              </Field>
              <Field label="Lunch out">
                <InkInput
                  type="time"
                  value={editForm.lunch_out}
                  onChange={(e) =>
                    setEditForm({ ...editForm, lunch_out: e.target.value })
                  }
                  className="w-full"
                />
              </Field>
              <Field label="Lunch in">
                <InkInput
                  type="time"
                  value={editForm.lunch_in}
                  onChange={(e) =>
                    setEditForm({ ...editForm, lunch_in: e.target.value })
                  }
                  className="w-full"
                />
              </Field>
              <Field label="Lunch status">
                <InkSelect
                  value={editForm.lunch_status}
                  onChange={(e) =>
                    setEditForm({ ...editForm, lunch_status: e.target.value })
                  }
                  className="w-full"
                >
                  <option value="">— None —</option>
                  <option value="present">Present</option>
                  <option value="late">Late</option>
                  <option value="absent">Absent</option>
                  <option value="jLate">Justified late</option>
                  <option value="jAbsent">Justified absent</option>
                </InkSelect>
              </Field>
              <Field label="Check out">
                <InkInput
                  type="time"
                  value={editForm.time_out}
                  onChange={(e) =>
                    setEditForm({ ...editForm, time_out: e.target.value })
                  }
                  className="w-full"
                />
              </Field>
            </div>

            <div className="flex justify-end mt-6" style={{ gap: 6 }}>
              <Pill size="sm" onClick={cancelEditing}>
                Cancel
              </Pill>
              <Pill size="sm" variant="ink" onClick={saveEditing}>
                Save changes
              </Pill>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ ...KICKER, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function Sep() {
  return (
    <div
      style={{
        width: 1,
        height: 28,
        background: "var(--ll-divider)",
      }}
    />
  );
}

function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "accent" | "warm" | "lime";
}) {
  const color =
    tone === "accent"
      ? "var(--ll-accent)"
      : tone === "warm"
        ? "var(--ll-warm)"
        : tone === "lime"
          ? "var(--ll-ink-2)"
          : "var(--ll-ink)";
  return (
    <div className="flex flex-col">
      <div style={KICKER}>{label}</div>
      <div
        style={{
          ...HEADING,
          fontSize: 28,
          color,
          lineHeight: 1.05,
          marginTop: 4,
        }}
      >
        {value}
      </div>
    </div>
  );
}
