"use client";
import React from "react";
import { LearnerCard } from "./LearnerCard";
import type { Student } from "../types";

// kid-friendly program color helper
export const programColor = (program: string) =>
  program === "exp"
    ? "bg-rose-100 text-rose-800"
    : program === "cre"
      ? "bg-emerald-100 text-emerald-800"
      : "bg-sky-100 text-sky-800";

export const programLabel = (program: string | undefined) =>
  program === "exp" ? "EXP" : program === "cre" ? "CRE" : "CHMK";

interface LearnerGridProps {
  filtered: Student[];
  uid: string;
  testMode: boolean;
  testTime: Date | null;
  onStatusChange: (
    id: string,
    status: string,
    field?: "status" | "lunch_status",
    toggle?: boolean,
  ) => void;
  onCheckAction: (id: string, action: string) => void;
  onCommentUpdate: (id: string, comment: string) => Promise<void>;
  onReset: (id: string) => void;
}

export function LearnerGrid({
  filtered,
  uid,
  testMode,
  testTime,
  onStatusChange,
  onCheckAction,
  onCommentUpdate,
  onReset,
}: LearnerGridProps) {
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {filtered.map((s) => (
        <LearnerCard
          key={s.id}
          s={s}
          isCurrent={s.NFC_ID === uid}
          programClass={programColor((s.program as string) || "")}
          programLabel={programLabel(s.program)}
          onStatusChange={onStatusChange}
          onCheckAction={(id: string, action: string) =>
            onCheckAction(id, action)
          }
          onCommentUpdate={onCommentUpdate}
          onReset={onReset}
          testTime={testMode ? testTime : undefined}
          testMode={testMode}
        />
      ))}

      {filtered.length === 0 && (
        <div className="col-span-full text-center text-gray-600 py-20">
          No learners match your search / filter.
        </div>
      )}
    </div>
  );
}
