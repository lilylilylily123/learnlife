"use client";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { KICKER } from "./ll-ui";

interface ConfirmModalProps {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Replacement for window.confirm. Tauri 2's WKWebView doesn't render
// JavaScript-native confirm() dialogs, so any code path gated on them silently
// no-op'd. A portaled React modal works in both the Tauri webview and a plain
// browser during pnpm dev.
export function ConfirmModal({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    // Escape closes the dialog. Enter is intentionally NOT bound globally —
    // the Cancel button autoFocuses (safer default for destructive prompts),
    // and the browser already routes Enter to whichever button has focus.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onCancel]);

  // The portal target only exists in the browser; static prerender skips the
  // dialog entirely so the SSR shell stays free of dialog markup.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: "rgba(31,27,22,0.45)", padding: 16 }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        style={{
          background: "var(--ll-surface)",
          border: "1.5px solid var(--ll-ink)",
          padding: "20px 22px",
          maxWidth: 420,
          width: "100%",
          boxShadow: "0 12px 28px rgba(31,27,22,0.22)",
        }}
      >
        <div
          id="confirm-modal-title"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 18,
            lineHeight: 1.25,
            color: "var(--ll-ink)",
            fontWeight: 700,
          }}
        >
          {title}
        </div>
        {body && (
          <div
            style={{
              marginTop: 10,
              fontSize: 13,
              lineHeight: 1.45,
              color: "var(--ll-ink-2)",
            }}
          >
            {body}
          </div>
        )}
        <div
          className="flex justify-end"
          style={{ gap: 8, marginTop: 18 }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer"
            autoFocus
            style={{
              ...KICKER,
              padding: "6px 12px",
              border: "1px solid var(--ll-divider)",
              background: "transparent",
              color: "var(--ll-ink)",
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="cursor-pointer"
            style={{
              ...KICKER,
              padding: "6px 12px",
              border: `1px solid ${
                destructive ? "var(--ll-warm)" : "var(--ll-ink)"
              }`,
              background: destructive ? "var(--ll-warm)" : "var(--ll-ink)",
              color: destructive ? "var(--ll-warm-ink)" : "var(--ll-bg)",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
