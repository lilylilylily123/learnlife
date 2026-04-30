"use client";
import React from "react";

// Shared LearnLife design atoms · Paper palette + Editorial typography
// All AttenderD / history pages should import from here.

export const HEADING: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontWeight: 600,
  letterSpacing: "-0.02em",
  fontFeatureSettings: "'ss01', 'ss02'",
};

export const KICKER: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10.5,
  letterSpacing: "0.08em",
  fontWeight: 700,
  textTransform: "uppercase",
  color: "var(--ll-muted)",
};

export const MONO: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  letterSpacing: "0.04em",
};

export type ScanState = "in" | "lunch" | "out" | "absent";

export function Kicker({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return <div style={{ ...KICKER, ...style }}>{children}</div>;
}

export function Heading({
  children,
  size = 22,
  style,
}: {
  children: React.ReactNode;
  size?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ ...HEADING, fontSize: size, lineHeight: 1.15, ...style }}>
      {children}
    </div>
  );
}

export function Pill({
  active,
  variant = "outline",
  size = "xs",
  onClick,
  children,
  title,
  type = "button",
}: {
  active?: boolean;
  variant?: "outline" | "ink" | "accent";
  size?: "xs" | "sm";
  onClick?: () => void;
  children: React.ReactNode;
  title?: string;
  type?: "button" | "submit";
}) {
  const isInk = active || variant === "ink";
  const isAccent = !isInk && variant === "accent";
  const fontSize = size === "sm" ? 12.5 : 11;
  const padY = size === "sm" ? 7 : 5;
  const padX = size === "sm" ? 14 : 11;
  const bg = isInk
    ? "var(--ll-ink)"
    : isAccent
      ? "var(--ll-accent)"
      : "transparent";
  const fg = isInk
    ? "var(--ll-bg)"
    : isAccent
      ? "var(--ll-accent-ink)"
      : "var(--ll-ink)";
  const bd = isInk
    ? "var(--ll-ink)"
    : isAccent
      ? "var(--ll-accent)"
      : "var(--ll-ink-2)";
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      className="inline-flex items-center cursor-pointer transition-[background,color,border-color] uppercase ll-pill"
      style={{
        background: bg,
        color: fg,
        border: `1px solid ${bd}`,
        padding: `${padY}px ${padX}px`,
        fontFamily: "var(--font-mono)",
        fontSize,
        letterSpacing: "0.06em",
        fontWeight: 700,
        whiteSpace: "nowrap",
        lineHeight: 1.15,
      }}
    >
      {children}
    </button>
  );
}

export function StatusPill({ state }: { state: ScanState }) {
  const cfg: Record<
    ScanState,
    { bg: string; fg: string; bd?: string; label: string }
  > = {
    in: {
      bg: "var(--ll-accent)",
      fg: "var(--ll-accent-ink)",
      label: "IN",
    },
    lunch: { bg: "var(--ll-lime)", fg: "var(--ll-lime-ink)", label: "LUNCH" },
    out: {
      bg: "transparent",
      fg: "var(--ll-muted)",
      bd: "var(--ll-divider)",
      label: "OUT",
    },
    absent: {
      bg: "var(--ll-warm)",
      fg: "var(--ll-warm-ink)",
      label: "ABSENT",
    },
  };
  const c = cfg[state];
  return (
    <span
      className="inline-flex items-center"
      style={{
        background: c.bg,
        color: c.fg,
        border: c.bd ? `1px solid ${c.bd}` : "none",
        padding: "3px 9px",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        fontFamily: "var(--font-mono)",
      }}
    >
      {c.label}
    </span>
  );
}

