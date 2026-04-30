"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Student, AttendanceFilterKey, AttendanceCounts } from "../types";
import type { ActivityEvent } from "./ActivityFeed";
import {
  HEADING,
  KICKER,
  Pill,
  Kicker,
  StatusPill,
  Avatar,
  BigStat,
  LMark,
  type ScanState,
} from "./ll-ui";

interface AttenderDProps {
  appVersion: string;
  viewDate: string;
  testMode: boolean;
  uid: string;
  exists: boolean;

  search: string;
  setSearch: (v: string) => void;
  programFilter: string;
  setProgramFilter: (v: string) => void;
  attendanceFilter: AttendanceFilterKey;
  setAttendanceFilter: (v: AttendanceFilterKey) => void;
  attendanceCounts: AttendanceCounts;

  filtered: Student[];
  totalItems: number;
  page: number;
  perPage: number;
  totalPages: number;
  setPage: (n: number) => void;
  setPerPage: (n: number) => void;

  activityEvents: ActivityEvent[];

  onShowActivityFeed: () => void;
  onShowAddLearner: () => void;
  onShowHistory: () => void;
  onLogout: () => void;
  onToggleTestMode: () => void;

  onCheckAction: (id: string, action: string) => void;
  onCommentUpdate: (id: string, comment: string) => Promise<void>;
  onTimeEdit: (
    id: string,
    field: "time_in" | "time_out",
    timeStr: string,
  ) => Promise<void>;
  onReset: (id: string) => void;
}

const PROGRAM_LABEL: Record<string, string> = {
  exp: "Explorers",
  cre: "Creators",
  chmk: "Changemakers",
  pf: "Pathfinders",
};

