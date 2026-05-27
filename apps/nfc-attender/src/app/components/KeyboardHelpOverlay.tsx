"use client";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { HEADING, KICKER } from "./ll-ui";

interface KeyboardHelpOverlayProps {
  open: boolean;
  onClose: () => void;
}

interface Shortcut {
  keys: string[];
  label: string;
}

// Keep grouped so the overlay can render section headers without the parent
// owning layout. New shortcuts go here AND in the corresponding listener —
// there's no runtime check that they stay in sync, so keep them adjacent in PRs.
const GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: "Navigation",
    items: [
      { keys: ["/"], label: "Focus search" },
      { keys: ["h"], label: "Open history" },
      { keys: ["1"], label: "Table view" },
      { keys: ["2"], label: "Wall view" },
    ],
  },
  {
    title: "Modes",
    items: [
      { keys: ["t"], label: "Toggle test mode" },
      { keys: ["?"], label: "Show this help" },
      { keys: ["Esc"], label: "Close menus / dialogs" },
    ],
  },
];

export function KeyboardHelpOverlay({ open, onClose }: KeyboardHelpOverlayProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: "rgba(31,27,22,0.45)", padding: 16 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-help-title"
        style={{
          background: "var(--ll-surface)",
          border: "1.5px solid var(--ll-ink)",
          padding: "22px 24px 20px",
          maxWidth: 460,
          width: "100%",
          boxShadow: "0 12px 28px rgba(31,27,22,0.22)",
        }}
      >
        <div className="flex items-baseline justify-between" style={{ marginBottom: 16 }}>
          <div
            id="keyboard-help-title"
            style={{ ...HEADING, fontSize: 22, lineHeight: 1.15 }}
          >
            Keyboard shortcuts
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help"
            className="cursor-pointer"
            style={{
              ...KICKER,
              background: "transparent",
              border: "none",
              color: "var(--ll-muted)",
              padding: "2px 6px",
            }}
          >
            Esc
          </button>
        </div>
        {GROUPS.map((g) => (
          <div key={g.title} style={{ marginBottom: 14 }}>
            <div
              style={{
                ...KICKER,
                color: "var(--ll-muted)",
                marginBottom: 6,
              }}
            >
              {g.title}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {g.items.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center"
                  style={{ gap: 12, fontSize: 13 }}
                >
                  <div className="flex" style={{ gap: 4, minWidth: 84 }}>
                    {s.keys.map((k) => (
                      <kbd
                        key={k}
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "2px 8px",
                          background: "var(--ll-bg)",
                          border: "1px solid var(--ll-divider)",
                          color: "var(--ll-ink)",
                          letterSpacing: "0.04em",
                          minWidth: 16,
                          textAlign: "center",
                        }}
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                  <span style={{ color: "var(--ll-ink-2)" }}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div
          style={{
            ...KICKER,
            color: "var(--ll-muted)",
            marginTop: 4,
            paddingTop: 12,
            borderTop: "1px dashed var(--ll-divider)",
          }}
        >
          Shortcuts pause while typing in inputs.
        </div>
      </div>
    </div>,
    document.body,
  );
}
