"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import type { Student, AttendanceFilterKey, AttendanceCounts } from "../types";
import type { ActivityEvent } from "./ActivityFeed";
import {
  HEADING,
  KICKER,
  Pill,
  Kicker,
  StatusPill,
  StatusBadge,
  Avatar,
  BigStat,
  LMark,
  type ScanState,
} from "./ll-ui";
import { LearnerRowsSkeleton, LearnerWallSkeleton } from "./LoadingSkeleton";

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

  // Initial-fetch flag: true on first data load, swaps the rows for skeletons.
  // Stays false after the first successful fetch so subsequent refreshes don't
  // flash the placeholders.
  isInitialLoading?: boolean;
  // Surfaced when learner/attendance fetches fail; if set, the dashboard shows
  // a retry banner. `onRetryFetch` is required when this is non-null.
  fetchError?: string | null;
  onRetryFetch?: () => void;

  activityEvents: ActivityEvent[];

  onShowActivityFeed: () => void;
  onShowAddLearner: () => void;
  onShowHistory: () => void;
  onLogout: () => void;
  onToggleTestMode: () => void;

  onCheckAction: (id: string, action: string) => void;
  onStatusChange: (
    id: string,
    status: string,
    field?: "status" | "lunch_status",
    toggle?: boolean,
  ) => void;
  onCommentUpdate: (id: string, comment: string) => Promise<void>;
  onTimeEdit: (
    id: string,
    field: "time_in" | "time_out",
    timeStr: string,
  ) => Promise<void>;
  onReset: (id: string) => void;
  // Opens the justification reason modal for a learner. Only rendered next
  // to status when the day is currently marked justified.
  onOpenJustification?: (id: string) => void;
}

const STATUS_OPTIONS: ReadonlyArray<{
  key: string;
  label: string;
  title: string;
  bg: string;
  fg: string;
  bd?: string;
}> = [
  {
    key: "present",
    label: "P",
    title: "Present",
    bg: "var(--ll-accent)",
    fg: "var(--ll-accent-ink)",
  },
  {
    key: "late",
    label: "L",
    title: "Late",
    bg: "var(--ll-lime)",
    fg: "var(--ll-lime-ink)",
  },
  {
    key: "absent",
    label: "A",
    title: "Absent",
    bg: "var(--ll-warm)",
    fg: "var(--ll-warm-ink)",
  },
  {
    key: "jLate",
    label: "JL",
    title: "Justified late",
    bg: "transparent",
    fg: "var(--ll-ink-2)",
    bd: "var(--ll-ink-2)",
  },
  {
    key: "jAbsent",
    label: "JA",
    title: "Justified absent",
    bg: "transparent",
    fg: "var(--ll-ink-2)",
    bd: "var(--ll-ink-2)",
  },
];

