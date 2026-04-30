"use client";
import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { HEADING, KICKER, Kicker, InkInput, InkSelect } from "./ll-ui";

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

const PROGRAM_OPTIONS = [
  { value: "", label: "Select a program…" },
  { value: "chmk", label: "Changemaker" },
  { value: "exp", label: "Explorer" },
  { value: "cre", label: "Creator" },
];

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

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !creating) onClose();
    },
    [onClose, creating],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
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
    if (!form.program) {
      setError("Pick a program.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await onCreate(form.name, form.email, form.program, form.dob, uid);
      setForm(initialForm);
      onClose();
    } catch {
      setError("Couldn't create learner. Try again.");
    } finally {
      setCreating(false);
    }
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget && !creating) onClose();
  }

  if (!mounted || !open) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: "rgba(31, 27, 22, 0.45)",
        backdropFilter: "blur(2px)",
        padding: 24,
      }}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-learner-title"
    >
      <div
        className="w-full"
        style={{
          maxWidth: 460,
          background: "var(--ll-surface)",
          border: "1.5px solid var(--ll-ink)",
          color: "var(--ll-ink)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between"
          style={{
            padding: "18px 24px 14px",
            borderBottom: "1px solid var(--ll-divider)",
          }}
        >
          <div>
            <Kicker>New record</Kicker>
            <h2
              id="create-learner-title"
              style={{ ...HEADING, fontSize: 22, marginTop: 2 }}
            >
              Add learner
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            aria-label="Close"
            className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              ...KICKER,
              fontSize: 14,
              padding: "4px 8px",
              border: "1px solid var(--ll-ink-2)",
              background: "transparent",
              color: "var(--ll-ink)",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: "20px 24px 22px" }}>
          <div className="flex flex-col" style={{ gap: 14 }}>
            <Field label="Full name" htmlFor="name">
              <InkInput
                id="name"
                name="name"
                value={form.name}
                onChange={handleInputChange}
                placeholder="First Last"
                required
                autoFocus
                style={{ width: "100%" }}
              />
            </Field>

            <Field label="Email" htmlFor="email">
              <InkInput
                id="email"
                name="email"
                type="email"
                value={form.email}
                onChange={handleInputChange}
                placeholder="learner@school.com"
                required
                style={{ width: "100%" }}
              />
            </Field>

            <Field label="Program" htmlFor="program">
              <InkSelect
                id="program"
                name="program"
                value={form.program}
                onChange={handleInputChange}
                required
                style={{ width: "100%" }}
              >
                {PROGRAM_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value} disabled={p.value === ""}>
                    {p.label}
                  </option>
                ))}
              </InkSelect>
            </Field>

            <Field label="Date of birth" htmlFor="dob">
              <InkInput
                id="dob"
                name="dob"
                type="date"
                value={form.dob}
                onChange={handleInputChange}
                required
                style={{ width: "100%" }}
              />
            </Field>

            <Field label="NFC card UID" htmlFor="uid-display">
              <InkInput
                id="uid-display"
                value={uid || ""}
                placeholder="Tap a card to capture its UID"
                readOnly
                style={{
                  width: "100%",
                  background: "var(--ll-bg)",
                  color: uid ? "var(--ll-ink)" : "var(--ll-muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  letterSpacing: "0.04em",
                }}
              />
              <div
                style={{
                  ...KICKER,
                  fontSize: 9.5,
                  marginTop: 6,
                  color: "var(--ll-muted)",
                }}
              >
                {uid ? "Card captured · will assign on save" : "No card scanned yet"}
              </div>
            </Field>
          </div>

          {error && (
            <div
              role="alert"
              style={{
                marginTop: 14,
                padding: "9px 12px",
                background: "color-mix(in srgb, var(--ll-warm) 12%, transparent)",
                border: "1px solid var(--ll-warm)",
                color: "var(--ll-warm)",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}

          <div className="flex" style={{ gap: 10, marginTop: 22 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={creating}
              className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 flex-1"
              style={{
                background: "transparent",
                color: "var(--ll-ink)",
                border: "1.5px solid var(--ll-ink-2)",
                padding: "10px 14px",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 flex-1"
              style={{
                background: "var(--ll-ink)",
                color: "var(--ll-bg)",
                border: "1.5px solid var(--ll-ink)",
                padding: "10px 14px",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {creating ? "Saving…" : "Add learner"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block"
        style={{ ...KICKER, marginBottom: 6 }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export default CreateLearnerModal;
