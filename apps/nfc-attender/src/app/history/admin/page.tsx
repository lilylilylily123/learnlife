"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { pb } from "@/app/pb";
import { PROGRAM_CODES, type ProgramCode } from "@learnlife/pb-client";
import { formatMinutesOfDay, prettyTimestamp, parsePBDate } from "@learnlife/shared";
import type { AttendanceRecord } from "@learnlife/pb-client";
import {
  useAdminHistoryData,
  resolveRange,
  type DateRange,
  type LearnerRow,
  type RangePreset,
} from "@/app/hooks/useAdminHistoryData";

const PROGRAM_LABEL: Record<ProgramCode, string> = {
  chmk: "Changemaker",
  cre: "Creator",
  exp: "Explorer",
};

type SortKey =
  | "name" | "program" | "present" | "late" | "absent"
  | "avgIn" | "avgOut" | "lateLunch" | "missingOut" | "pct";

type SortState = { key: SortKey; dir: "asc" | "desc" };

const PRESETS: Array<{ key: RangePreset; label: string }> = [
  { key: "1d", label: "Today" },
  { key: "3d", label: "3 days" },
  { key: "7d", label: "7 days" },
  { key: "14d", label: "14 days" },
  { key: "month", label: "This month" },
];

export default function AdminHistoryPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  const [preset, setPreset] = useState<RangePreset>("7d");
  const [customRange, setCustomRange] = useState<DateRange>(() => resolveRange("7d"));
  const range = useMemo(
    () => (preset === "custom" ? customRange : resolveRange(preset)),
    [preset, customRange],
  );

  const [programFilter, setProgramFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!pb.authStore.isValid) {
      router.push("/");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAuthChecked(true);
  }, [router]);

  const { rows, loading, error, refresh } = useAdminHistoryData({
    isLoggedIn: authChecked,
    range,
    programFilter,
  });

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? rows.filter(
          (r) =>
            r.learner.name.toLowerCase().includes(q) ||
            r.learner.email.toLowerCase().includes(q),
        )
      : rows;
    return [...filtered].sort(compareRows(sort));
  }, [rows, search, sort]);

  const programTotals = useMemo(() => buildProgramTotals(rows), [rows]);

  const toggleSort = (key: SortKey) =>
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" },
    );

  const toggleExpanded = (id: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onExportCsv = () => downloadCsv(visibleRows, range);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-yellow-50 flex items-center justify-center text-gray-500 font-sans">
        Checking access…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-yellow-50 p-4 sm:p-6 font-sans">
      <div className="w-full max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              📈 Attendance Reports
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Range <span className="font-mono">{range.from}</span> →{" "}
              <span className="font-mono">{range.to}</span> ·{" "}
              {loading ? "loading…" : `${visibleRows.length} learners`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              className="cursor-pointer px-3 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium shadow hover:bg-blue-600"
            >
              Refresh
            </button>
            <button
              onClick={onExportCsv}
              disabled={loading || visibleRows.length === 0}
              className="cursor-pointer px-3 py-2 rounded-xl bg-green-500 text-white text-sm font-medium shadow hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ⬇ Download CSV
            </button>
            <button
              onClick={() => router.push("/history")}
              className="cursor-pointer px-3 py-2 rounded-xl bg-purple-500 text-white text-sm font-medium shadow hover:bg-purple-600"
            >
              📊 Daily view
            </button>
            <button
              onClick={() => router.push("/")}
              className="px-3 py-2 rounded-xl bg-gray-200 text-gray-700 text-sm cursor-pointer hover:bg-gray-300"
            >
              ← Dashboard
            </button>
          </div>
        </div>

        {/* Range presets + filters */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">
            Date range
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                className={`px-3 py-2 rounded-xl text-sm font-medium cursor-pointer transition ${
                  preset === p.key
                    ? "bg-blue-500 text-white shadow hover:bg-blue-600"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {p.label}
              </button>
            ))}
            <div className="ml-2 flex items-center gap-2 pl-3 border-l border-gray-200">
              <label className="text-xs uppercase text-gray-500 font-semibold">Custom</label>
              <input
                type="date"
                value={customRange.from}
                onChange={(e) => {
                  setCustomRange((r) => ({ ...r, from: e.target.value }));
                  setPreset("custom");
                }}
                className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm"
              />
              <span className="text-gray-400">→</span>
              <input
                type="date"
                value={customRange.to}
                onChange={(e) => {
                  setCustomRange((r) => ({ ...r, to: e.target.value }));
                  setPreset("custom");
                }}
                className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Program:</label>
              <select
                value={programFilter}
                onChange={(e) => setProgramFilter(e.target.value)}
                className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm cursor-pointer"
              >
                <option value="all">All programs</option>
                {Object.entries(PROGRAM_CODES).map(([name, code]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-[220px] max-w-md">
              <label className="text-sm font-medium text-gray-700">Search:</label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or email…"
                className="flex-1 px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Program totals */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          {programTotals.map((p) => (
            <div
              key={p.code}
              className="bg-white rounded-2xl shadow-sm p-4"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-gray-900">{p.label}</span>
                <span className="text-xs text-gray-500">
                  {p.learnerCount} {p.learnerCount === 1 ? "learner" : "learners"}
                </span>
              </div>
              <div className="text-2xl font-bold text-gray-900">{p.attendancePct}%</div>
              <div className="flex gap-3 mt-1 text-xs text-gray-600">
                <span>
                  <span className="text-green-700 font-medium">{p.present}</span> present
                </span>
                <span>
                  <span className="text-yellow-700 font-medium">{p.late}</span> late
                </span>
                <span>
                  <span className="text-red-700 font-medium">{p.absent}</span> absent
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Per-learner table */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {error ? (
            <div className="py-12 px-4 text-center text-red-600">{error}</div>
          ) : loading ? (
            <div className="py-12 text-center text-gray-500">Loading…</div>
          ) : visibleRows.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              No learners match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-700">
                    <Th sort={sort} k="name" onClick={toggleSort}>Learner</Th>
                    <Th sort={sort} k="program" onClick={toggleSort}>Program</Th>
                    <Th sort={sort} k="present" onClick={toggleSort}>Present</Th>
                    <Th sort={sort} k="late" onClick={toggleSort}>Late</Th>
                    <Th sort={sort} k="absent" onClick={toggleSort}>Absent</Th>
                    <Th sort={sort} k="avgIn" onClick={toggleSort}>Avg in</Th>
                    <Th sort={sort} k="avgOut" onClick={toggleSort}>Avg out</Th>
                    <Th sort={sort} k="lateLunch" onClick={toggleSort}>Late lunches</Th>
                    <Th sort={sort} k="missingOut" onClick={toggleSort}>Missing out</Th>
                    <Th sort={sort} k="pct" onClick={toggleSort}>Attendance</Th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const isOpen = expanded.has(row.learner.id);
                    return (
                      <React.Fragment key={row.learner.id}>
                        <tr
                          className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${
                            isOpen ? "bg-blue-50" : ""
                          }`}
                          onClick={() => toggleExpanded(row.learner.id)}
                        >
                          <td className="py-2 px-3 font-medium text-gray-900">
                            <span className="inline-block w-4 text-gray-400">
                              {isOpen ? "▼" : "▶"}
                            </span>{" "}
                            {row.learner.name}
                          </td>
                          <td className="py-2 px-3 text-gray-700">
                            {row.learner.program
                              ? PROGRAM_LABEL[row.learner.program] ?? row.learner.program
                              : "—"}
                          </td>
                          <td className="py-2 px-3 text-green-700 font-medium">{row.summary.present}</td>
                          <td className="py-2 px-3 text-yellow-700 font-medium">{row.summary.late}</td>
                          <td className="py-2 px-3 text-red-700 font-medium">{row.summary.absent}</td>
                          <td className="py-2 px-3 text-gray-700">{formatMinutesOfDay(row.summary.avgCheckInMinutes)}</td>
                          <td className="py-2 px-3 text-gray-700">{formatMinutesOfDay(row.summary.avgCheckOutMinutes)}</td>
                          <td className="py-2 px-3 text-gray-700">{row.summary.lateLunches}</td>
                          <td className="py-2 px-3 text-gray-700">{row.summary.missingCheckouts}</td>
                          <td className="py-2 px-3">
                            <AttendancePctPill pct={row.summary.attendancePct} />
                          </td>
                        </tr>
                        {isOpen && <DailyDetailRow row={row} />}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Th({
  children,
  k,
  sort,
  onClick,
}: {
  children: React.ReactNode;
  k: SortKey;
  sort: SortState;
  onClick: (k: SortKey) => void;
}) {
  const active = sort.key === k;
  return (
    <th
      onClick={() => onClick(k)}
      className="py-3 px-3 font-medium select-none cursor-pointer"
    >
      {children}
      {active && <span className="ml-1 text-gray-400">{sort.dir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

function AttendancePctPill({ pct }: { pct: number }) {
  const tone =
    pct >= 90 ? "bg-green-100 text-green-800"
    : pct >= 75 ? "bg-yellow-100 text-yellow-800"
    : "bg-red-100 text-red-800";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${tone}`}>
      {pct}%
    </span>
  );
}

function DailyDetailRow({ row }: { row: LearnerRow }) {
  if (row.records.length === 0) {
    return (
      <tr>
        <td colSpan={10} className="py-4 px-8 text-sm text-gray-500 italic bg-gray-50">
          No attendance records in this range.
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td colSpan={10} className="bg-gray-50 px-8 py-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500">
              <th className="text-left py-1 pr-3">Date</th>
              <th className="text-left py-1 pr-3">Status</th>
              <th className="text-left py-1 pr-3">Time in</th>
              <th className="text-left py-1 pr-3">Time out</th>
              <th className="text-left py-1 pr-3">Lunch</th>
              <th className="text-left py-1 pr-3">Lunch status</th>
            </tr>
          </thead>
          <tbody>
            {row.records.map((r) => (
              <tr key={r.id} className="border-t border-gray-200">
                <td className="py-1 pr-3 font-mono text-gray-700">{r.date.slice(0, 10)}</td>
                <td className="py-1 pr-3 text-gray-700">{r.status ?? "—"}</td>
                <td className="py-1 pr-3 text-gray-700">{prettyTimestamp(r.time_in)}</td>
                <td className="py-1 pr-3 text-gray-700">{prettyTimestamp(r.time_out)}</td>
                <td className="py-1 pr-3 text-gray-700">{formatLunchCell(r)}</td>
                <td className="py-1 pr-3 text-gray-700">{r.lunch_status ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );
}

function formatLunchCell(r: AttendanceRecord): string {
  const events = r.lunch_events ?? [];
  if (events.length === 0) {
    if (r.lunch_out || r.lunch_in) {
      return `${prettyTimestamp(r.lunch_out)} → ${prettyTimestamp(r.lunch_in)}`;
    }
    return "—";
  }
  return events
    .map((e) => `${e.type}@${parsePBDate(e.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`)
    .join(", ");
}

function compareRows(sort: SortState): (a: LearnerRow, b: LearnerRow) => number {
  const dir = sort.dir === "asc" ? 1 : -1;
  const key = sort.key;
  return (a, b) => {
    const av = rowSortValue(a, key);
    const bv = rowSortValue(b, key);
    if (av === bv) return a.learner.name.localeCompare(b.learner.name);
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    if (av === null) return 1;
    if (bv === null) return -1;
    return String(av).localeCompare(String(bv)) * dir;
  };
}

function rowSortValue(r: LearnerRow, key: SortKey): number | string | null {
  switch (key) {
    case "name": return r.learner.name;
    case "program": return r.learner.program ?? "";
    case "present": return r.summary.present;
    case "late": return r.summary.late;
    case "absent": return r.summary.absent;
    case "avgIn": return r.summary.avgCheckInMinutes;
    case "avgOut": return r.summary.avgCheckOutMinutes;
    case "lateLunch": return r.summary.lateLunches;
    case "missingOut": return r.summary.missingCheckouts;
    case "pct": return r.summary.attendancePct;
  }
}

interface ProgramTotal {
  code: ProgramCode;
  label: string;
  learnerCount: number;
  present: number;
  late: number;
  absent: number;
  attendancePct: number;
}

function buildProgramTotals(rows: LearnerRow[]): ProgramTotal[] {
  const codes: ProgramCode[] = ["chmk", "cre", "exp"];
  return codes.map((code) => {
    const cohort = rows.filter((r) => r.learner.program === code);
    let present = 0, late = 0, absent = 0, jLate = 0, daysTracked = 0;
    for (const r of cohort) {
      present += r.summary.present;
      late += r.summary.late;
      absent += r.summary.absent;
      jLate += r.summary.jLate;
      daysTracked += r.summary.daysTracked;
    }
    const attendancePct = daysTracked === 0
      ? 0
      : Math.round(((present + late + jLate) / daysTracked) * 100);
    return {
      code,
      label: PROGRAM_LABEL[code],
      learnerCount: cohort.length,
      present, late, absent,
      attendancePct,
    };
  });
}

function downloadCsv(rows: LearnerRow[], range: DateRange) {
  const header = [
    "Learner","Email","Program","Days tracked","Present","Late","Absent",
    "jLate","jAbsent","Avg check-in","Avg check-out","Total lunch (min)",
    "Late lunches","Missing checkouts","Attendance %",
  ];
  const csvRows: string[] = [header.join(",")];
  for (const r of rows) {
    const s = r.summary;
    csvRows.push([
      csvCell(r.learner.name),
      csvCell(r.learner.email),
      csvCell(r.learner.program ? PROGRAM_LABEL[r.learner.program] ?? r.learner.program : ""),
      s.daysTracked,
      s.present, s.late, s.absent, s.jLate, s.jAbsent,
      csvCell(formatMinutesOfDay(s.avgCheckInMinutes)),
      csvCell(formatMinutesOfDay(s.avgCheckOutMinutes)),
      s.totalLunchMinutes,
      s.lateLunches, s.missingCheckouts,
      s.attendancePct,
    ].join(","));
  }
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance-${range.from}_to_${range.to}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvCell(val: string): string {
  if (/[",\n]/.test(val)) return `"${val.replace(/"/g, '""')}"`;
  return val;
}
