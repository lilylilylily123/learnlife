"use client";
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import * as pbClient from "@/lib/pb-client";
import { pb } from "@/app/pb";
import type {
  ArrivalStatus,
  AttendanceRecord,
  Learner,
} from "@learnlife/pb-client";
import { deriveStatus, splitStatus, summarizeAttendance } from "@learnlife/shared";
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

const PROGRAM_LABEL: Record<string, string> = {
  exp: "Explorers",
  cre: "Creators",
  chmk: "Changemakers",
  pf: "Pathfinders",
};

type ViewMode = "story" | "table";

interface RosterRow {
  learner: Learner;
  record: AttendanceRecord | null;
}

// Pure helper exposed for testing — groups roster rows by what matters at a
// glance (here / justified / absent), then sorts each group naturally.
export function groupRosterRows(rows: RosterRow[]): {
  here: RosterRow[];
  justified: RosterRow[];
  missing: RosterRow[];
} {
  const here: RosterRow[] = [];
  const justified: RosterRow[] = [];
  const missing: RosterRow[] = [];
  for (const row of rows) {
    const s = row.record?.status;
    if ((s === "present" || s === "late") && row.record?.time_in) {
      here.push(row);
    } else if (s === "jLate" || s === "jAbsent") {
      justified.push(row);
    } else {
      missing.push(row);
    }
  }
  here.sort((a, b) => {
    const at = a.record?.time_in || "";
    const bt = b.record?.time_in || "";
    return at.localeCompare(bt);
  });
  const byName = (a: RosterRow, b: RosterRow) =>
    (a.learner.name || "").localeCompare(b.learner.name || "");
  justified.sort(byName);
  missing.sort(byName);
  return { here, justified, missing };
}

