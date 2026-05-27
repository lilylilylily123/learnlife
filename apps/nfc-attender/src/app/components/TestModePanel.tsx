"use client";
import React, { useState } from "react";
import { RecordModel } from "pocketbase";
import { KICKER, Kicker, Pill, InkInput, InkSelect } from "./ll-ui";

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
  // Demo overlay state. When `demoActive` is true the dashboard is showing
  // a synthesized attendance map (no PB writes). The Load/Clear buttons are
  // wired from the parent so the overlay lifecycle stays there.
  demoActive?: boolean;
  onLoadDemo?: () => void;
  onClearDemo?: () => void;
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
  demoActive,
  onLoadDemo,
  onClearDemo,
}: TestModePanelProps) {
  const setTestTimePreset = (hour: number, minute = 0) => {
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    setTestTime(d);
  };

  // Collapsed panel still leaves Test Mode (and any demo overlay) running —
  // it just hides the controls so the dashboard isn't blocked while demoing.
  // A small pill stays pinned so the panel can be re-opened.
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="flex justify-end" style={{ pointerEvents: "auto" }}>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="cursor-pointer flex items-center"
          aria-label="Show test mode panel"
          style={{
            gap: 8,
            padding: "6px 12px",
            background: "var(--ll-warm)",
            color: "var(--ll-warm-ink)",
            border: "1.5px solid var(--ll-warm)",
            boxShadow: "0 4px 12px -6px rgba(31, 27, 22, 0.4)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "var(--ll-warm-ink)",
              animation: "ll-pulse 1.5s ease-in-out infinite",
            }}
          />
          Test mode{demoActive ? " · demo" : ""}
          <span aria-hidden style={{ marginLeft: 4 }}>↑</span>
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--ll-surface)",
        border: "1.5px solid var(--ll-warm)",
        boxShadow: "0 4px 18px -8px rgba(31, 27, 22, 0.4)",
        color: "var(--ll-ink)",
      }}
    >
      {/* Header strip */}
      <div
        className="flex items-center"
        style={{
          gap: 10,
          padding: "8px 14px",
          background: "var(--ll-warm)",
          color: "var(--ll-warm-ink)",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: 999,
            background: "var(--ll-warm-ink)",
            animation: "ll-pulse 1.5s ease-in-out infinite",
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Test mode
        </span>
        <span className="flex-1" />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            letterSpacing: "0.04em",
            opacity: 0.85,
          }}
        >
          Active · {viewDate}
          {testTime &&
            ` @ ${testTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="cursor-pointer"
          aria-label="Hide test mode panel"
          title="Hide panel (test mode stays on)"
          style={{
            marginLeft: 10,
            background: "transparent",
            border: "none",
            color: "var(--ll-warm-ink)",
            opacity: 0.85,
            fontSize: 14,
            lineHeight: 1,
            padding: "2px 6px",
          }}
        >
          ↓
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: "12px 14px 14px" }}>
        {/* Date / time controls */}
        <div className="flex flex-wrap items-center" style={{ gap: 12 }}>
          <div className="flex items-center" style={{ gap: 8 }}>
            <Kicker>Date</Kicker>
            <InkInput
              type="date"
              value={testDate || new Date().toISOString().split("T")[0]}
              onChange={(e) => setTestDate(e.target.value || null)}
              style={{ minWidth: 150 }}
            />
          </div>
          <div className="flex items-center" style={{ gap: 8 }}>
            <Kicker>Time</Kicker>
            <InkSelect
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
            >
              <option value="">Real time</option>
              {TEST_TIME_PRESETS.map((p) => (
                <option key={p.label} value={`${p.hour}:${p.minute}`}>
                  {p.label}
                </option>
              ))}
            </InkSelect>
          </div>
        </div>

        {/* Simulated scan row */}
        <div
          className="flex flex-wrap items-center"
          style={{
            gap: 8,
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px dashed var(--ll-divider)",
          }}
        >
          <Kicker>Simulate</Kicker>
          <InkSelect id="sim-learner" defaultValue="" style={{ flex: 1, minWidth: 200 }}>
            <option value="" disabled>
              Pick a learner…
            </option>
            {students
              .filter((s) => s.NFC_ID)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((s) => (
                <option key={s.id} value={s.NFC_ID}>
                  {s.name}
                </option>
              ))}
          </InkSelect>
          <Pill
            size="sm"
            variant={isLoading ? "outline" : "ink"}
            onClick={() => {
              if (isLoading) return;
              const select = document.getElementById(
                "sim-learner",
              ) as HTMLSelectElement | null;
              if (select?.value) simulateScan(select.value);
            }}
          >
            {isLoading ? "Scanning…" : "Scan ↵"}
          </Pill>
        </div>

        {(onLoadDemo || onClearDemo) && (
          <div
            className="flex flex-wrap items-center"
            style={{
              gap: 8,
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px dashed var(--ll-divider)",
            }}
          >
            <Kicker>Demo</Kicker>
            {demoActive ? (
              <>
                <span
                  style={{
                    ...KICKER,
                    color: "var(--ll-warm)",
                    border: `1px solid var(--ll-warm)`,
                    padding: "3px 8px",
                  }}
                >
                  Overlay active · no PB writes
                </span>
                <Pill size="sm" variant="outline" onClick={onClearDemo}>
                  Clear demo
                </Pill>
              </>
            ) : (
              <Pill size="sm" variant="ink" onClick={onLoadDemo}>
                Load demo data
              </Pill>
            )}
            <span
              style={{
                ...KICKER,
                color: "var(--ll-muted)",
                marginLeft: 4,
              }}
            >
              {demoActive
                ? "Reset, status, and check-ins stay local."
                : "Loads a mid-day snapshot for stage demos."}
            </span>
          </div>
        )}

        <p
          style={{
            ...KICKER,
            color: "var(--ll-muted)",
            marginTop: 12,
            lineHeight: 1.5,
          }}
        >
          Records are saved to the selected date — use a real date if you want
          the entry visible in history.
        </p>
      </div>
    </div>
  );
}