export function StatusEditor({
  value,
  lunchValue,
  justified,
  hasReason,
  onChange,
  onLunchChange,
  onOpenReason,
}: {
  value: string | undefined;
  lunchValue?: string;
  // When true, render the 📝 reason icon next to the status badge.
  justified?: boolean;
  // Whether a justification_reason has already been recorded — used to tint
  // the icon (filled blue = note present, neutral gray = empty).
  hasReason?: boolean;
  onChange: (v: string) => void;
  onLunchChange?: (v: string) => void;
  onOpenReason?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div
      className="relative"
      ref={ref}
      style={{
        justifySelf: "start",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="cursor-pointer flex flex-col items-start"
        title="Set status"
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          gap: 3,
        }}
      >
        {value ? (
          <StatusBadge status={value} />
        ) : (
          <span
            style={{
              ...KICKER,
              padding: "3px 9px",
              border: "1px dashed var(--ll-divider)",
              color: "var(--ll-muted)",
              display: "inline-block",
            }}
          >
            Set
          </span>
        )}
        {lunchValue && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              letterSpacing: "0.06em",
              fontWeight: 700,
              color: "var(--ll-muted)",
              textTransform: "uppercase",
            }}
          >
            ↳ lunch · {lunchLabel(lunchValue)}
          </span>
        )}
      </button>
      {justified && onOpenReason && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenReason();
          }}
          title={hasReason ? "Edit justification reason" : "Add justification reason"}
          className="cursor-pointer"
          style={{
            width: 22,
            height: 22,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            background: hasReason
              ? "color-mix(in srgb, var(--ll-accent) 18%, transparent)"
              : "transparent",
            color: hasReason ? "var(--ll-ink)" : "var(--ll-muted)",
            border: `1px ${hasReason ? "solid" : "dashed"} var(--ll-divider)`,
            padding: 0,
            lineHeight: 1,
          }}
        >
          📝
        </button>
      )}
      {open && (
        <div
          className="absolute z-30"
          style={{
            top: "calc(100% + 4px)",
            left: 0,
            background: "var(--ll-surface)",
            border: "1.5px solid var(--ll-ink)",
            padding: 6,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            minWidth: 168,
            boxShadow: "0 6px 14px rgba(31,27,22,0.12)",
          }}
        >
          <div
            style={{
              ...KICKER,
              fontSize: 9.5,
              padding: "2px 4px 4px",
              borderBottom: "1px solid var(--ll-divider)",
              marginBottom: 2,
            }}
          >
            Morning
          </div>
          {STATUS_OPTIONS.map((opt) => (
            <StatusMenuItem
              key={`m-${opt.key}`}
              option={opt}
              active={value === opt.key}
              onPick={() => {
                onChange(opt.key);
                setOpen(false);
              }}
            />
          ))}
          {value && (
            <button
              onClick={() => {
                onChange(value);
                setOpen(false);
              }}
              className="cursor-pointer"
              style={{
                padding: "4px 8px",
                background: "transparent",
                color: "var(--ll-muted)",
                border: "1px dashed var(--ll-divider)",
                fontSize: 10.5,
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                textAlign: "left",
              }}
              title="Click again to clear (toggle)"
            >
              Clear morning
            </button>
          )}
          {onLunchChange && (
            <>
              <div
                style={{
                  ...KICKER,
                  fontSize: 9.5,
                  padding: "8px 4px 4px",
                  borderTop: "1px solid var(--ll-divider)",
                  marginTop: 4,
                }}
              >
                Lunch
              </div>
              {STATUS_OPTIONS.map((opt) => (
                <StatusMenuItem
                  key={`l-${opt.key}`}
                  option={opt}
                  active={lunchValue === opt.key}
                  onPick={() => {
                    onLunchChange(opt.key);
                    setOpen(false);
                  }}
                />
              ))}
              {lunchValue && (
                <button
                  onClick={() => {
                    onLunchChange(lunchValue);
                    setOpen(false);
                  }}
                  className="cursor-pointer"
                  style={{
                    padding: "4px 8px",
                    background: "transparent",
                    color: "var(--ll-muted)",
                    border: "1px dashed var(--ll-divider)",
                    fontSize: 10.5,
                    fontFamily: "var(--font-mono)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    textAlign: "left",
                  }}
                  title="Click again to clear (toggle)"
                >
                  Clear lunch
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface ScanEvent {
  iso: string;
  label: string;
  arrow: string;
  tone: "in" | "out" | "lunch-out" | "lunch-in";
}

export function buildScanHistory(s: Student): ScanEvent[] {
  const events: ScanEvent[] = [];
  if (s.time_in) {
    events.push({ iso: s.time_in, label: "Check-in", arrow: "→", tone: "in" });
  }
  for (const e of s.lunch_events || []) {
    events.push({
      iso: e.time,
      label: e.type === "out" ? "Lunch out" : "Lunch in",
      arrow: e.type === "out" ? "↗" : "↘",
      tone: e.type === "out" ? "lunch-out" : "lunch-in",
    });
  }
  if (s.time_out) {
    events.push({
      iso: s.time_out,
      label: "Check-out",
      arrow: "←",
      tone: "out",
    });
  }
  events.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
  return events;
}

export function ScanHistoryCell({ student }: { student: Student }) {
  const events = useMemo(() => buildScanHistory(student), [student]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const lunchCount = events.filter(
    (e) => e.tone === "lunch-out" || e.tone === "lunch-in",
  ).length;
  const last = events.length > 0 ? events[events.length - 1] : null;
  const fmt = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  if (events.length === 0) {
    return (
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12.5,
          color: "var(--ll-muted)",
        }}
      >
        —
      </div>
    );
  }

  return (
    <div
      className="relative"
      ref={ref}
      style={{ justifySelf: "start", display: "inline-block" }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="cursor-pointer flex flex-col items-start ll-time"
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          gap: 1,
        }}
        title={`${events.length} scan${events.length === 1 ? "" : "s"} — click for history`}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
            color: "var(--ll-ink)",
          }}
        >
          {last ? `${last.arrow} ${fmt(last.iso)}` : "—"}
        </span>
        {lunchCount > 0 && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              letterSpacing: "0.06em",
              fontWeight: 700,
              color: "var(--ll-muted)",
              textTransform: "uppercase",
            }}
          >
            🍴 lunch · {lunchCount}×
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute z-30"
          style={{
            top: "calc(100% + 4px)",
            right: 0,
            background: "var(--ll-surface)",
            border: "1.5px solid var(--ll-ink)",
            padding: 6,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            minWidth: 220,
            boxShadow: "0 6px 14px rgba(31,27,22,0.12)",
          }}
        >
          <div
            style={{
              ...KICKER,
              fontSize: 9.5,
              padding: "2px 6px 4px",
              borderBottom: "1px solid var(--ll-divider)",
              marginBottom: 2,
            }}
          >
            Scan history · {events.length}
          </div>
          {events.map((e, i) => (
            <div
              key={i}
              className="flex items-center"
              style={{
                gap: 8,
                padding: "4px 6px",
                background:
                  i === events.length - 1
                    ? "color-mix(in srgb, var(--ll-accent) 10%, transparent)"
                    : "transparent",
              }}
            >
              <span
                aria-hidden
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  width: 18,
                  textAlign: "center",
                  color:
                    e.tone === "in"
                      ? "var(--ll-accent)"
                      : e.tone === "out"
                        ? "var(--ll-ink)"
                        : "var(--ll-ink-2)",
                }}
              >
                {e.arrow}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  flex: 1,
                  color: "var(--ll-ink)",
                }}
              >
                {e.label}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11.5,
                  letterSpacing: "0.04em",
                  color: "var(--ll-muted)",
                }}
              >
                {fmt(e.iso)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function lunchLabel(s: string): string {
  switch (s) {
    case "present":
      return "on time";
    case "late":
      return "late";
    case "absent":
      return "skipped";
    case "jLate":
      return "j·late";
    case "jAbsent":
      return "j·skipped";
    default:
      return s;
  }
}

function StatusMenuItem({
  option,
  active,
  onPick,
}: {
  option: (typeof STATUS_OPTIONS)[number];
  active: boolean;
  onPick: () => void;
}) {
  const { label, title, bg, fg, bd } = option;
  return (
    <button
      onClick={onPick}
      className="cursor-pointer flex items-center"
      style={{
        gap: 8,
        padding: "5px 8px",
        background: active ? bg : "transparent",
        color: active ? fg : "var(--ll-ink)",
        border: `1px solid ${active ? bd ?? bg : "transparent"}`,
        textAlign: "left",
        fontSize: 12,
        fontFamily: "var(--font-body)",
      }}
    >
      <span
        className="inline-flex items-center justify-center"
        style={{
          width: 22,
          height: 18,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.04em",
          background: active ? "transparent" : bg,
          color: fg,
          border: bd ? `1px solid ${bd}` : "none",
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1 }}>{title}</span>
    </button>
  );
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

interface WallTone {
  bg: string;
  fg: string;
  border: string;
  dashed?: boolean;
  flag?: string; // small UPPERCASE marker (e.g. "LATE", "J·A")
  title?: string;
}

// WallView tone factors in the manual `status` field on top of presence —
// otherwise a learner marked Late visually looks identical to one marked
// Present, and Justified Absent looks identical to a no-show.
function getWallTone(s: Student): WallTone {
  const events = s.lunch_events || [];
  const atLunch =
    events.length > 0 && events[events.length - 1].type === "out";

  if (s.time_out) {
    return {
      bg: "var(--ll-surface-2)",
      fg: "var(--ll-muted)",
      border: "var(--ll-divider)",
      title: "Checked out",
    };
  }
  if (s.time_in) {
    if (atLunch) {
      return {
        bg: "var(--ll-lime)",
        fg: "var(--ll-lime-ink)",
        border: "var(--ll-ink)",
        flag: "LUNCH",
        title: "At lunch",
      };
    }
    if (s.status === "late") {
      return {
        bg: "var(--ll-lime)",
        fg: "var(--ll-lime-ink)",
        border: "var(--ll-ink)",
        flag: "LATE",
        title: "Late",
      };
    }
    if (s.status === "jLate") {
      return {
        bg: "transparent",
        fg: "var(--ll-ink-2)",
        border: "var(--ll-ink-2)",
        flag: "J·L",
        title: "Justified late",
      };
    }
    return {
      bg: "var(--ll-accent)",
      fg: "var(--ll-accent-ink)",
      border: "var(--ll-ink)",
      title: "Present",
    };
  }
  // No check-in
  if (s.status === "jAbsent") {
    return {
      bg: "transparent",
      fg: "var(--ll-ink-2)",
      border: "var(--ll-ink-2)",
      flag: "J·A",
      title: "Justified absent",
    };
  }
  return {
    bg: "transparent",
    fg: "var(--ll-warm)",
    border: "var(--ll-warm)",
    dashed: true,
    title: s.status === "absent" ? "Marked absent" : "No check-in",
  };
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
    onStatusChange,
    onCommentUpdate,
    onTimeEdit,
    onReset,
    onOpenJustification,
    isInitialLoading,
    fetchError,
    onRetryFetch,
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
      {fetchError && onRetryFetch && (
        <FetchErrorBanner message={fetchError} onRetry={onRetryFetch} />
      )}
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
                  for (const id of selectedIds)
                    onStatusChange(id, "absent", "status", false);
                }}
                title="Mark all selected as Absent"
              >
                ⊘ Mark absent
              </button>
              <button
                className="cursor-pointer ll-bulk"
                onClick={() => {
                  for (const id of selectedIds)
                    onStatusChange(id, "jAbsent", "status", false);
                }}
                title="Mark all selected as Justified absent"
              >
                ⊘ J·Absent
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
                    "32px 44px minmax(0,1.4fr) minmax(0,1fr) 120px 100px 100px 130px",
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
                {isInitialLoading ? (
                  <LearnerRowsSkeleton />
                ) : filtered.length === 0 ? (
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
                        <StatusEditor
                          value={s.status}
                          lunchValue={s.lunch_status}
                          justified={Boolean(s.justified)}
                          hasReason={Boolean(s.justification_reason)}
                          onChange={(v) => onStatusChange(s.id, v, "status")}
                          onLunchChange={(v) =>
                            onStatusChange(s.id, v, "lunch_status")
                          }
                          onOpenReason={
                            onOpenJustification
                              ? () => onOpenJustification(s.id)
                              : undefined
                          }
                        />
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
                        <ScanHistoryCell student={s} />
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
            <WallView filtered={filtered} uid={uid} isInitialLoading={isInitialLoading} />
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

// ─── Fetch error banner ─────────────────────────────────────
// Pinned to the top of the dashboard when initial fetch fails. Stays visible
// until a successful retry clears `fetchError` upstream.
function FetchErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 shrink-0"
      style={{
        padding: "10px 28px",
        background: "var(--ll-warm)",
        color: "var(--ll-warm-ink)",
        borderBottom: "1.5px solid var(--ll-ink)",
        fontSize: 13,
      }}
    >
      <AlertTriangle size={16} />
      <span style={{ flex: 1, fontWeight: 600 }}>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 cursor-pointer"
        style={{
          background: "var(--ll-ink)",
          color: "var(--ll-bg)",
          padding: "6px 12px",
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        <RotateCw size={13} />
        Retry
      </button>
    </div>
  );
}

// ─── Wall view ──────────────────────────────────────────────

function WallView({
  filtered,
  uid,
  isInitialLoading,
}: {
  filtered: Student[];
  uid: string;
  isInitialLoading?: boolean;
}) {
  if (isInitialLoading) {
    return (
      <div
        style={{
          padding: "16px 28px",
        }}
      >
        <LearnerWallSkeleton />
      </div>
    );
  }
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
          const tone = getWallTone(s);
          const isCurrent = !!uid && s.NFC_ID === uid;
          return (
            <div
              key={s.id}
              style={{
                background: tone.bg,
                color: tone.fg,
                border: tone.dashed
                  ? `1.5px dashed ${tone.border}`
                  : `1.5px solid ${tone.border}`,
                padding: "7px 9px",
                minHeight: 54,
                boxShadow: isCurrent
                  ? `0 0 0 2px var(--ll-bg), 0 0 0 4px var(--ll-accent)`
                  : "none",
              }}
              title={tone.title}
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
                  {tone.flag ||
                    (s.program || "").slice(0, 4).toUpperCase()}
                </span>
                <span style={{ fontWeight: 700 }}>
                  {s.time_in ? formatTimeShort(s.time_in) : "—"}
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
