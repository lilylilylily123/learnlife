"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { pb } from "@/app/pb";
import { PROGRAM_CODES, type ProgramCode } from "@learnlife/pb-client";
import {
  formatMinutesOfDay,
  prettyTimestamp,
  parsePBDate,
  computeAttendanceRates,
} from "@learnlife/shared";
import type { AttendanceRecord } from "@learnlife/pb-client";
import {
  useAdminHistoryData,
  resolveRange,
  type DateRange,
  type LearnerRow,
  type RangePreset,
} from "@/app/hooks/useAdminHistoryData";
import {
  HEADING,
  KICKER,
  Kicker,
  Pill,
  LMark,
  InkSelect,
  InkInput,
} from "@/app/components/ll-ui";
import { logAuditEvent } from "@/lib/audit";

const PROGRAM_LABEL: Record<ProgramCode, string> = {
  chmk: "Changemaker",
  cre: "Creator",
  exp: "Explorer",
};

type SortKey =
  | "name" | "program" | "present" | "late" | "absent" | "missing"
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
    const role = (pb.authStore.record as { role?: string } | null)?.role;
    if (!pb.authStore.isValid || (role !== "admin" && role !== "lg")) {
      router.push("/");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAuthChecked(true);
  }, [router]);

  const { rows, expectedDays, loading, error, refresh } = useAdminHistoryData({
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

  const programTotals = useMemo(
    () => buildProgramTotals(rows, expectedDays),
    [rows, expectedDays],
  );

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

  const onExportCsv = () => {
    downloadCsv(visibleRows, range);
    // Fire-and-forget — never block the download on the audit write.
    void logAuditEvent("csv_export", {
      rowCount: visibleRows.length,
      from: range.from,
      to: range.to,
      programFilter,
      preset,
    });
  };

  if (!authChecked) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{
          background: "var(--ll-bg)",
          color: "var(--ll-muted)",
          ...HEADING,
          fontSize: 22,
        }}
      >
        Checking access…
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden"
      style={{ background: "var(--ll-bg)", color: "var(--ll-ink)" }}
    >
      {/* ─── Top bar ───────────────────────────────────────── */}
      <header
        className="flex items-stretch shrink-0"
        style={{
          padding: "14px 24px",
          gap: 18,
          borderBottom: "1.5px solid var(--ll-ink)",
          background: "var(--ll-surface)",
        }}
      >
        <div
          className="flex items-center"
          style={{
            gap: 12,
            paddingRight: 18,
            borderRight: "1px solid var(--ll-divider)",
          }}
        >
          <LMark size={30} />
          <div>
            <Kicker>Attender · Reports</Kicker>
            <div style={{ ...HEADING, fontSize: 18, lineHeight: 1.15 }}>
              Attendance over time
            </div>
          </div>
        </div>

        <div className="flex-1 flex items-center" style={{ gap: 8 }}>
          <span style={KICKER}>Range</span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--ll-ink)",
              letterSpacing: "0.04em",
            }}
          >
            {range.from} → {range.to}
          </span>
          <span style={{ ...KICKER, marginLeft: 14 }}>
            {loading ? "loading…" : `${visibleRows.length} learners`}
          </span>
        </div>

        <div className="flex items-center" style={{ gap: 6 }}>
          <Pill size="sm" onClick={refresh}>
            ↻ Refresh
          </Pill>
          <Pill
            size="sm"
            variant="accent"
            onClick={onExportCsv}
            title={
              loading || visibleRows.length === 0
                ? "No data to export"
                : "Download CSV"
            }
          >
            ⬇ CSV
          </Pill>
          <Pill size="sm" onClick={() => router.push("/history")}>
            Daily view
          </Pill>
          <Pill size="sm" variant="ink" onClick={() => router.push("/")}>
            ← Dashboard
          </Pill>
        </div>
      </header>

      {/* ─── Range presets + filters toolbar ──────────────── */}
      <div
        className="shrink-0"
        style={{
          padding: "10px 24px",
          borderBottom: "1px solid var(--ll-divider)",
          background: "var(--ll-bg)",
        }}
      >
        <div
          className="flex items-center flex-wrap"
          style={{ gap: 8, marginBottom: 8 }}
        >
          <Kicker>Date range</Kicker>
          {PRESETS.map((p) => (
            <Pill
              key={p.key}
              active={preset === p.key}
              onClick={() => setPreset(p.key)}
            >
              {p.label}
            </Pill>
          ))}
          <div
            className="self-stretch"
            style={{
              width: 1,
              background: "var(--ll-divider)",
              margin: "0 4px",
            }}
          />
          <Kicker>Custom</Kicker>
          <InkInput
            type="date"
            value={customRange.from}
            onChange={(e) => {
              setCustomRange((r) => ({ ...r, from: e.target.value }));
              setPreset("custom");
            }}
          />
          <span style={{ color: "var(--ll-muted)", fontSize: 14 }}>→</span>
          <InkInput
            type="date"
            value={customRange.to}
            onChange={(e) => {
              setCustomRange((r) => ({ ...r, to: e.target.value }));
              setPreset("custom");
            }}
          />
        </div>

        <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
          <Kicker>Program</Kicker>
          <InkSelect
            value={programFilter}
            onChange={(e) => setProgramFilter(e.target.value)}
          >
            <option value="all">All programs</option>
            {Object.entries(PROGRAM_CODES).map(([name, code]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </InkSelect>

          <div
            className="self-stretch"
            style={{
              width: 1,
              background: "var(--ll-divider)",
              margin: "0 4px",
            }}
          />
          <div
            className="flex items-center flex-1 min-w-[200px]"
            style={{
              background: "var(--ll-surface)",
              border: "1.5px solid var(--ll-ink)",
              padding: "5px 10px",
              gap: 8,
              maxWidth: 360,
            }}
          >
            <span style={{ fontSize: 11, color: "var(--ll-muted)" }}>🔍</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or email…"
              className="bg-transparent outline-none flex-1"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 12.5,
                color: "var(--ll-ink)",
                minWidth: 0,
              }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="cursor-pointer"
                style={{ color: "var(--ll-muted)", fontSize: 14 }}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── Body: program cards + per-learner table ─────── */}
      <div className="flex-1 overflow-y-auto">
        {/* Program cards */}
        <div
          className="grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 0,
            borderBottom: "1px solid var(--ll-divider)",
          }}
        >
          {programTotals.map((p, i) => (
            <ProgramCard
              key={p.code}
              total={p}
              border={i < programTotals.length - 1}
            />
          ))}
        </div>

        {/* Learner table */}
        {error ? (
          <div
            className="text-center"
            style={{
              padding: "80px 24px",
              color: "var(--ll-warm)",
              ...HEADING,
              fontSize: 22,
            }}
          >
            {error}
          </div>
        ) : loading ? (
          <div
            className="text-center"
            style={{
              padding: "80px 24px",
              color: "var(--ll-muted)",
            }}
          >
            <div style={{ ...HEADING, fontSize: 22 }}>Loading…</div>
          </div>
        ) : visibleRows.length === 0 ? (
          <div
            className="text-center"
            style={{
              padding: "80px 24px",
              color: "var(--ll-muted)",
            }}
          >
            <div style={{ ...HEADING, fontSize: 22 }}>No matches.</div>
            <div style={{ ...KICKER, marginTop: 10 }}>
              Try adjusting the range or filters
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full"
              style={{ fontSize: 12.5, borderCollapse: "collapse" }}
            >
              <thead>
                <tr
                  style={{
                    background: "var(--ll-surface)",
                    borderBottom: "1px solid var(--ll-divider)",
                  }}
                >
                  <Th sort={sort} k="name" onClick={toggleSort}>Learner</Th>
                  <Th sort={sort} k="program" onClick={toggleSort}>Program</Th>
                  <Th sort={sort} k="present" onClick={toggleSort} align="right">Present</Th>
                  <Th sort={sort} k="late" onClick={toggleSort} align="right">Late</Th>
                  <Th sort={sort} k="absent" onClick={toggleSort} align="right">Absent</Th>
                  <Th sort={sort} k="missing" onClick={toggleSort} align="right">Missing</Th>
                  <Th sort={sort} k="avgIn" onClick={toggleSort} align="right">Avg in</Th>
                  <Th sort={sort} k="avgOut" onClick={toggleSort} align="right">Avg out</Th>
                  <Th sort={sort} k="lateLunch" onClick={toggleSort} align="right">Late lunch</Th>
                  <Th sort={sort} k="missingOut" onClick={toggleSort} align="right">No out</Th>
                  <Th sort={sort} k="pct" onClick={toggleSort} align="right">Attendance</Th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, i) => {
                  const isOpen = expanded.has(row.learner.id);
                  return (
                    <React.Fragment key={row.learner.id}>
                      <tr
                        className="ll-row cursor-pointer"
                        style={{
                          borderBottom: "1px solid var(--ll-divider)",
                          background: isOpen
                            ? "color-mix(in srgb, var(--ll-accent) 8%, transparent)"
                            : i % 2
                              ? "var(--ll-bg)"
                              : "var(--ll-surface)",
                        }}
                        onClick={() => toggleExpanded(row.learner.id)}
                      >
                        <td style={cellStyle}>
                          <span
                            style={{
                              display: "inline-block",
                              width: 14,
                              color: "var(--ll-muted)",
                              fontSize: 10,
                            }}
                          >
                            {isOpen ? "▼" : "▶"}
                          </span>{" "}
                          <span style={{ fontWeight: 600 }}>
                            {row.learner.name}
                          </span>
                        </td>
                        <td
                          style={{
                            ...cellStyle,
                            color: "var(--ll-muted)",
                            fontSize: 11.5,
                          }}
                        >
                          {row.learner.program
                            ? PROGRAM_LABEL[row.learner.program] ??
                              row.learner.program
                            : "—"}
                        </td>
                        <td style={{ ...cellStyle, ...numCell, color: "var(--ll-accent)" }}>
                          {row.summary.present}
                        </td>
                        <td style={{ ...cellStyle, ...numCell, color: "var(--ll-ink-2)" }}>
                          {row.summary.late}
                        </td>
                        <td style={{ ...cellStyle, ...numCell, color: "var(--ll-warm)" }}>
                          {row.summary.absent}
                        </td>
                        <td style={{ ...cellStyle, ...numCell, color: "var(--ll-muted)" }}>
                          {row.summary.missingRecords}
                        </td>
                        <td style={{ ...cellStyle, ...numCell }}>
                          {formatMinutesOfDay(row.summary.avgCheckInMinutes)}
                        </td>
                        <td style={{ ...cellStyle, ...numCell }}>
                          {formatMinutesOfDay(row.summary.avgCheckOutMinutes)}
                        </td>
                        <td style={{ ...cellStyle, ...numCell }}>
                          {row.summary.lateLunches}
                        </td>
                        <td style={{ ...cellStyle, ...numCell }}>
                          {row.summary.missingCheckouts}
                        </td>
                        <td style={{ ...cellStyle, textAlign: "right" }}>
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
  );
}

const cellStyle: React.CSSProperties = {
  padding: "11px 14px",
  fontSize: 13.5,
};
const numCell: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  textAlign: "right",
  fontWeight: 600,
};

