"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertTriangle, Info } from "lucide-react";

// Lightweight toast system. A module-level store keeps the queue, components
// emit via the `toast.*` singleton, and a single <ToastContainer/> subscribes.
// No context wiring — every component can fire toasts without prop-drilling.

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  // Optional caption rendered on a second line, smaller. Use for context like
  // a learner name or count, leaving the headline concise.
  detail?: string;
  // ms before auto-dismiss. 0 = sticky (user must close).
  duration: number;
}

type Listener = (toasts: Toast[]) => void;

const listeners = new Set<Listener>();
let toasts: Toast[] = [];
let nextId = 1;

function emit() {
  for (const l of listeners) l(toasts);
}

function push(t: Omit<Toast, "id">): number {
  const id = nextId++;
  toasts = [...toasts, { ...t, id }];
  emit();
  if (t.duration > 0) {
    setTimeout(() => dismiss(id), t.duration);
  }
  return id;
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

interface ToastOpts {
  detail?: string;
  duration?: number;
}

export const toast = {
  success(message: string, opts: ToastOpts = {}) {
    return push({
      kind: "success",
      message,
      detail: opts.detail,
      duration: opts.duration ?? 2800,
    });
  },
  error(message: string, opts: ToastOpts = {}) {
    return push({
      kind: "error",
      message,
      detail: opts.detail,
      duration: opts.duration ?? 5000,
    });
  },
  info(message: string, opts: ToastOpts = {}) {
    return push({
      kind: "info",
      message,
      detail: opts.detail,
      duration: opts.duration ?? 2800,
    });
  },
  dismiss,
};

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The initial server snapshot is always empty — toasts only exist in response
// to user actions in the browser, so there's nothing meaningful to render
// during prerender of the static export.
const emptySnapshot: Toast[] = [];
function getSnapshot(): Toast[] {
  return toasts;
}
function getServerSnapshot(): Toast[] {
  return emptySnapshot;
}

export function ToastContainer() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      aria-live="polite"
      aria-atomic="false"
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 360,
        pointerEvents: "none",
      }}
    >
      {items.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>,
    document.body,
  );
}

function ToastCard({ toast: t }: { toast: Toast }) {
  const tone = TONES[t.kind];
  const Icon = tone.Icon;
  return (
    <div
      role={t.kind === "error" ? "alert" : "status"}
      className="ll-toast-enter"
      style={{
        pointerEvents: "auto",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px 10px 12px",
        background: tone.bg,
        color: tone.fg,
        border: `1.5px solid ${tone.border}`,
        boxShadow: "0 6px 18px -8px rgba(31,27,22,0.35)",
        minWidth: 240,
        fontSize: 13,
        lineHeight: 1.35,
      }}
    >
      <Icon size={16} style={{ marginTop: 1, flexShrink: 0 }} aria-hidden />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{t.message}</div>
        {t.detail && (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              opacity: 0.75,
              marginTop: 2,
              letterSpacing: "0.02em",
              wordBreak: "break-word",
            }}
          >
            {t.detail}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(t.id)}
        aria-label="Dismiss notification"
        className="cursor-pointer"
        style={{
          flexShrink: 0,
          background: "transparent",
          border: "none",
          color: tone.fg,
          opacity: 0.6,
          fontSize: 14,
          lineHeight: 1,
          padding: "2px 4px",
        }}
      >
        ×
      </button>
    </div>
  );
}

const TONES: Record<ToastKind, { bg: string; fg: string; border: string; Icon: typeof CheckCircle2 }> = {
  success: {
    bg: "var(--ll-surface)",
    fg: "var(--ll-ink)",
    border: "var(--ll-accent)",
    Icon: CheckCircle2,
  },
  error: {
    bg: "var(--ll-warm)",
    fg: "var(--ll-warm-ink)",
    border: "var(--ll-ink)",
    Icon: AlertTriangle,
  },
  info: {
    bg: "var(--ll-surface)",
    fg: "var(--ll-ink)",
    border: "var(--ll-divider)",
    Icon: Info,
  },
};
