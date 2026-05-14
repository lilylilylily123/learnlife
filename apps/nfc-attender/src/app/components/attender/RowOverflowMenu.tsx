"use client";
import { useEffect, useRef, useState } from "react";
import type { Student } from "../../types";
import { KICKER } from "../ll-ui";
import { buildScanHistory } from "../AttenderD";

interface MenuItem {
  label: string;
  onPick: () => void;
  destructive?: boolean;
  caption?: string;
}

export function RowOverflowMenu({
  student,
  onEditTimeIn,
  onEditTimeOut,
  onEditNote,
  onEditReason,
  onReset,
}: {
  student: Student;
  onEditTimeIn: () => void;
  onEditTimeOut: () => void;
  onEditNote: () => void;
  onEditReason?: () => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowHistory(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setShowHistory(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items: MenuItem[] = [
    {
      label: "Edit check-in time",
      onPick: onEditTimeIn,
      caption: student.time_in ? formatTime(student.time_in) : "Not set",
    },
    {
      label: "Edit check-out time",
      onPick: onEditTimeOut,
      caption: student.time_out ? formatTime(student.time_out) : "Not set",
    },
    {
      label: student.comments ? "Edit note" : "Add note",
      onPick: onEditNote,
      caption: student.comments ? "Has note" : undefined,
    },
  ];

  if (student.justified && onEditReason) {
    items.push({
      label: student.justification_reason ? "Edit reason" : "Add reason",
      onPick: onEditReason,
      caption: student.justification_reason ? "Has reason" : undefined,
    });
  }

  const scanEvents = buildScanHistory(student);
  if (scanEvents.length > 0) {
    items.push({
      label: showHistory ? "Hide scan history" : "Show scan history",
      onPick: () => setShowHistory((v) => !v),
      caption: `${scanEvents.length} scan${scanEvents.length === 1 ? "" : "s"}`,
    });
  }

  items.push({
    label: "Reset day",
    onPick: () => {
      if (window.confirm(`Reset attendance for ${student.name}?`)) {
        onReset();
        setOpen(false);
      }
    },
    destructive: true,
  });

  return (
    <div className="relative" ref={ref} style={{ display: "inline-flex" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer ll-icon"
        title="More actions"
        aria-label="More actions"
        style={{
          background: "transparent",
          border: "1px solid transparent",
          color: "var(--ll-muted)",
          padding: "4px 8px",
          fontSize: 16,
          lineHeight: 1,
        }}
      >
        ⋯
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
          {items.map((it, i) => (
            <button
              key={i}
              onClick={() => {
                if (!it.destructive) setOpen(false);
                it.onPick();
              }}
              className="cursor-pointer flex items-center justify-between"
              style={{
                gap: 12,
                padding: "7px 10px",
                background: "transparent",
                color: it.destructive ? "var(--ll-warm)" : "var(--ll-ink)",
                border: "none",
                textAlign: "left",
                fontFamily: "var(--font-body)",
                fontSize: 13,
              }}
            >
              <span>{it.label}</span>
              {it.caption && (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--ll-muted)",
                    letterSpacing: "0.04em",
                  }}
                >
                  {it.caption}
                </span>
              )}
            </button>
          ))}
          {showHistory && scanEvents.length > 0 && (
            <div
              style={{
                marginTop: 4,
                paddingTop: 6,
                borderTop: "1px solid var(--ll-divider)",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <div
                style={{
                  ...KICKER,
                  fontSize: 9.5,
                  padding: "2px 10px 4px",
                }}
              >
                Scan history · {scanEvents.length}
              </div>
              {scanEvents.map((e, i) => (
                <div
                  key={i}
                  className="flex items-center"
                  style={{
                    gap: 8,
                    padding: "4px 10px",
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
                    {formatTime(e.iso)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatTime(val: string | null | undefined): string {
  if (!val) return "—";
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return val;
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