function Th({
  children,
  k,
  sort,
  onClick,
  align = "left",
}: {
  children: React.ReactNode;
  k: SortKey;
  sort: SortState;
  onClick: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  return (
    <th
      onClick={() => onClick(k)}
      style={{
        ...KICKER,
        padding: "13px 14px",
        textAlign: align,
        cursor: "pointer",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
      {active && (
        <span
          style={{
            marginLeft: 4,
            color: "var(--ll-ink)",
            fontSize: 9,
          }}
        >
          {sort.dir === "asc" ? "▲" : "▼"}
        </span>
      )}
    </th>
  );
}

function AttendancePctPill({ pct }: { pct: number }) {
  const cfg =
    pct >= 90
      ? { bg: "var(--ll-accent)", fg: "var(--ll-accent-ink)" }
      : pct >= 75
        ? { bg: "var(--ll-lime)", fg: "var(--ll-lime-ink)" }
        : { bg: "var(--ll-warm)", fg: "var(--ll-warm-ink)" };
  return (
    <span
      className="inline-block"
      style={{
        background: cfg.bg,
        color: cfg.fg,
        padding: "3px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.05em",
      }}
    >
      {pct}%
    </span>
  );
}

function DailyDetailRow({ row }: { row: LearnerRow }) {
  if (row.records.length === 0) {
    return (
      <tr>
        <td
          colSpan={11}
          style={{
            padding: "16px 32px",
            background: "color-mix(in srgb, var(--ll-accent) 8%, transparent)",
            color: "var(--ll-muted)",
            fontStyle: "italic",
            fontSize: 11.5,
          }}
        >
          No attendance records in this range.
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td
        colSpan={11}
        style={{
          background: "color-mix(in srgb, var(--ll-accent) 8%, transparent)",
          padding: "12px 32px",
        }}
      >
        <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ ...KICKER }}>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>Date</th>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>Status</th>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>Time in</th>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>Time out</th>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>Lunch</th>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>Lunch status</th>
            </tr>
          </thead>
          <tbody>
            {row.records.map((r) => (
              <tr
                key={r.id}
                style={{ borderTop: "1px solid var(--ll-divider)" }}
              >
                <td
                  style={{
                    padding: "6px 8px",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                  }}
                >
                  {r.date.slice(0, 10)}
                </td>
                <td style={{ padding: "6px 8px" }}>{r.status ?? "—"}</td>
                <td style={{ padding: "6px 8px", fontFamily: "var(--font-mono)" }}>
                  {prettyTimestamp(r.time_in)}
                </td>
                <td style={{ padding: "6px 8px", fontFamily: "var(--font-mono)" }}>
                  {prettyTimestamp(r.time_out)}
                </td>
                <td style={{ padding: "6px 8px", fontFamily: "var(--font-mono)" }}>
                  {formatLunchCell(r)}
                </td>
                <td style={{ padding: "6px 8px" }}>{r.lunch_status ?? "—"}</td>
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
    .map(
      (e) =>
        `${e.type}@${parsePBDate(e.time).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}`,
    )
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
    case "missing": return r.summary.missingRecords;
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
  daysTracked: number;
  expectedDays: number;
  missingRecords: number;
  present: number;
  late: number;
  absent: number;
  jLate: number;
  jAbsent: number;
  onTimePct: number;
  attendancePct: number;
  absentPct: number;
  avgCheckInMinutes: number | null;
  avgCheckOutMinutes: number | null;
  lateLunches: number;
  missingCheckouts: number;
}

function buildProgramTotals(rows: LearnerRow[], weekdays: number): ProgramTotal[] {
  const codes: ProgramCode[] = ["chmk", "cre", "exp"];
  return codes.map((code) => {
    const cohort = rows.filter((r) => r.learner.program === code);
    let present = 0,
      late = 0,
      absent = 0,
      jLate = 0,
      jAbsent = 0,
      daysTracked = 0,
      lateLunches = 0,
      missingCheckouts = 0;
    let inSum = 0,
      inCount = 0,
      outSum = 0,
      outCount = 0;
    for (const r of cohort) {
      present += r.summary.present;
      late += r.summary.late;
      absent += r.summary.absent;
      jLate += r.summary.jLate;
      jAbsent += r.summary.jAbsent;
      daysTracked += r.summary.daysTracked;
      lateLunches += r.summary.lateLunches;
      missingCheckouts += r.summary.missingCheckouts;
      if (r.summary.avgCheckInMinutes !== null) {
        inSum += r.summary.avgCheckInMinutes;
        inCount++;
      }
      if (r.summary.avgCheckOutMinutes !== null) {
        outSum += r.summary.avgCheckOutMinutes;
        outCount++;
      }
    }
    const rates = computeAttendanceRates(
      { present, late, absent, jLate, jAbsent, daysTracked },
      weekdays * cohort.length,
    );
    return {
      code,
      label: PROGRAM_LABEL[code],
      learnerCount: cohort.length,
      daysTracked,
      expectedDays: rates.expectedDays,
      missingRecords: rates.missingRecords,
      present,
      late,
      absent,
      jLate,
      jAbsent,
      onTimePct: rates.onTimePct,
      attendancePct: rates.attendancePct,
      absentPct: rates.absentPct,
      avgCheckInMinutes: inCount > 0 ? Math.round(inSum / inCount) : null,
      avgCheckOutMinutes: outCount > 0 ? Math.round(outSum / outCount) : null,
      lateLunches,
      missingCheckouts,
    };
  });
}

function ProgramCard({
  total: p,
  border,
}: {
  total: ProgramTotal;
  border: boolean;
}) {
  const empty = p.learnerCount === 0;
  return (
    <div
      style={{
        background: "var(--ll-surface)",
        padding: "20px 24px",
        borderRight: border ? "1px solid var(--ll-divider)" : "none",
        opacity: empty ? 0.6 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* Label row */}
      <div className="flex items-baseline justify-between" style={{ gap: 8 }}>
        <div style={{ ...HEADING, fontSize: 22 }}>{p.label}</div>
        <div style={{ ...KICKER, color: "var(--ll-muted)" }}>
          {p.learnerCount}{" "}
          {p.learnerCount === 1 ? "learner" : "learners"}
        </div>
      </div>

      {empty ? (
        <div
          style={{
            color: "var(--ll-muted)",
            fontStyle: "italic",
            fontSize: 13.5,
          }}
        >
          No learners in this program.
        </div>
      ) : (
        <>
          {/* Headline percentages */}
          <div className="flex items-end" style={{ gap: 24 }}>
            <div>
              <div
                style={{
                  ...HEADING,
                  fontSize: 44,
                  color: "var(--ll-accent)",
                  lineHeight: 1,
                }}
              >
                {p.onTimePct}%
              </div>
              <div style={{ ...KICKER, marginTop: 6 }}>On time</div>
            </div>
            <div>
              <div
                style={{
                  ...HEADING,
                  fontSize: 28,
                  color: "var(--ll-ink-2)",
                  lineHeight: 1.05,
                }}
              >
                {p.attendancePct}%
              </div>
              <div style={{ ...KICKER, marginTop: 6 }}>Attended</div>
            </div>
            <div className="flex-1" />
            <div className="text-right">
              <div
                style={{
                  ...HEADING,
                  fontSize: 18,
                  color: "var(--ll-warm)",
                  lineHeight: 1.05,
                }}
              >
                {p.absentPct}%
              </div>
              <div style={{ ...KICKER, marginTop: 6 }}>Absent</div>
            </div>
          </div>

          {/* Stacked attendance bar */}
          <AttendanceBar p={p} />

          {/* Counts breakdown */}
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 10,
            }}
          >
            <CountCell label="Present" value={p.present} tone="accent" />
            <CountCell label="Late" value={p.late} tone="lime" />
            <CountCell label="Absent" value={p.absent} tone="warm" />
            <CountCell label="J·Absent" value={p.jAbsent} />
          </div>

          {/* Schedule + behaviour breakdown */}
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 10,
              paddingTop: 10,
              borderTop: "1px solid var(--ll-divider)",
            }}
          >
            <DetailCell
              label="Avg in"
              value={formatMinutesOfDay(p.avgCheckInMinutes)}
            />
            <DetailCell
              label="Avg out"
              value={formatMinutesOfDay(p.avgCheckOutMinutes)}
            />
            <DetailCell
              label="Late lunches"
              value={String(p.lateLunches)}
              tone={p.lateLunches > 0 ? "warm" : "muted"}
            />
            <DetailCell
              label="No check-out"
              value={String(p.missingCheckouts)}
              tone={p.missingCheckouts > 0 ? "warm" : "muted"}
            />
          </div>

          {/* Tracked vs expected */}
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--ll-muted)",
              letterSpacing: "0.04em",
              borderTop: "1px solid var(--ll-divider)",
              paddingTop: 10,
            }}
          >
            <span style={{ color: "var(--ll-ink-2)", fontWeight: 700 }}>
              {p.daysTracked}
            </span>{" "}
            of{" "}
            <span style={{ color: "var(--ll-ink-2)", fontWeight: 700 }}>
              {p.expectedDays}
            </span>{" "}
            learner-days tracked ·{" "}
            <span style={{ color: "var(--ll-warm)", fontWeight: 700 }}>
              {p.missingRecords}
            </span>{" "}
            missing
          </div>
        </>
      )}
    </div>
  );
}

