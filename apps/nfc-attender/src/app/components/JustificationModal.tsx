"use client";
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { parsePBDate } from "@learnlife/shared";

interface JustificationModalProps {
  learnerName: string;
  currentReason: string;
  // Already-resolved display name. The raw user FK gets resolved by the
  // parent (via `pb.authStore.record` for the common same-user case or by
  // expanding the relation in the underlying query) so the modal can render
  // a human name instead of a meaningless ID.
  justifiedByName: string | null;
  justifiedAt: string | null;
  // Error message lifted to the parent so a failed save doesn't close the
  // modal and lose the user's typed reason.
  error?: string | null;
  onSave: (reason: string) => void | Promise<void>;
  onClose: () => void;
}

export function JustificationModal({
  learnerName,
  currentReason,
  justifiedByName,
  justifiedAt,
  error,
  onSave,
  onClose,
}: JustificationModalProps) {
  const [reason, setReason] = useState(currentReason);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(reason.trim());
    } finally {
      setSaving(false);
    }
  };

  // Use the shared PB date parser so we handle PB's space-separated format
  // (e.g. "2026-05-11 14:30:00.000Z") the same way the rest of the app does.
  const audit = justifiedAt
    ? parsePBDate(justifiedAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-gray-900 mb-2">
          Justification reason
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Add a note explaining why{" "}
          <span className="font-medium text-gray-900">{learnerName}</span> was
          marked justified.
        </p>

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. doctor appointment, family emergency, illness..."
          rows={4}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
          autoFocus
          disabled={saving}
        />

        {(audit || justifiedByName) && (
          <div className="mt-2 text-xs text-gray-500">
            {justifiedByName && <>Marked by {justifiedByName}</>}
            {audit && <> · {audit}</>}
          </div>
        )}

        {error && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-xs border border-red-200">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3 py-2 rounded-xl bg-gray-200 text-gray-700 text-sm cursor-pointer hover:bg-gray-300 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium cursor-pointer hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save reason"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
