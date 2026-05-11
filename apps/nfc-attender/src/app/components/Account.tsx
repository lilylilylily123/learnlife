"use client";
import { pb } from "../pb";
import { useState, useCallback } from "react";
import { HEADING, KICKER, Kicker, LMark, InkInput } from "./ll-ui";
import { debug } from "@/lib/debug";

// Sign-in only. Account creation is invite-driven on the calendar app side
// (lg/admin accounts are seeded in PocketBase admin), so the old "Sign Up"
// tab was removed as part of the security audit.

export default function Account() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setEmail("");
    setPassword("");
    setError(null);
  }, []);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }

    setLoading(true);
    try {
      await pb.collection("users").authWithPassword(email, password);
      reset();
    } catch (err: unknown) {
      debug.error("[account] sign-in failed", err);
      // Don't distinguish wrong-email from wrong-password.
      const e = err as { status?: number };
      if (e.status === 0) setError("Network error. Check your connection.");
      else if (e.status && e.status >= 500) setError("Server error. Try again shortly.");
      else if (e.status === 429) setError("Too many attempts. Try again in a moment.");
      else setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{
        background: "var(--ll-bg)",
        color: "var(--ll-ink)",
        padding: 24,
      }}
    >
      <div
        className="w-full"
        style={{ maxWidth: 380 }}
      >
        {/* Brand */}
        <div className="flex items-center" style={{ gap: 12, marginBottom: 28 }}>
          <LMark size={36} />
          <div>
            <Kicker>Attender · Reception</Kicker>
            <div style={{ ...HEADING, fontSize: 28, lineHeight: 1.1, marginTop: 2 }}>
              Sign in
            </div>
          </div>
        </div>

        {/* Card */}
        <div
          style={{
            background: "var(--ll-surface)",
            border: "1.5px solid var(--ll-ink)",
            padding: 24,
          }}
        >
          <form onSubmit={handleSignIn} className="flex flex-col" style={{ gap: 16 }}>
            <div>
              <label
                htmlFor="email"
                className="block"
                style={{ ...KICKER, marginBottom: 6 }}
              >
                Email
              </label>
              <InkInput
                id="email"
                type="email"
                placeholder="you@learnlife.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                required
                style={{ width: "100%" }}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block"
                style={{ ...KICKER, marginBottom: 6 }}
              >
                Password
              </label>
              <div className="relative">
                <InkInput
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  style={{ width: "100%", paddingRight: 56 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute cursor-pointer ll-link"
                  style={{
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    ...KICKER,
                    fontSize: 10,
                    background: "transparent",
                    border: "none",
                    padding: "4px 6px",
                  }}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                style={{
                  background: "color-mix(in srgb, var(--ll-warm) 12%, transparent)",
                  border: "1px solid var(--ll-warm)",
                  color: "var(--ll-warm)",
                  padding: "9px 12px",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  letterSpacing: "0.02em",
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                background: "var(--ll-ink)",
                color: "var(--ll-bg)",
                border: "1.5px solid var(--ll-ink)",
                padding: "11px 16px",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginTop: 4,
              }}
            >
              {loading ? "Signing in…" : "Sign in →"}
            </button>
          </form>

          <div
            style={{
              marginTop: 18,
              paddingTop: 14,
              borderTop: "1px solid var(--ll-divider)",
              ...KICKER,
              color: "var(--ll-muted)",
              lineHeight: 1.5,
            }}
          >
            New accounts are created by an admin. If you can&apos;t sign in,
            ask your facilitator to issue you an invite.
          </div>
        </div>

        <div
          className="text-center"
          style={{
            ...KICKER,
            color: "var(--ll-muted)",
            marginTop: 18,
          }}
        >
          LearnLife · Reception
        </div>
      </div>
    </div>
  );
}