function AttendanceBar({ p }: { p: ProgramTotal }) {
  const total = p.present + p.late + p.absent + p.jAbsent + p.missingRecords;
  if (total === 0)
    return (
      <div
        style={{
          height: 8,
          background: "var(--ll-surface-2)",
          border: "1px solid var(--ll-divider)",
        }}
      />
    );
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div
      className="flex"
      style={{
        height: 10,
        border: "1.5px solid var(--ll-ink)",
        background: "var(--ll-surface)",
        overflow: "hidden",
      }}
    >
      {p.present > 0 && (
        <div
          style={{
            width: seg(p.present),
            background: "var(--ll-accent)",
          }}
        />
      )}
      {p.late > 0 && (
        <div
          style={{
            width: seg(p.late),
            background: "var(--ll-lime)",
          }}
        />
      )}
      {p.absent > 0 && (
        <div
          style={{
            width: seg(p.absent),
            background: "var(--ll-warm)",
          }}
        />
      )}
      {p.jAbsent > 0 && (
        <div
          style={{
            width: seg(p.jAbsent),
            background: "var(--ll-ink-2)",
          }}
        />
      )}
      {p.missingRecords > 0 && (
        <div
          style={{
            width: seg(p.missingRecords),
            background:
              "repeating-linear-gradient(45deg, var(--ll-divider) 0 4px, transparent 4px 8px), var(--ll-bg)",
          }}
        />
      )}
    </div>
  );
}