// Variant-style status badge for the history page (present / late / absent / jLate / jAbsent)
export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status)
    return (
      <span style={{ ...MONO, color: "var(--ll-muted)" }}>—</span>
    );
  const cfg: Record<string, { bg: string; fg: string; bd?: string; label: string }> = {
    present: {
      bg: "var(--ll-accent)",
      fg: "var(--ll-accent-ink)",
      label: "PRESENT",
    },
    late: {
      bg: "var(--ll-lime)",
      fg: "var(--ll-lime-ink)",
      label: "LATE",
    },
    absent: {
      bg: "var(--ll-warm)",
      fg: "var(--ll-warm-ink)",
      label: "ABSENT",
    },
    jLate: {
      bg: "transparent",
      fg: "var(--ll-ink-2)",
      bd: "var(--ll-ink-2)",
      label: "J·LATE",
    },
    jAbsent: {
      bg: "transparent",
      fg: "var(--ll-ink-2)",
      bd: "var(--ll-ink-2)",
      label: "J·ABSENT",
    },
  };
  const c = cfg[status] || {
    bg: "var(--ll-surface-2)",
    fg: "var(--ll-ink)",
    label: status.toUpperCase(),
  };
  return (
    <span
      className="inline-flex items-center"
      style={{
        background: c.bg,
        color: c.fg,
        border: c.bd ? `1px solid ${c.bd}` : "none",
        padding: "3px 9px",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        fontFamily: "var(--font-mono)",
      }}
    >
      {c.label}
    </span>
  );
}

export function Avatar({
  name,
  size = 32,
}: {
  name: string;
  size?: number;
}) {
  const initial = (name || "?").trim()[0]?.toUpperCase() || "?";
  return (
    <div
      className="flex items-center justify-center shrink-0 select-none"
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: "var(--ll-bg)",
        border: "1px solid var(--ll-ink-2)",
        color: "var(--ll-ink)",
        fontFamily: "var(--font-heading)",
        fontWeight: 500,
        fontSize: Math.round(size * 0.46),
        lineHeight: 1,
        letterSpacing: "-0.02em",
      }}
    >
      {initial}
    </div>
  );
}

export function BigStat({
  n,
  label,
  sub,
  tone,
  size = 40,
}: {
  n: string | number;
  label: string;
  sub?: React.ReactNode;
  tone?: "accent" | "warm" | "lime";
  size?: number;
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
    <div className="text-center select-none">
      <div
        style={{
          ...HEADING,
          fontSize: size,
          lineHeight: 1,
          color,
        }}
      >
        {n}
      </div>
      <div style={{ ...KICKER, marginTop: 5 }}>{label}</div>
      {sub !== undefined && sub !== null && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--ll-muted)",
            letterSpacing: "0.04em",
            marginTop: 2,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

export function LMark({ size = 30 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        background: "var(--ll-accent)",
        color: "var(--ll-accent-ink)",
        borderRadius: 6,
        fontFamily: "var(--font-heading)",
        fontWeight: 700,
        fontSize: Math.round(size * 0.55),
        letterSpacing: "-0.02em",
        lineHeight: 1,
      }}
    >
      L
    </div>
  );
}

// Inputs that match the design language
export function InkInput(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  const { style, className, ...rest } = props;
  return (
    <input
      {...rest}
      className={`outline-none ${className || ""}`}
      style={{
        background: "var(--ll-surface)",
        border: "1.5px solid var(--ll-ink)",
        color: "var(--ll-ink)",
        padding: "7px 12px",
        fontFamily: "var(--font-body)",
        fontSize: 14,
        ...style,
      }}
    />
  );
}

export function InkSelect(
  props: React.SelectHTMLAttributes<HTMLSelectElement>,
) {
  const { style, className, children, ...rest } = props;
  return (
    <select
      {...rest}
      className={`outline-none cursor-pointer ${className || ""}`}
      style={{
        background: "var(--ll-surface)",
        border: "1.5px solid var(--ll-ink)",
        color: "var(--ll-ink)",
        padding: "7px 12px",
        fontFamily: "var(--font-body)",
        fontSize: 14,
        ...style,
      }}
    >
      {children}
    </select>
  );
}
