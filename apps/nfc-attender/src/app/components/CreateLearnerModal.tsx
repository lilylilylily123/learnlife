"use client";
import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

interface CreateLearnerModalProps {
  open: boolean;
  onClose: () => void;
  uid: string;
  onCreate: (
    name: string,
    email: string,
    program: string,
    dob: string,
    uid: string,
  ) => Promise<void>;
}

const initialForm = {
  name: "",
  email: "",
  program: "",
  dob: "",
};

const CreateLearnerModal: React.FC<CreateLearnerModalProps> = ({
  open,
  onClose,
  onCreate,
  uid,
}) => {
  const [form, setForm] = useState(initialForm);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Ensure we only render the portal on the client
  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      // Prevent body scroll when modal is open
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleKeyDown]);

  function handleInputChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await onCreate(form.name, form.email, form.program, form.dob, uid);
      setForm(initialForm);
      onClose();
    } catch (err: unknown) {
      setError("Failed to create learner.");
    } finally {
      setCreating(false);
    }
  }

  // Handle backdrop click (close if clicking outside modal content)
  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  // Don't render anything on server or if not open
  if (!mounted || !open) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4 relative animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors cursor-pointer"
          onClick={onClose}
          type="button"
          aria-label="Close modal"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {/* Header */}
        <div className="mb-6">
          <h2 id="modal-title" className="text-xl font-bold text-gray-900">
            Create New Learner
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Fill in the details below to add a new learner.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Full Name
            </label>
            <input
              id="name"
              name="name"
              value={form.name}
              onChange={handleInputChange}
              placeholder="Enter full name"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
              required
              autoFocus
            />
          </div>

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Email Address
            </label>
            <input
              id="email"
              name="email"
              value={form.email}
              onChange={handleInputChange}
              placeholder="Enter email address"
              type="email"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
              required
            />
          </div>
          <div>
            <label
              htmlFor="program"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Program
            </label>
            <select
              id="program"
              name="program"
              value={form.program}
              onChange={handleInputChange}
              className="w-full border border-gray-300 rounded-lg px-3 py-12 cursor-pointer"
            >
              <option>Changemaker</option>
              <option>Explorer</option>
              <option>Creator</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="dob"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Date of Birth
            </label>
            <input
              id="dob"
              name="dob"
              value={form.dob}
              onChange={handleInputChange}
              type="date"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow cursor-pointer"
              required
            />
          </div>

          <div>
            <label
              htmlFor="uid-display"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              NFC UID
            </label>
            <input
              id="uid-display"
              name="uid-display"
              value={uid || "No NFC tag scanned"}
              readOnly
              className="w-full border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-gray-600 cursor-not-allowed"
            />
            <p className="text-xs text-gray-400 mt-1">
              Scan an NFC tag to assign it to this learner.
            </p>
          </div>

          {/* Error message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-600 text-sm">
              {error}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 mt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors cursor-pointer"
              disabled={creating}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 rounded-lg bg-blue-500 text-white font-semibold hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              disabled={creating}
            >
              {creating ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Creating...
                </span>
              ) : (
                "Create Learner"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  // Use createPortal to render at document.body level
  return createPortal(modalContent, document.body);
};

export default CreateLearnerModal;
