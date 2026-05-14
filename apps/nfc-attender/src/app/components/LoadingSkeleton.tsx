"use client";
import React from "react";

/**
 * Skeleton placeholders for the learner table during initial load.
 *
 * Renders `count` rows shaped roughly like a real LearnerCard row, with a
 * looped pulse so the dashboard reads as "loading" rather than "empty".
 * Lives in the same grid column structure as the real rows so layout stays
 * stable when data arrives.
 */
export function LearnerRowsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading learners">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="grid items-center"
          style={{
            gridTemplateColumns:
              "32px 44px minmax(0,1.4fr) 180px 120px 56px",
            padding: "10px 28px",
            borderBottom: "1px solid var(--ll-divider)",
            opacity: 0.7,
          }}
        >
          <SkeletonBlock width={16} height={16} radius={4} />
          <SkeletonBlock width={32} height={32} radius={999} />
          <SkeletonBlock height={14} />
          <SkeletonBlock height={14} widthPct="60%" />
          <div className="flex justify-end">
            <SkeletonBlock width={92} height={26} radius={4} />
          </div>
          <div className="flex justify-end">
            <SkeletonBlock width={20} height={20} radius={4} />
          </div>
        </div>
      ))}
      <SkeletonStyles />
    </div>
  );
}

/** Compact grid-card skeleton for the wall view. */
export function LearnerWallSkeleton({ count = 18 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading learners"
      className="grid"
      style={{
        gap: 6,
        gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))",
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            background: "var(--ll-surface)",
            border: "1.5px solid var(--ll-divider)",
            padding: "7px 9px",
            minHeight: 54,
            opacity: 0.7,
          }}
        >
          <SkeletonBlock height={12} widthPct="85%" />
          <div style={{ marginTop: 6 }}>
            <SkeletonBlock height={9} widthPct="55%" />
          </div>
        </div>
      ))}
      <SkeletonStyles />
    </div>
  );
}

interface BlockProps {
  width?: number;
  widthPct?: string;
  height?: number;
  radius?: number;
}
function SkeletonBlock({ width, widthPct, height = 12, radius = 6 }: BlockProps) {
  return (
    <div
      className="ll-skeleton"
      style={{
        width: width != null ? width : widthPct ?? "80%",
        height,
        borderRadius: radius,
      }}
    />
  );
}

// Styled-in-component keyframes so the skeletons stay self-contained. The
// muted base + slightly lighter highlight is intentional — pure white shimmer
// looks out of place in dark mode and creates flicker against the page bg.
function SkeletonStyles() {
  return (
    <style jsx global>{`
      .ll-skeleton {
        background: linear-gradient(
          90deg,
          var(--ll-divider) 0%,
          rgba(255, 255, 255, 0.06) 50%,
          var(--ll-divider) 100%
        );
        background-size: 200% 100%;
        animation: ll-skeleton-shimmer 1.4s ease-in-out infinite;
      }
      @keyframes ll-skeleton-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .ll-skeleton { animation: none; }
      }
    `}</style>
  );
}
