"use client";
import React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional fallback. If omitted, a default card with retry is shown. */
  fallback?: (state: { error: Error; reset: () => void }) => React.ReactNode;
  /** Human-readable label for the boundary — surfaces in the default fallback. */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Subtree error boundary. Catches synchronous render errors and presents a
 * recoverable fallback so a single broken card can't take the dashboard down.
 *
 * Async errors (promise rejections, event handlers) don't reach this — guard
 * those at the call site with try/catch or an error-state hook.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      `[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ""}]`,
      error,
      info,
    );
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) {
      return this.props.fallback({ error, reset: this.reset });
    }
    return <DefaultFallback error={error} reset={this.reset} label={this.props.label} />;
  }
}

function DefaultFallback({
  error,
  reset,
  label,
}: {
  error: Error;
  reset: () => void;
  label?: string;
}) {
  return (
    <div
      role="alert"
      className="border rounded-2xl p-5"
      style={{
        background: "var(--ll-bg)",
        borderColor: "var(--ll-divider)",
        color: "var(--ll-text)",
      }}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5" style={{ color: "var(--ll-accent)" }} />
        <div className="flex-1">
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            Something went wrong{label ? ` in ${label}` : ""}.
          </div>
          <div style={{ fontSize: 13, color: "var(--ll-muted)", marginTop: 4 }}>
            {error.message || "Unknown error"}
          </div>
        </div>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium cursor-pointer"
          style={{
            background: "var(--ll-accent)",
            color: "var(--ll-bg)",
          }}
        >
          <RotateCw size={14} />
          Try again
        </button>
      </div>
    </div>
  );
}