function CountCell({
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
          : "var(--ll-ink-2)";
  return (
    <div>
      <div
        style={{
          ...HEADING,
          fontSize: 22,
          color,
          lineHeight: 1.05,
        }}
      >
        {value}
      </div>
      <div style={{ ...KICKER, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function DetailCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warm" | "muted";
}) {
  const color =
    tone === "warm"
      ? "var(--ll-warm)"
      : tone === "muted"
        ? "var(--ll-muted)"
        : "var(--ll-ink)";
  return (
    <div>
      <div style={{ ...KICKER, marginBottom: 3 }}>{label}</div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 14,
          fontWeight: 700,
          color,
          letterSpacing: "0.02em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function downloadCsv(rows: LearnerRow[], range: DateRange) {
  const header = [
    "Learner","Email","Program","Expected days","Days tracked","Missing records",
    "Present","Late","Absent","jLate","jAbsent",
    "Avg check-in","Avg check-out","Total lunch (min)","Late lunches","Missing checkouts",
    "On time %","Attendance %","Absent %",
  ];
  const csvRows: string[] = [header.join(",")];
  for (const r of rows) {
    const s = r.summary;
    csvRows.push([
      csvCell(r.learner.name),
      csvCell(r.learner.email),
      csvCell(r.learner.program ? PROGRAM_LABEL[r.learner.program] ?? r.learner.program : ""),
      s.expectedDays, s.daysTracked, s.missingRecords,
      s.present, s.late, s.absent, s.jLate, s.jAbsent,
      csvCell(formatMinutesOfDay(s.avgCheckInMinutes)),
      csvCell(formatMinutesOfDay(s.avgCheckOutMinutes)),
      s.totalLunchMinutes,
      s.lateLunches, s.missingCheckouts,
      s.onTimePct, s.attendancePct, s.absentPct,
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