function formatTimeShort(val?: string | null) {
  if (!val) return "—";
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return val;
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getPresenceState(s: Student): ScanState {
  if (s.time_out) return "out";
  if (s.time_in) {
    const events = s.lunch_events || [];
    if (events.length > 0 && events[events.length - 1].type === "out")
      return "lunch";
    return "in";
  }
  return "absent";
}

function shortCardNum(id: string) {
  const tail = id.replace(/[^a-zA-Z0-9]/g, "").slice(-3).toUpperCase();
  return `#A-${tail || "000"}`;
}

function formatTimeAgo(d: Date) {
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

// ─── Main component ────────────────────────────────────────

export function AttenderD(props: AttenderDProps) {
  const {
    appVersion,
    viewDate,
    testMode,
    uid,
    exists,
    search,
    setSearch,
    programFilter,
    setProgramFilter,
    attendanceFilter,
    setAttendanceFilter,
    attendanceCounts,
    filtered,
    totalItems,
    page,
    perPage,
    totalPages,
    setPage,
    setPerPage,
    activityEvents,
    onShowActivityFeed,
    onShowAddLearner,
    onShowHistory,
    onLogout,
    onToggleTestMode,
    onCheckAction,
    onCommentUpdate,
    onTimeEdit,
    onReset,
  } = props;

  const searchRef = useRef<HTMLInputElement | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"table" | "wall" | "scan">("table");
  const [editingTimeKey, setEditingTimeKey] = useState<string | null>(null);
  const [timeEditValue, setTimeEditValue] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentValue, setCommentValue] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);

  // "/" focus shortcut for search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Drop selection for rows that are no longer visible
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const visible = new Set(filtered.map((s) => s.id));
    const next = new Set<string>();
    for (const id of selectedIds) if (visible.has(id)) next.add(id);
    if (next.size !== selectedIds.size) setSelectedIds(next);
  }, [filtered, selectedIds]);

  const counts = useMemo(
    () => ({
      in: attendanceCounts.here,
      lunch: attendanceCounts.lunch,
      out: attendanceCounts.out,
      absent: attendanceCounts.absent + attendanceCounts.away,
      late: attendanceCounts.late + attendanceCounts.jLate,
    }),
    [attendanceCounts],
  );
  const total = attendanceCounts.all || filtered.length || 1;
  const pct = (n: number) => Math.round((n / total) * 100);
  const checkedIn = attendanceCounts.here + attendanceCounts.late;
  const onTimePct =
    checkedIn === 0
      ? 0
      : Math.round((attendanceCounts.here / checkedIn) * 100);

  const dateLabel = new Date(viewDate).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((s) => s.id)));
  };

  const recentScans: ActivityEvent[] = activityEvents.slice(-12).reverse();
  const moreScans = Math.max(0, activityEvents.length - recentScans.length);

  const pageWindow = useMemo(() => {
    const max = Math.max(1, totalPages);
    if (max <= 5)
      return Array.from({ length: max }, (_, i) => i + 1);
    if (page <= 3) return [1, 2, 3, 4, 5];
    if (page >= max - 2) return [max - 4, max - 3, max - 2, max - 1, max];
    return [page - 2, page - 1, page, page + 1, page + 2];
  }, [page, totalPages]);

  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden ll-attender"
      style={{ background: "var(--ll-bg)", color: "var(--ll-ink)" }}
    >
      {/* ─── BIG top bar ───────────────────────────────────── */}
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
            <Kicker>
              {testMode ? "Attender · Test mode" : "Attender · Reception"}
            </Kicker>
            <div
              style={{ ...HEADING, fontSize: 22, lineHeight: 1.15, marginTop: 2 }}
            >
              {dateLabel}
            </div>
          </div>
        </div>

        <div className="flex-1 flex items-center" style={{ gap: 28 }}>
          <BigStat
            n={counts.in}
            label={`IN · ${pct(counts.in)}%`}
            sub={`of ${total}`}
            tone="accent"
          />
          <BigStat
            n={counts.lunch}
            label={`LUNCH · ${pct(counts.lunch)}%`}
            sub={
              counts.lunch > 0
                ? `${counts.lunch} away`
                : "all back"
            }
            tone="lime"
          />
          <BigStat
            n={counts.out}
            label={`OUT · ${pct(counts.out)}%`}
            sub="checked out"
          />
          <BigStat
            n={counts.absent}
            label={`ABSENT · ${pct(counts.absent)}%`}
            sub={
              counts.absent > 0
                ? `${counts.absent} unaccounted`
                : "everyone here"
            }
            tone="warm"
          />
          <div
            className="self-stretch"
            style={{ width: 1, background: "var(--ll-divider)" }}
          />
          <BigStat
            n={`${onTimePct}%`}
            label="ON TIME"
            sub={
              checkedIn > 0
                ? `${attendanceCounts.here} of ${checkedIn}`
                : "—"
            }
          />
          <BigStat
            n={counts.late}
            label="LATE"
            sub={counts.late > 0 ? "after 10:01" : "all on time"}
          />
        </div>

        <div
          className="flex flex-col items-end justify-between shrink-0"
          style={{ gap: 6 }}
        >
          <div
            className="flex items-center"
            style={{
              gap: 6,
              border: `1.5px solid ${uid && !exists ? "var(--ll-warm)" : "var(--ll-ink)"}`,
              background: "var(--ll-bg)",
              padding: "4px 10px",
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: uid && !exists ? "var(--ll-warm)" : "var(--ll-accent)",
                animation: "ll-pulse 1.5s ease-in-out infinite",
              }}
            />
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.06em",
                color: uid && !exists ? "var(--ll-warm)" : "var(--ll-muted)",
                textTransform: "uppercase",
              }}
            >
              {uid
                ? exists
                  ? `Card · ${uid.slice(0, 12)}`
                  : `Unknown · ${uid.slice(0, 8)}`
                : "Reader live · ACR122U"}
            </div>
          </div>
          <div className="flex" style={{ gap: 6 }}>
            <Pill size="sm">Export</Pill>
            <Pill size="sm" variant="ink" onClick={onShowAddLearner}>
              + Add learner
            </Pill>
          </div>
        </div>
      </header>

      {/* ─── Toolbar: search + filters + utility ─────────── */}
      <div
        className="shrink-0"
        style={{
          borderBottom: "1px solid var(--ll-divider)",
          background: "var(--ll-bg)",
        }}
      >
        {/* Row 1 — Search + status + program filters */}
        <div
          className="flex items-center flex-wrap"
          style={{
            padding: "12px 28px",
            gap: 10,
          }}
        >
          <div
            className="flex items-center"
            style={{
              background: "var(--ll-surface)",
              border: "1.5px solid var(--ll-ink)",
              padding: "7px 12px",
              minWidth: 280,
              gap: 9,
            }}
          >
            <span
              aria-hidden
              style={{ fontSize: 13, color: "var(--ll-muted)", lineHeight: 1 }}
            >
              🔍
            </span>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, program, card #…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="bg-transparent outline-none flex-1"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 14,
                color: "var(--ll-ink)",
                minWidth: 0,
              }}
            />
            {search ? (
              <button
                onClick={() => setSearch("")}
                className="cursor-pointer"
                style={{
                  color: "var(--ll-muted)",
                  fontSize: 16,
                  lineHeight: 1,
                }}
                title="Clear"
                aria-label="Clear search"
              >
                ×
              </button>
            ) : (
              <span
                className="uppercase"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  color: "var(--ll-muted)",
                  padding: "1.5px 6px",
                  border: "1px solid var(--ll-divider)",
                  lineHeight: 1.1,
                }}
              >
                /
              </span>
            )}
          </div>

          <div
            className="self-stretch"
            style={{
              width: 1,
              background: "var(--ll-divider)",
              margin: "0 4px",
            }}
          />
          <Kicker>Status</Kicker>
          <Pill
            active={attendanceFilter === "all"}
            onClick={() => setAttendanceFilter("all")}
          >
            All · {attendanceCounts.all}
          </Pill>
          <Pill
            active={attendanceFilter === "here"}
            onClick={() => setAttendanceFilter("here")}
          >
            In · {attendanceCounts.here}
          </Pill>
          <Pill
            active={attendanceFilter === "late"}
            onClick={() => setAttendanceFilter("late")}
          >
            Late · {attendanceCounts.late}
          </Pill>
          <Pill
            active={attendanceFilter === "lunch"}
            onClick={() => setAttendanceFilter("lunch")}
          >
            Lunch · {attendanceCounts.lunch}
          </Pill>
          <Pill
            active={attendanceFilter === "out"}
            onClick={() => setAttendanceFilter("out")}
          >
            Out · {attendanceCounts.out}
          </Pill>
          <Pill
            active={attendanceFilter === "away"}
            onClick={() => setAttendanceFilter("away")}
          >
            Absent · {attendanceCounts.away + attendanceCounts.absent}
          </Pill>

          <div
            className="self-stretch"
            style={{
              width: 1,
              background: "var(--ll-divider)",
              margin: "0 4px",
            }}
          />
          <Kicker>Program</Kicker>
          <Pill
            active={programFilter === "all"}
            onClick={() => setProgramFilter("all")}
          >
            All
          </Pill>
          <Pill
            active={programFilter === "exp"}
            onClick={() => setProgramFilter("exp")}
          >
            Explorers
          </Pill>
          <Pill
            active={programFilter === "cre"}
            onClick={() => setProgramFilter("cre")}
          >
            Creators
          </Pill>
          <Pill
            active={programFilter === "chmk"}
            onClick={() => setProgramFilter("chmk")}
          >
            Changemakers
          </Pill>
        </div>

        {/* Row 2 — View switcher + tools cluster */}
        <div
          className="flex items-center"
          style={{
            padding: "8px 28px 12px",
            gap: 10,
            borderTop: "1px dashed var(--ll-divider)",
          }}
        >
          <Kicker>View</Kicker>
          <Pill
            active={viewMode === "table"}
            onClick={() => setViewMode("table")}
          >
            Table
          </Pill>
          <Pill
            active={viewMode === "wall"}
            onClick={() => setViewMode("wall")}
          >
            Wall
          </Pill>
          <Pill
            active={viewMode === "scan"}
            onClick={() => setViewMode("scan")}
          >
            Scan
          </Pill>

          <div className="flex-1" />

          <Kicker>Tools</Kicker>
          <Pill
            onClick={onShowActivityFeed}
            active={activityEvents.length > 0}
          >
            ● Live
            {activityEvents.length > 0 ? ` · ${activityEvents.length}` : ""}
          </Pill>
          <Pill variant="accent" onClick={onShowHistory}>
            History →
          </Pill>
          <Pill onClick={onToggleTestMode} active={testMode}>
            {testMode ? "Test ON" : "Test"}
          </Pill>
        </div>
      </div>

      {/* ─── Body: split scan stream + main view ───────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT — Live scan stream */}
        <aside
          className="flex flex-col overflow-hidden shrink-0"
          style={{
            width: 320,
            borderRight: "1.5px solid var(--ll-ink)",
            background: "var(--ll-surface)",
          }}
        >
          <div
            className="flex items-baseline justify-between"
            style={{
              padding: "14px 18px 10px",
              borderBottom: "1px solid var(--ll-divider)",
            }}
          >
            <Kicker>Live scans</Kicker>
            <span
              style={{
                ...KICKER,
                color: "var(--ll-muted)",
              }}
            >
              {recentScans.length} today
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {recentScans.length === 0 ? (
              <div
                className="text-center"
                style={{
                  padding: "48px 24px",
                  color: "var(--ll-muted)",
                  fontSize: 12,
                }}
              >
                <div style={{ ...HEADING, fontSize: 18, color: "var(--ll-ink-2)" }}>
                  Quiet so far.
                </div>
                <div
                  className="mt-2"
                  style={{
                    ...KICKER,
                    color: "var(--ll-muted)",
                  }}
                >
                  Tap a card to begin
                </div>
              </div>
            ) : (
              recentScans.map((e, i) => {
                const fresh = i === 0;
                const tone: ScanState =
                  e.actionType === "morning-in"
                    ? "in"
                    : e.actionType === "lunch-out"
                      ? "lunch"
                      : e.actionType === "lunch-in"
                        ? "in"
                        : e.actionType === "day-out"
                          ? "out"
                          : "in";
                const note =
                  e.actionType === "lunch-in"
                    ? "back from lunch"
                    : e.actionType === "lunch-out"
                      ? "to lunch"
                      : e.actionType === "day-out"
                        ? "checked out"
                        : null;
                const programLabel =
                  PROGRAM_LABEL[e.program] || e.program || "—";
                return (
                  <div
                    key={e.id}
                    className="flex items-center"
                    style={{
                      gap: 12,
                      padding: "10px 18px",
                      borderBottom: "1px solid var(--ll-divider)",
                      background: fresh
                        ? "color-mix(in srgb, var(--ll-accent) 13%, transparent)"
                        : "transparent",
                    }}
                  >
                    <div
                      className="shrink-0"
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        color: "var(--ll-muted)",
                        width: 44,
                      }}
                    >
                      {e.timestamp.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </div>
                    <Avatar name={e.learnerName} size={28} />
                    <div className="flex-1 min-w-0">
                      <div
                        className="truncate"
                        style={{ fontWeight: 600, fontSize: 13.5 }}
                      >
                        {e.learnerName}
                      </div>
                      <div
                        className="truncate"
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 10.5,
                          color: "var(--ll-muted)",
                          marginTop: 1,
                        }}
                      >
                        {programLabel}
                        {note ? ` · ${note}` : ""}
                      </div>
                    </div>
                    <StatusPill state={tone} />
                  </div>
                );
              })
            )}
          </div>
          <div
            className="flex items-center justify-between"
            style={{
              padding: "11px 18px",
              borderTop: "1px solid var(--ll-divider)",
              ...KICKER,
              color: "var(--ll-muted)",
              gap: 8,
            }}
          >
            <span className="truncate">
              {moreScans > 0
                ? `+ ${moreScans} more today · view all →`
                : appVersion
                  ? `v${appVersion}`
                  : "Attender"}
            </span>
            <button
              onClick={onLogout}
              className="cursor-pointer ll-link shrink-0"
              style={{
                ...KICKER,
                color: "var(--ll-muted)",
                background: "transparent",
                border: "none",
                padding: 0,
              }}
              title="Sign out"
            >
              Sign out
            </button>
          </div>
        </aside>

        {/* RIGHT — actionable table */}
        <section className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Bulk-action bar */}
          {selectedIds.size > 0 && (
            <div
              className="flex items-center shrink-0"
              style={{
                gap: 16,
                background: "var(--ll-ink)",
                color: "var(--ll-bg)",
                padding: "10px 28px",
                fontSize: 13,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                {selectedIds.size} selected
              </span>
              <div className="flex-1" />
              <button
                className="cursor-pointer ll-bulk"
                onClick={() => {
                  for (const id of selectedIds) onCheckAction(id, "morning-in");
                }}
              >
                ↻ Mark present
              </button>
              <button
                className="cursor-pointer ll-bulk"
                onClick={() => {
                  for (const id of selectedIds) onCheckAction(id, "day-out");
                }}
              >
                ⏏ Check out
              </button>
              <button
                className="cursor-pointer ll-bulk"
                onClick={() => {
                  for (const id of selectedIds) onReset(id);
                  setSelectedIds(new Set());
                }}
              >
                ↺ Reset
              </button>
              <button
                className="cursor-pointer ll-bulk"
                style={{ opacity: 0.7 }}
                onClick={() => setSelectedIds(new Set())}
              >
                ✕ Clear
              </button>
            </div>
          )}

          {viewMode === "table" ? (
            <>
              {/* Table header */}
              <div
                className="grid items-center shrink-0"
                style={{
                  gridTemplateColumns:
                    "32px 44px minmax(0,1.4fr) minmax(0,1fr) 100px 100px 100px 130px",
                  padding: "11px 28px",
                  borderBottom: "1px solid var(--ll-divider)",
                  background: "var(--ll-surface)",
                  ...KICKER,
                  color: "var(--ll-muted)",
                }}
              >
                <button
                  onClick={toggleSelectAll}
                  className="cursor-pointer text-left"
                  style={{
                    fontSize: 13,
                    color: "var(--ll-muted)",
                    lineHeight: 1,
                  }}
                  title="Select all on page"
                  aria-label="Select all"
                >
                  {allVisibleSelected ? "☑" : "☐"}
                </button>
                <div></div>
                <div>Learner ↓</div>
                <div>Program</div>
                <div>Status</div>
                <div>Check-in</div>
                <div>Last scan</div>
                <div className="text-right">Actions</div>
              </div>

              {/* Rows */}
              <div className="flex-1 overflow-y-auto">
                {filtered.length === 0 ? (
                  <div
                    className="text-center"
                    style={{
                      padding: "80px 24px",
                      color: "var(--ll-muted)",
                    }}
                  >
                    <div style={{ ...HEADING, fontSize: 22 }}>No matches.</div>
                    <div style={{ ...KICKER, marginTop: 10 }}>
                      Try clearing your filters
                    </div>
                  </div>
                ) : (
                  filtered.map((s, i) => {
                    const state = getPresenceState(s);
                    const selected = selectedIds.has(s.id);
                    const isCurrent = !!uid && s.NFC_ID === uid;
                    const lunchEvents = s.lunch_events || [];
                    const lastScanTime =
                      lunchEvents.length > 0
                        ? lunchEvents[lunchEvents.length - 1].time
                        : s.time_out || s.time_in;
                    return (
                      <div
                        key={s.id}
                        className="grid items-center ll-row"
                        style={{
                          gridTemplateColumns:
                            "32px 44px minmax(0,1.4fr) minmax(0,1fr) 100px 100px 100px 130px",
                          padding: "10px 28px",
                          borderBottom: "1px solid var(--ll-divider)",
                          fontSize: 14,
                          background: selected
                            ? "color-mix(in srgb, var(--ll-accent) 8%, transparent)"
                            : isCurrent
                              ? "color-mix(in srgb, var(--ll-lime) 28%, transparent)"
                              : i % 2
                                ? "var(--ll-bg)"
                                : "var(--ll-surface)",
                        }}
                      >
                        <button
                          onClick={() => toggleSelect(s.id)}
                          className="cursor-pointer text-left"
                          style={{
                            fontSize: 15,
                            lineHeight: 1,
                            color: selected
                              ? "var(--ll-accent)"
                              : "var(--ll-muted)",
                          }}
                          aria-label={selected ? "Deselect" : "Select"}
                        >
                          {selected ? "☑" : "☐"}
                        </button>
                        <Avatar name={s.name} size={32} />
                        <div className="min-w-0 pr-3">
                          <div
                            className="truncate"
                            style={{ fontWeight: 600, lineHeight: 1.2, fontSize: 14 }}
                            title={s.name}
                          >
                            {s.name}
                          </div>
                          <div
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: 10.5,
                              color: "var(--ll-muted)",
                              letterSpacing: "0.04em",
                              marginTop: 2,
                            }}
                          >
                            {shortCardNum(s.id)}
                          </div>
                        </div>
                        <div
                          className="truncate pr-3"
                          style={{
                            fontSize: 13,
                            color: "var(--ll-muted)",
                          }}
                        >
                          {PROGRAM_LABEL[s.program || ""] || s.program || "—"}
                        </div>
                        <div>
                          <StatusPill state={state} />
                        </div>
                        <div
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 12.5,
                          }}
                        >
                          {editingTimeKey === `${s.id}:time_in` ? (
                            <input
                              type="time"
                              value={timeEditValue}
                              onChange={(e) => setTimeEditValue(e.target.value)}
                              onBlur={async () => {
                                if (timeEditValue)
                                  await onTimeEdit(
                                    s.id,
                                    "time_in",
                                    timeEditValue,
                                  );
                                setEditingTimeKey(null);
                              }}
                              onKeyDown={async (e) => {
                                if (e.key === "Enter" && timeEditValue) {
                                  await onTimeEdit(
                                    s.id,
                                    "time_in",
                                    timeEditValue,
                                  );
                                  setEditingTimeKey(null);
                                }
                                if (e.key === "Escape") setEditingTimeKey(null);
                              }}
                              className="w-20 outline-none"
                              style={{
                                background: "var(--ll-surface)",
                                border: "1.5px solid var(--ll-ink)",
                                padding: "1px 4px",
                                fontFamily: "var(--font-mono)",
                                fontSize: 11,
                              }}
                              autoFocus
                            />
                          ) : (
                            <button
                              className="cursor-pointer ll-time"
                              onClick={() => {
                                setEditingTimeKey(`${s.id}:time_in`);
                                if (s.time_in) {
                                  const d = new Date(s.time_in);
                                  setTimeEditValue(
                                    `${String(d.getHours()).padStart(2, "0")}:${String(
                                      d.getMinutes(),
                                    ).padStart(2, "0")}`,
                                  );
                                } else {
                                  setTimeEditValue("");
                                }
                              }}
                              style={{
                                color: s.time_in
                                  ? "var(--ll-ink)"
                                  : "var(--ll-muted)",
                              }}
                              title="Click to edit"
                            >
                              {formatTimeShort(s.time_in)}
                            </button>
                          )}
                        </div>
                        <div
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 12.5,
                            color: "var(--ll-muted)",
                          }}
                        >
                          {state === "in"
                            ? "—"
                            : formatTimeShort(lastScanTime || null)}
                        </div>
                        <div
                          className="flex justify-end items-center"
                          style={{ gap: 6, color: "var(--ll-muted)" }}
                        >
                          {!s.time_in ? (
                            <button
                              onClick={() => onCheckAction(s.id, "morning-in")}
                              className="cursor-pointer ll-mini"
                              style={{
                                background: "var(--ll-accent)",
                                color: "var(--ll-accent-ink)",
                                border: "1px solid var(--ll-ink-2)",
                              }}
                              title="Check in now"
                            >
                              + In
                            </button>
                          ) : !s.time_out ? (
                            <button
                              onClick={() => onCheckAction(s.id, "day-out")}
                              className="cursor-pointer ll-mini"
                              style={{
                                background: "transparent",
                                color: "var(--ll-ink)",
                                border: "1px solid var(--ll-ink-2)",
                              }}
                              title="Check out"
                            >
                              Out
                            </button>
                          ) : (
                            <span
                              style={{
                                fontFamily: "var(--font-mono)",
                                fontSize: 9.5,
                                color: "var(--ll-muted)",
                                letterSpacing: "0.06em",
                                padding: "3px 7px",
                              }}
                            >
                              done
                            </span>
                          )}
                          <button
                            onClick={() => onReset(s.id)}
                            className="cursor-pointer ll-icon"
                            title="Reset attendance"
                            aria-label="Reset"
                          >
                            ↻
                          </button>
                          <button
                            onClick={() => {
                              setEditingCommentId(s.id);
                              setCommentValue(s.comments || "");
                            }}
                            className="cursor-pointer ll-icon"
                            title={s.comments || "Add comment"}
                            aria-label="Comment"
                            style={{
                              color: s.comments
                                ? "var(--ll-accent)"
                                : "var(--ll-muted)",
                            }}
                          >
                            {s.comments ? "✎" : "+"}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : viewMode === "wall" ? (
            <WallView filtered={filtered} uid={uid} />
          ) : (
            <ScanView
              latest={recentScans[0] || null}
              uid={uid}
              exists={exists}
            />
          )}

          {/* Pagination footer */}
          <div
            className="flex items-center shrink-0"
            style={{
              gap: 16,
              padding: "11px 28px",
              borderTop: "1px solid var(--ll-divider)",
              background: "var(--ll-surface)",
              ...KICKER,
              color: "var(--ll-muted)",
            }}
          >
            <span>
              {filtered.length === 0
                ? "0 of 0"
                : `1–${filtered.length} of ${totalItems || filtered.length}`}
            </span>
            <div className="flex-1" />
            <span className="flex items-center" style={{ gap: 6 }}>
              <span>Rows</span>
              <select
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value));
                  setPage(1);
                }}
                className="cursor-pointer"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--ll-ink)",
                  letterSpacing: "0.06em",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={500}>All</option>
              </select>
            </span>
            <button
              disabled={page <= 1}
              onClick={() => setPage(Math.max(1, page - 1))}
              className="cursor-pointer disabled:opacity-30 ll-link"
              style={{
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.06em",
                padding: "2px 4px",
              }}
            >
              ‹ Prev
            </button>
            {pageWindow.map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className="cursor-pointer ll-link"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  letterSpacing: "0.06em",
                  fontWeight: p === page ? 700 : 400,
                  color: p === page ? "var(--ll-ink)" : "var(--ll-muted)",
                  padding: "3px 8px",
                  borderBottom:
                    p === page
                      ? "1px solid var(--ll-ink)"
                      : "1px solid transparent",
                }}
              >
                {p}
              </button>
            ))}
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              className="cursor-pointer disabled:opacity-30 ll-link"
              style={{
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.06em",
                padding: "2px 4px",
              }}
            >
              Next ›
            </button>
          </div>
        </section>
      </div>

      {/* Comment editor */}
      {editingCommentId && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center"
          style={{ background: "rgba(45,27,78,0.45)" }}
          onClick={() => {
            if (!commentSaving) setEditingCommentId(null);
          }}
        >
          <div
            className="w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--ll-surface)",
              border: "1.5px solid var(--ll-ink)",
            }}
          >
            <Kicker>Comment</Kicker>
            <div
              style={{
                ...HEADING,
                fontSize: 22,
                marginTop: 4,
                marginBottom: 14,
              }}
            >
              {filtered.find((s) => s.id === editingCommentId)?.name ||
                "Learner"}
            </div>
            <textarea
              value={commentValue}
              onChange={(e) => setCommentValue(e.target.value)}
              placeholder="Add a note about this learner today…"
              rows={4}
              autoFocus
              disabled={commentSaving}
              className="w-full outline-none"
              style={{
                background: "var(--ll-bg)",
                border: "1px solid var(--ll-divider)",
                padding: 12,
                fontFamily: "var(--font-body)",
                fontSize: 13,
                color: "var(--ll-ink)",
                resize: "vertical",
              }}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setEditingCommentId(null)}
                disabled={commentSaving}
                className="cursor-pointer"
                style={{
                  ...KICKER,
                  fontSize: 10.5,
                  padding: "8px 16px",
                  border: "1px solid var(--ll-ink-2)",
                  background: "transparent",
                  color: "var(--ll-ink)",
                }}
              >
                Cancel
              </button>
              <button
                disabled={commentSaving}
                onClick={async () => {
                  if (!editingCommentId) return;
                  setCommentSaving(true);
                  try {
                    await onCommentUpdate(
                      editingCommentId,
                      commentValue.trim(),
                    );
                    setEditingCommentId(null);
                    setCommentValue("");
                  } finally {
                    setCommentSaving(false);
                  }
                }}
                className="cursor-pointer"
                style={{
                  ...KICKER,
                  fontSize: 10.5,
                  padding: "8px 16px",
                  border: "1px solid var(--ll-ink)",
                  background: "var(--ll-ink)",
                  color: "var(--ll-bg)",
                }}
              >
                {commentSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Wall view ──────────────────────────────────────────────

function WallView({
  filtered,
  uid,
}: {
  filtered: Student[];
  uid: string;
}) {
  return (
    <div
      className="flex-1 overflow-y-auto"
      style={{ background: "var(--ll-bg)", padding: "16px 20px" }}
    >
      <div
        className="grid"
        style={{
          gap: 6,
          gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))",
        }}
      >
        {filtered.map((s) => {
          const state = getPresenceState(s);
          const isCurrent = !!uid && s.NFC_ID === uid;
          const cfg: Record<
            ScanState,
            { bg: string; fg: string; border: string }
          > = {
            in: {
              bg: "var(--ll-accent)",
              fg: "var(--ll-accent-ink)",
              border: "var(--ll-ink)",
            },
            lunch: {
              bg: "var(--ll-lime)",
              fg: "var(--ll-lime-ink)",
              border: "var(--ll-ink)",
            },
            out: {
              bg: "var(--ll-surface-2)",
              fg: "var(--ll-muted)",
              border: "var(--ll-divider)",
            },
            absent: {
              bg: "transparent",
              fg: "var(--ll-warm)",
              border: "var(--ll-warm)",
            },
          };
          const c = cfg[state];
          return (
            <div
              key={s.id}
              style={{
                background: c.bg,
                color: c.fg,
                border:
                  state === "absent"
                    ? `1.5px dashed ${c.border}`
                    : `1.5px solid ${c.border}`,
                padding: "7px 9px",
                minHeight: 54,
                boxShadow: isCurrent
                  ? `0 0 0 2px var(--ll-bg), 0 0 0 4px var(--ll-accent)`
                  : "none",
              }}
            >
              <div
                className="truncate"
                style={{
                  fontWeight: 700,
                  fontSize: 11,
                  lineHeight: 1.18,
                  letterSpacing: "-0.01em",
                }}
                title={s.name}
              >
                {s.name}
              </div>
              <div
                className="flex justify-between items-end"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  marginTop: 4,
                }}
              >
                <span style={{ opacity: 0.75 }}>
                  {(s.program || "").slice(0, 4).toUpperCase()}
                </span>
                <span style={{ fontWeight: 700 }}>
                  {state === "absent" ? "—" : formatTimeShort(s.time_in)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Scan view ──────────────────────────────────────────────

function ScanView({
  latest,
  uid,
  exists,
}: {
  latest: ActivityEvent | null;
  uid: string;
  exists: boolean;
}) {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center text-center"
      style={{
        background: "var(--ll-bg)",
        gap: 18,
        padding: "40px 32px",
      }}
    >
      {latest ? (
        <>
          <Kicker>
            ✓ {latest.actionType === "morning-in" ? "Checked in" : latest.actionType.replaceAll("-", " ")}
            {" · "}
            {formatTimeAgo(latest.timestamp)}
          </Kicker>
          <Avatar name={latest.learnerName} size={132} />
          <div>
            <div
              style={{
                ...HEADING,
                fontSize: 44,
                lineHeight: 1.05,
                letterSpacing: "-0.025em",
              }}
            >
              {latest.learnerName}
            </div>
            <div
              className="mt-2"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: "var(--ll-muted)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {PROGRAM_LABEL[latest.program] || latest.program || "—"}
            </div>
          </div>
          <StatusPill
            state={
              latest.actionType === "day-out"
                ? "out"
                : latest.actionType === "lunch-out"
                  ? "lunch"
                  : "in"
            }
          />
        </>
      ) : (
        <>
          <Kicker>Waiting for scan</Kicker>
          <div
            style={{
              width: 132,
              height: 132,
              borderRadius: 999,
              border: `2px dashed ${uid && !exists ? "var(--ll-warm)" : "var(--ll-divider)"}`,
              animation: "ll-pulse 2s ease-in-out infinite",
            }}
          />
          <div
            style={{
              ...HEADING,
              fontWeight: 500,
              fontSize: 30,
              color: "var(--ll-muted)",
            }}
          >
            {uid
              ? exists
                ? "Resolving learner…"
                : "Card not registered"
              : "Tap a card to begin"}
          </div>
          {uid && (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--ll-muted)",
                letterSpacing: "0.04em",
              }}
            >
              {uid}
            </div>
          )}
        </>
      )}
    </div>
  );
}