export default function HistoryPage() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    () => new Date().toISOString().split("T")[0],
  );
  const [selectedLearnerId, setSelectedLearnerId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "present" | "late" | "absent" | "j" | "missing"
  >("all");
  const [viewMode, setViewMode] = useState<ViewMode>("story");

  const [learners, setLearners] = useState<Learner[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setIsLoggedIn(pb.authStore.isValid);
    if (!pb.authStore.isValid) {
      router.push("/");
    }
  }, [router]);

  const [editingRow, setEditingRow] = useState<RosterRow | null>(null);
  const [editForm, setEditForm] = useState({
    time_in: "",
    time_out: "",
    lunch_out: "",
    lunch_in: "",
    arrival: "" as ArrivalStatus | "",
    justified: false,
    justification_reason: "",
    lunch_status: "",
  });

  const fetchLearners = useCallback(async () => {
    try {
      const result = await pbClient.listLearners({ perPage: 500 });
      const items = result.items as unknown as Learner[];
      items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setLearners(items);
    } catch (err) {
      console.error("Failed to fetch learners:", err);
    }
  }, []);

  const fetchAttendance = useCallback(async () => {
    setLoading(true);
    try {
      const result = await pbClient.listAttendance({
        date: selectedDate,
        perPage: 500,
      });
      setRecords(result.items as unknown as AttendanceRecord[]);
    } catch (err) {
      console.error("Failed to fetch attendance:", err);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    if (isLoggedIn) fetchLearners();
  }, [fetchLearners, isLoggedIn]);

  useEffect(() => {
    if (isLoggedIn) fetchAttendance();
  }, [fetchAttendance, isLoggedIn]);

  // ── Roster + records merge ────────────────────────────────────────────
  // Records-only views silently dropped any learner who was absent without a
  // record. We always render one row per learner, with the record attached
  // when one exists.
  const allRows = useMemo<RosterRow[]>(() => {
    const recordsByLearner = new Map<string, AttendanceRecord>();
    for (const r of records) recordsByLearner.set(r.learner, r);
    return learners.map((learner) => ({
      learner,
      record: recordsByLearner.get(learner.id) ?? null,
    }));
  }, [learners, records]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allRows.filter(({ learner, record }) => {
      if (selectedLearnerId && learner.id !== selectedLearnerId) return false;
      if (q) {
        const name = (learner.name || "").toLowerCase();
        const email = (learner.email || "").toLowerCase();
        if (!name.includes(q) && !email.includes(q)) return false;
      }
      if (statusFilter !== "all") {
        const status = record?.status || "";
        const hasCheckIn = !!record?.time_in;
        if (statusFilter === "present" && status !== "present") return false;
        if (statusFilter === "late" && status !== "late") return false;
        if (
          statusFilter === "absent" &&
          status !== "absent" &&
          (hasCheckIn || record !== null)
        )
          return false;
        if (statusFilter === "j" && status !== "jLate" && status !== "jAbsent")
          return false;
        if (statusFilter === "missing" && record !== null) return false;
      }
      return true;
    });
  }, [allRows, selectedLearnerId, searchQuery, statusFilter]);

  // ── Time helpers ──────────────────────────────────────────────────────
  const formatTime = (val: string | null | undefined) => {
    if (!val) return "—";
    const d = new Date(val);
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const formatTimeForInput = (val: string | null | undefined) => {
    if (!val) return "";
    const d = new Date(val);
    return `${d.getHours().toString().padStart(2, "0")}:${d
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;
  };

  const getLunchOut = (record: AttendanceRecord | null): string | null => {
    if (!record) return null;
    if (record.lunch_events && record.lunch_events.length > 0) {
      const firstOut = record.lunch_events.find((e) => e.type === "out");
      return firstOut?.time || null;
    }
    return record.lunch_out;
  };

  const getLunchIn = (record: AttendanceRecord | null): string | null => {
    if (!record) return null;
    if (record.lunch_events && record.lunch_events.length > 0) {
      for (let i = record.lunch_events.length - 1; i >= 0; i--) {
        if (record.lunch_events[i].type === "in")
          return record.lunch_events[i].time;
      }
      return null;
    }
    return record.lunch_in;
  };

  const startEditing = (row: RosterRow) => {
    setEditingRow(row);
    // Prefer the split fields; fall back to decoding the legacy enum for
    // records that haven't been touched since the migration.
    const rec = row.record;
    const fallback = splitStatus(rec?.status ?? null);
    setEditForm({
      time_in: formatTimeForInput(rec?.time_in),
      time_out: formatTimeForInput(rec?.time_out),
      lunch_out: formatTimeForInput(getLunchOut(rec)),
      lunch_in: formatTimeForInput(getLunchIn(rec)),
      arrival: (rec?.arrival ?? fallback.arrival ?? "") as ArrivalStatus | "",
      justified: Boolean(rec?.justified ?? fallback.justified),
      justification_reason: rec?.justification_reason ?? "",
      lunch_status: rec?.lunch_status || "",
    });
  };

  const cancelEditing = () => {
    setEditingRow(null);
    setEditForm({
      time_in: "",
      time_out: "",
      lunch_out: "",
      lunch_in: "",
      arrival: "",
      justified: false,
      justification_reason: "",
      lunch_status: "",
    });
  };

  const saveEditing = async () => {
    if (!editingRow) return;
    try {
      const dateBase = selectedDate;
      const fields: Record<string, unknown> = {};

      const timeFields = ["time_in", "time_out"] as const;
      for (const field of timeFields) {
        const timeVal = editForm[field];
        if (timeVal) {
          const [hours, minutes] = timeVal.split(":").map(Number);
          const dt = new Date(dateBase);
          dt.setHours(hours, minutes, 0, 0);
          fields[field] = dt.toISOString();
        }
      }

      // The edit modal collapses lunch_events into a single out/in pair. If a
      // record had more than one lunch trip, saving here would discard the
      // extras — startEditing already only loads first-out / last-in so the
      // UI doesn't show the collapse. We warn the user before clobbering.
      const existingLunchEvents = editingRow.record?.lunch_events ?? [];
      if (
        existingLunchEvents.length > 2 &&
        (editForm.lunch_out || editForm.lunch_in)
      ) {
        const ok = confirm(
          `This learner had ${existingLunchEvents.length} lunch events recorded. ` +
            `Saving here will overwrite them with just one out + one in pair. Continue?`,
        );
        if (!ok) return;
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
        fields.lunch_events = JSON.stringify(lunchEvents);
      }

      // Split-status fields. Status is derived so the legacy enum stays in
      // sync. justified is only meaningful when arrival is late or absent.
      const arrival = (editForm.arrival || null) as ArrivalStatus | null;
      const justified =
        editForm.justified && (arrival === "late" || arrival === "absent");
      fields.arrival = arrival;
      fields.justified = justified;
      fields.status = deriveStatus(arrival, justified);

      // Audit trail: capture justified_by/at on the flip-to-true.
      const wasJustified =
        editingRow.record?.justified ??
        splitStatus(editingRow.record?.status ?? null).justified;
      if (justified && !wasJustified) {
        fields.justified_by = pb.authStore.record?.id || null;
        fields.justified_at = new Date().toISOString();
      }
      // Always write whatever's in the reason box (allows clearing to "").
      fields.justification_reason = editForm.justification_reason || null;

      if (editForm.lunch_status) fields.lunch_status = editForm.lunch_status;

      // batchUpdateAttendance upserts — creates a record for absent learners.
      await pbClient.batchUpdateAttendance({
        learnerId: editingRow.learner.id,
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

  const resetRecord = async (row: RosterRow) => {
    if (!row.record) return;
    if (!confirm(`Reset attendance for ${row.learner.name || "this learner"}?`))
      return;
    try {
      await pbClient.resetAttendance(row.learner.id, selectedDate);
      await fetchAttendance();
    } catch (err) {
      console.error("Failed to reset:", err);
      alert("Failed to reset record");
    }
  };

  // ── Counts (now over the full roster) ─────────────────────────────────
  // Delegates to summarizeAttendance() so the count logic stays in one place
  // and benefits from the same arrival+justified-with-status-fallback that
  // the reports page uses. Records with no row are counted as `missing` here
  // (the shared helper has no concept of roster-vs-records).
  const counts = useMemo(() => {
    const total = filteredRows.length;
    const presentRecords: AttendanceRecord[] = [];
    let missing = 0;
    for (const { record } of filteredRows) {
      if (!record) missing += 1;
      else presentRecords.push(record);
    }
    const s = summarizeAttendance(presentRecords);
    return {
      total,
      present: s.present,
      late: s.late,
      absent: s.absent,
      jLate: s.jLate,
      jAbsent: s.jAbsent,
      missing,
    };
  }, [filteredRows]);

  const dateLabel = new Date(selectedDate + "T00:00:00").toLocaleDateString(
    undefined,
    { weekday: "long", month: "long", day: "numeric", year: "numeric" },
  );

  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden ll-attender"
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
        className="shrink-0"
        style={{
          borderBottom: "1px solid var(--ll-divider)",
          background: "var(--ll-bg)",
        }}
      >
        <div
          className="flex items-center flex-wrap"
          style={{ padding: "12px 28px", gap: 10 }}
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

        <div
          className="flex items-center flex-wrap"
          style={{
            padding: "8px 28px 12px",
            gap: 10,
            borderTop: "1px dashed var(--ll-divider)",
          }}
        >
          <Kicker>Status</Kicker>
          <Pill
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          >
            All · {counts.total}
          </Pill>
          <Pill
            active={statusFilter === "present"}
            onClick={() => setStatusFilter("present")}
          >
            Present · {counts.present}
          </Pill>
          <Pill
            active={statusFilter === "late"}
            onClick={() => setStatusFilter("late")}
          >
            Late · {counts.late}
          </Pill>
          <Pill
            active={statusFilter === "absent"}
            onClick={() => setStatusFilter("absent")}
          >
            Absent · {counts.absent + counts.missing}
          </Pill>
          <Pill
            active={statusFilter === "j"}
            onClick={() => setStatusFilter("j")}
          >
            Justified · {counts.jLate + counts.jAbsent}
          </Pill>
          <Pill
            active={statusFilter === "missing"}
            onClick={() => setStatusFilter("missing")}
          >
            No record · {counts.missing}
          </Pill>

          <div className="flex-1" />

          <Kicker>View</Kicker>
          <Pill
            active={viewMode === "story"}
            onClick={() => setViewMode("story")}
          >
            Story
          </Pill>
          <Pill
            active={viewMode === "table"}
            onClick={() => setViewMode("table")}
          >
            Table
          </Pill>
        </div>
      </div>

      {/* ─── Body ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {viewMode === "story" ? (
          <StoryView
            rows={filteredRows}
            loading={loading}
            onEdit={startEditing}
            onReset={resetRecord}
            getLunchOut={getLunchOut}
            getLunchIn={getLunchIn}
            formatTime={formatTime}
          />
        ) : (
          <TableView
            rows={filteredRows}
            loading={loading}
            onEdit={startEditing}
            onReset={resetRecord}
            getLunchOut={getLunchOut}
            getLunchIn={getLunchIn}
            formatTime={formatTime}
          />
        )}

        {/* Summary footer */}
        {!loading && filteredRows.length > 0 && (
          <div
            className="flex items-center shrink-0 flex-wrap"
            style={{
              gap: 24,
              padding: "14px 28px",
              borderTop: "1px solid var(--ll-divider)",
              background: "var(--ll-surface)",
            }}
          >
            <SummaryCell label="Roster" value={counts.total} />
            <Sep />
            <SummaryCell label="Present" value={counts.present} tone="accent" />
            <SummaryCell label="Late" value={counts.late} tone="lime" />
            <SummaryCell
              label="Absent"
              value={counts.absent + counts.missing}
              tone="warm"
            />
            <Sep />
            <SummaryCell label="J·Late" value={counts.jLate} />
            <SummaryCell label="J·Absent" value={counts.jAbsent} />
            <SummaryCell label="No record" value={counts.missing} />
          </div>
        )}
      </div>

      {/* ─── Edit modal ────────────────────────────────────── */}
      {editingRow && (
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
            <Kicker>
              {editingRow.record ? "Edit attendance" : "Create attendance"}
            </Kicker>
            <div
              style={{
                ...HEADING,
                fontSize: 22,
                marginTop: 4,
                marginBottom: 4,
              }}
            >
              {editingRow.learner.name || "Learner"}
            </div>
            <div style={{ ...KICKER, marginBottom: 16 }}>
              {dateLabel}
              {!editingRow.record && " · No record yet"}
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
              <Field label="Arrival">
                <InkSelect
                  value={editForm.arrival}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      arrival: e.target.value as ArrivalStatus | "",
                      // present can never be "justified"
                      justified:
                        e.target.value === "present" ? false : editForm.justified,
                    })
                  }
                  className="w-full"
                >
                  <option value="">— None —</option>
                  <option value="present">Present</option>
                  <option value="late">Late</option>
                  <option value="absent">Absent</option>
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

            {/* Justification: meaningful only when arrival is late or absent.
                Captures excused / reason / audit. */}
            {(editForm.arrival === "late" || editForm.arrival === "absent") && (
              <div
                style={{
                  marginTop: 16,
                  padding: 12,
                  background: "color-mix(in srgb, var(--ll-accent) 8%, transparent)",
                  border: "1px solid var(--ll-divider)",
                }}
              >
                <label
                  className="flex items-center cursor-pointer"
                  style={{ gap: 8 }}
                >
                  <input
                    type="checkbox"
                    checked={editForm.justified}
                    onChange={(e) =>
                      setEditForm({ ...editForm, justified: e.target.checked })
                    }
                    style={{ width: 16, height: 16, cursor: "pointer" }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    Justified ({editForm.arrival === "late" ? "excused late" : "excused absence"})
                  </span>
                </label>
                <textarea
                  value={editForm.justification_reason}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      justification_reason: e.target.value,
                    })
                  }
                  placeholder="Reason (optional) — e.g. doctor appointment"
                  rows={2}
                  disabled={!editForm.justified}
                  style={{
                    marginTop: 8,
                    width: "100%",
                    padding: "6px 10px",
                    fontSize: 13,
                    fontFamily: "var(--font-body)",
                    border: "1px solid var(--ll-divider)",
                    background: "var(--ll-surface)",
                    opacity: editForm.justified ? 1 : 0.5,
                    resize: "vertical",
                  }}
                />
                {editingRow.record?.justified_at && (
                  <div style={{ ...KICKER, marginTop: 6, fontSize: 10 }}>
                    Last justified{" "}
                    {new Date(editingRow.record.justified_at).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Warning when the edit modal would collapse multi-trip lunch
                events into a single out/in pair (review #9). */}
            {editingRow.record &&
              (editingRow.record.lunch_events?.length ?? 0) > 2 && (
                <div
                  style={{
                    marginTop: 12,
                    padding: "8px 10px",
                    background: "color-mix(in srgb, var(--ll-warm) 14%, transparent)",
                    border: "1px solid var(--ll-warm)",
                    fontSize: 12,
                    color: "var(--ll-warm-ink)",
                  }}
                >
                  ⚠️ This learner had{" "}
                  {Math.ceil((editingRow.record.lunch_events?.length ?? 0) / 2)} lunch
                  trip(s). Saving here will collapse them into one out/in pair.
                </div>
              )}

            <div className="flex justify-end mt-6" style={{ gap: 6 }}>
              <Pill size="sm" onClick={cancelEditing}>
                Cancel
              </Pill>
              <Pill size="sm" variant="ink" onClick={saveEditing}>
                {editingRow.record ? "Save changes" : "Create record"}
              </Pill>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Story view: status-grouped columns ────────────────────────────────────
//
// The original ribbon-per-learner design didn't earn its space — most rows
// looked identical (everyone arrives 9–10) and absent rows shouted with a
// noisy hatched bar. This columnar layout groups learners by what actually
// matters at a glance: who's here (sorted by arrival order), who has a
// justified status, and who's missing.

interface ViewProps {
  rows: RosterRow[];
  loading: boolean;
  onEdit: (row: RosterRow) => void;
  onReset: (row: RosterRow) => void;
  getLunchOut: (record: AttendanceRecord | null) => string | null;
  getLunchIn: (record: AttendanceRecord | null) => string | null;
  formatTime: (val: string | null | undefined) => string;
}

type Group = "here" | "justified" | "missing";

const GROUP_TONE: Record<
  Group,
  { rule: string; label: string; sub: string }
> = {
  here: {
    rule: "var(--ll-accent)",
    label: "Here",
    sub: "checked in today",
  },
  justified: {
    rule: "var(--ll-ink-2)",
    label: "Justified",
    sub: "absences with reason",
  },
  missing: {
    rule: "var(--ll-warm)",
    label: "Absent",
    sub: "no check-in",
  },
};

function StoryView({
  rows,
  loading,
  onEdit,
  onReset,
  getLunchOut,
  getLunchIn,
  formatTime,
}: ViewProps) {
  const groups = useMemo(() => groupRosterRows(rows), [rows]);

  if (loading) {
    return (
      <div
        className="flex-1 flex items-center justify-center text-center"
        style={{ color: "var(--ll-muted)" }}
      >
        <div style={{ ...HEADING, fontSize: 22 }}>Loading…</div>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center text-center"
        style={{ color: "var(--ll-muted)", gap: 8 }}
      >
        <div style={{ ...HEADING, fontSize: 22 }}>Nothing on the page.</div>
        <div style={KICKER}>No learners match your filters</div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 grid overflow-hidden"
      style={{
        gridTemplateColumns: "1fr 1fr 1fr",
      }}
    >
      <StoryColumn
        kind="here"
        rows={groups.here}
        onEdit={onEdit}
        onReset={onReset}
        getLunchOut={getLunchOut}
        getLunchIn={getLunchIn}
        formatTime={formatTime}
      />
      <StoryColumn
        kind="justified"
        rows={groups.justified}
        onEdit={onEdit}
        onReset={onReset}
        getLunchOut={getLunchOut}
        getLunchIn={getLunchIn}
        formatTime={formatTime}
      />
      <StoryColumn
        kind="missing"
        rows={groups.missing}
        onEdit={onEdit}
        onReset={onReset}
        getLunchOut={getLunchOut}
        getLunchIn={getLunchIn}
        formatTime={formatTime}
        last
      />
    </div>
  );
}

interface StoryColumnProps {
  kind: Group;
  rows: RosterRow[];
  onEdit: ViewProps["onEdit"];
  onReset: ViewProps["onReset"];
  getLunchOut: ViewProps["getLunchOut"];
  getLunchIn: ViewProps["getLunchIn"];
  formatTime: ViewProps["formatTime"];
  last?: boolean;
}

function StoryColumn({
  kind,
  rows,
  onEdit,
  onReset,
  getLunchOut,
  getLunchIn,
  formatTime,
  last,
}: StoryColumnProps) {
  const tone = GROUP_TONE[kind];
  return (
    <section
      className="flex flex-col overflow-hidden"
      style={{
        borderRight: last ? "none" : "1px solid var(--ll-divider)",
        background: "var(--ll-bg)",
      }}
    >
      <header
        className="flex items-baseline shrink-0 sticky top-0"
        style={{
          gap: 12,
          padding: "16px 22px 10px",
          background: "var(--ll-surface)",
          borderBottom: `2px solid ${tone.rule}`,
        }}
      >
        <div style={{ ...HEADING, fontSize: 22, lineHeight: 1.05 }}>
          {tone.label}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            color: tone.rule,
            fontWeight: 700,
            letterSpacing: "0.04em",
          }}
        >
          {rows.length}
        </div>
        <div className="flex-1" />
        <div style={{ ...KICKER }}>{tone.sub}</div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div
            className="text-center"
            style={{
              padding: "40px 20px",
              color: "var(--ll-muted)",
              ...KICKER,
            }}
          >
            — none —
          </div>
        ) : (
          rows.map((row, i) => (
            <StoryRow
              key={row.learner.id}
              row={row}
              kind={kind}
              zebra={i % 2 === 1}
              onEdit={onEdit}
              onReset={onReset}
              getLunchOut={getLunchOut}
              getLunchIn={getLunchIn}
              formatTime={formatTime}
            />
          ))
        )}
      </div>
    </section>
  );
}

interface StoryRowProps extends Omit<ViewProps, "rows" | "loading"> {
  row: RosterRow;
  kind: Group;
  zebra: boolean;
}

function StoryRow({
  row,
  kind,
  zebra,
  onEdit,
  onReset,
  getLunchOut,
  getLunchIn,
  formatTime,
}: StoryRowProps) {
  const { learner, record } = row;
  const status = record?.status;
  const programLabel =
    PROGRAM_LABEL[learner.program || ""] || learner.program || "—";

  const inT = record?.time_in;
  const outT = record?.time_out;
  const lOut = getLunchOut(record);
  const lIn = getLunchIn(record);

  // Compose a tight one-line caption with only the times that exist.
  const segments: string[] = [];
  if (inT) segments.push(`in ${formatTime(inT)}`);
  if (lOut && lIn)
    segments.push(`lunch ${formatTime(lOut)}–${formatTime(lIn)}`);
  else if (lOut) segments.push(`lunch out ${formatTime(lOut)}`);
  if (outT) segments.push(`out ${formatTime(outT)}`);
  else if (inT && !outT) segments.push("on site");

  const caption =
    kind === "missing" && !record
      ? "no record"
      : kind === "missing" && status === "absent"
        ? "marked absent"
        : segments.join(" · ");

  // Highlight time slugs (e.g. "in 09:42") with the status tone.
  const accent =
    status === "late"
      ? "var(--ll-ink-2)"
      : status === "jLate" || status === "jAbsent"
        ? "var(--ll-ink-2)"
        : "var(--ll-accent)";

  return (
    <div
      className="ll-row flex items-center"
      style={{
        gap: 12,
        padding: "9px 22px",
        borderBottom: "1px solid var(--ll-divider)",
        background: zebra ? "var(--ll-bg)" : "var(--ll-surface)",
      }}
    >
      {/* Tone tab on the very left — a thin vertical mark so each row visually
          inherits its column's color even when the row is in zebra-bg mode. */}
      <div
        aria-hidden
        style={{
          width: 3,
          alignSelf: "stretch",
          background: kind === "here" ? accent : GROUP_TONE[kind].rule,
          opacity: kind === "missing" && !record ? 0.4 : 0.85,
        }}
      />

      <Avatar name={learner.name || "?"} size={30} />

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline" style={{ gap: 8 }}>
          <div
            className="truncate"
            style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.2 }}
            title={learner.name}
          >
            {learner.name}
          </div>
          {kind === "here" && inT && (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
                fontWeight: 700,
                letterSpacing: "0.02em",
                color: status === "late" ? "var(--ll-ink-2)" : "var(--ll-ink)",
              }}
            >
              {formatTime(inT)}
            </div>
          )}
        </div>
        <div
          className="truncate"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--ll-muted)",
            letterSpacing: "0.04em",
            marginTop: 2,
            textTransform: "uppercase",
          }}
          title={caption || programLabel}
        >
          {programLabel}
          {caption ? ` · ${caption}` : ""}
        </div>
      </div>

      {/* Justified status badge */}
      {kind === "justified" && status && (
        <StatusBadge status={status} />
      )}

      {/* Late marker only — Present is implied by the column */}
      {kind === "here" && status === "late" && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.06em",
            padding: "2px 7px",
            background: "var(--ll-lime)",
            color: "var(--ll-lime-ink)",
            textTransform: "uppercase",
          }}
        >
          Late
        </span>
      )}

      {/* Action buttons */}
      <div className="flex items-center shrink-0" style={{ gap: 4 }}>
        <button
          onClick={() => onEdit(row)}
          className="cursor-pointer ll-mini"
          style={{
            background: "transparent",
            color: "var(--ll-ink)",
            border: "1px solid var(--ll-ink-2)",
            padding: "3px 8px",
            fontSize: 10.5,
          }}
          title={record ? "Edit" : "Create record"}
        >
          {record ? "✎" : "+"}
        </button>
        {record && (
          <button
            onClick={() => onReset(row)}
            className="cursor-pointer ll-icon"
            title="Reset record"
            aria-label="Reset"
            style={{ color: "var(--ll-muted)", fontSize: 14 }}
          >
            ↺
          </button>
        )}
      </div>
    </div>
  );
}


// ─── Table view: existing dense layout, retained for power users ──────────

function TableView({
  rows,
  loading,
  onEdit,
  onReset,
  getLunchOut,
  getLunchIn,
  formatTime,
}: ViewProps) {
  if (loading) {
    return (
      <div
        className="flex-1 flex items-center justify-center text-center"
        style={{ color: "var(--ll-muted)" }}
      >
        <div style={{ ...HEADING, fontSize: 22 }}>Loading…</div>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center text-center"
        style={{ color: "var(--ll-muted)", gap: 8 }}
      >
        <div style={{ ...HEADING, fontSize: 22 }}>Nothing on the page.</div>
        <div style={KICKER}>No learners match your filters</div>
      </div>
    );
  }

  return (
    <>
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
        {rows.map(({ learner, record }, i) => {
          const row: RosterRow = { learner, record };
          const name = learner.name || "Unknown";
          const email = learner.email || "";
          const isMissing = !record;
          return (
            <div
              key={learner.id}
              className="grid items-center ll-row"
              style={{
                gridTemplateColumns:
                  "44px minmax(0,1.6fr) 110px 100px 100px 100px 110px 100px 130px",
                padding: "10px 28px",
                borderBottom: "1px solid var(--ll-divider)",
                fontSize: 14,
                background: i % 2 ? "var(--ll-bg)" : "var(--ll-surface)",
                opacity: isMissing ? 0.7 : 1,
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
                {isMissing ? (
                  <span
                    className="inline-flex items-center"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      padding: "3px 9px",
                      border: "1px dashed var(--ll-warm)",
                      color: "var(--ll-warm)",
                      textTransform: "uppercase",
                    }}
                  >
                    No record
                  </span>
                ) : (
                  <StatusBadge status={record!.status} />
                )}
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
                {formatTime(record?.time_in)}
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
                {record ? (
                  <StatusBadge status={record.lunch_status} />
                ) : (
                  <span style={{ color: "var(--ll-muted)" }}>—</span>
                )}
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
                {formatTime(record?.time_out)}
              </div>
              <div
                className="flex justify-end items-center"
                style={{ gap: 6 }}
              >
                <button
                  onClick={() => onEdit(row)}
                  className="cursor-pointer ll-mini"
                  style={{
                    background: "transparent",
                    color: "var(--ll-ink)",
                    border: "1px solid var(--ll-ink-2)",
                  }}
                  title={record ? "Edit" : "Create record"}
                >
                  {record ? "✎ Edit" : "+ Add"}
                </button>
                {record && (
                  <button
                    onClick={() => onReset(row)}
                    className="cursor-pointer ll-icon"
                    title="Reset record"
                    aria-label="Reset"
                    style={{ color: "var(--ll-muted)" }}
                  >
                    ↺
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
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
