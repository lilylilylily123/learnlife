"use client";
import { pb } from "../pb";
import { useState, useCallback } from "react";

// Icons as simple SVG components
const EmailIcon = () => (
  <svg
    className="w-5 h-5 text-gray-400"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
    />
  </svg>
);

const LockIcon = () => (
  <svg
    className="w-5 h-5 text-gray-400"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
    />
  </svg>
);

const UserIcon = () => (
  <svg
    className="w-5 h-5 text-gray-400"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
    />
  </svg>
);

const EyeIcon = ({ open }: { open: boolean }) => (
  <svg
    className="w-5 h-5 text-gray-400 hover:text-gray-600 cursor-pointer"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    {open ? (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    ) : (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
      />
    )}
  </svg>
);

const SpinnerIcon = () => (
  <svg
    className="animate-spin h-5 w-5 text-white"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

type Tab = "signin" | "signup";

export default function Account() {
  const [activeTab, setActiveTab] = useState<Tab>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setName("");
    setError(null);
    setSuccess(null);
  }, []);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    resetForm();
  };

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email || !password) {
      setError("Please fill in all fields");
      return;
    }

    if (!validateEmail(email)) {
      setError("Please enter a valid email address");
      return;
    }

    setLoading(true);

    try {
      await pb.collection("users").authWithPassword(email, password);
      setSuccess("Welcome back! Signing you in...");
      resetForm();
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Invalid email or password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!name || !email || !password || !confirmPassword) {
      setError("Please fill in all fields");
      return;
    }

    if (!validateEmail(email)) {
      setError("Please enter a valid email address");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters long");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      await pb.collection("users").create({
        email,
        emailVisibility: true,
        name,
        password,
        passwordConfirm: confirmPassword,
      });
      setSuccess("Account created! You can now sign in.");
      setActiveTab("signin");
      setPassword("");
      setConfirmPassword("");
      setName("");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Could not create account. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 via-rose-50 to-violet-100 p-4 sm:p-6">
      {/* Main card */}
      <div className="relative w-full max-w-md">
        {/* Logo / App title */}
        <div className="text-center mb-8">
          <img
            src="/logo.png"
            alt="Attender"
            className="w-20 h-20 mx-auto mb-4 rounded-2xl shadow-lg hover:scale-105 transition-transform"
          />
          <h1 className="text-3xl font-bold bg-gradient-to-r from-rose-500 via-purple-500 to-sky-500 bg-clip-text text-transparent">
            Attender
          </h1>
        </div>

        {/* Card container */}
        <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 overflow-hidden">
          {/* Tab switcher */}
          <div className="flex border-b border-gray-100">
            <button
              onClick={() => handleTabChange("signin")}
              className={`flex-1 py-4 text-sm font-semibold transition-all duration-300 ${
                activeTab === "signin"
                  ? "text-purple-600 border-b-2 border-purple-500 bg-purple-50/50"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-50/50"
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => handleTabChange("signup")}
              className={`flex-1 py-4 text-sm font-semibold transition-all duration-300 ${
                activeTab === "signup"
                  ? "text-purple-600 border-b-2 border-purple-500 bg-purple-50/50"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-50/50"
              }`}
            >
              Create Account
            </button>
          </div>

          {/* Form content */}
          <div className="p-8">
            {/* Error / Success messages */}
            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-100 flex items-start gap-3 animate-shake">
                <span className="text-red-500 text-lg">⚠️</span>
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            {success && (
              <div className="mb-6 p-4 rounded-xl bg-green-50 border border-green-100 flex items-start gap-3">
                <span className="text-green-500 text-lg">✓</span>
                <p className="text-green-600 text-sm">{success}</p>
              </div>
            )}

            {activeTab === "signin" ? (
              /* Sign In Form */
              <form onSubmit={handleSignIn} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address
                  </label>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2">
                      <EmailIcon />
                    </div>
                    <input
                      type="email"
                      placeholder="you@example.com"
                      className="w-full py-3.5 pl-12 pr-4 rounded-xl border border-gray-200 bg-gray-50/50 focus:bg-white focus:border-purple-400 focus:ring-2 focus:ring-purple-100 focus:outline-none transition-all duration-200 text-gray-900 placeholder:text-gray-400"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2">
                      <LockIcon />
                    </div>
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      className="w-full py-3.5 pl-12 pr-12 rounded-xl border border-gray-200 bg-gray-50/50 focus:bg-white focus:border-purple-400 focus:ring-2 focus:ring-purple-100 focus:outline-none transition-all duration-200 text-gray-900 placeholder:text-gray-400"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2"
                    >
                      <EyeIcon open={showPassword} />
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-rose-400 via-purple-500 to-sky-500 text-white font-semibold shadow-lg shadow-purple-200 hover:shadow-xl hover:shadow-purple-300 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:translate-y-0 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <SpinnerIcon />
                      <span>Signing in...</span>
                    </>
                  ) : (
                    "Sign In"
                  )}
                </button>
              </form>
            ) : (
              /* Sign Up Form */
              <form onSubmit={handleSignUp} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Full Name
                  </label>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2">
                      <UserIcon />
                    </div>
                    <input
                      type="text"
                      placeholder="Your full name"
                      className="w-full py-3.5 pl-12 pr-4 rounded-xl border border-gray-200 bg-gray-50/50 focus:bg-white focus:border-purple-400 focus:ring-2 focus:ring-purple-100 focus:outline-none transition-all duration-200 text-gray-900 placeholder:text-gray-400"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address
                  </label>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2">
                      <EmailIcon />
                    </div>
                    <input
                      type="email"
                      placeholder="you@example.com"
                      className="w-full py-3.5 pl-12 pr-4 rounded-xl border border-gray-200 bg-gray-50/50 focus:bg-white focus:border-purple-400 focus:ring-2 focus:ring-purple-100 focus:outline-none transition-all duration-200 text-gray-900 placeholder:text-gray-400"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2">
                      <LockIcon />
                    </div>
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="At least 8 characters"
                      className="w-full py-3.5 pl-12 pr-12 rounded-xl border border-gray-200 bg-gray-50/50 focus:bg-white focus:border-purple-400 focus:ring-2 focus:ring-purple-100 focus:outline-none transition-all duration-200 text-gray-900 placeholder:text-gray-400"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2"
                    >
                      <EyeIcon open={showPassword} />
                    </button>
                  </div>
                  {password && password.length < 8 && (
                    <p className="mt-2 text-xs text-amber-600">
                      Password needs {8 - password.length} more character
                      {8 - password.length !== 1 ? "s" : ""}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2">
                      <LockIcon />
                    </div>
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Confirm your password"
                      className={`w-full py-3.5 pl-12 pr-12 rounded-xl border bg-gray-50/50 focus:bg-white focus:ring-2 focus:outline-none transition-all duration-200 text-gray-900 placeholder:text-gray-400 ${
                        confirmPassword && confirmPassword !== password
                          ? "border-red-300 focus:border-red-400 focus:ring-red-100"
                          : confirmPassword && confirmPassword === password
                            ? "border-green-300 focus:border-green-400 focus:ring-green-100"
                            : "border-gray-200 focus:border-purple-400 focus:ring-purple-100"
                      }`}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
                      className="absolute right-4 top-1/2 -translate-y-1/2"
                    >
                      <EyeIcon open={showConfirmPassword} />
                    </button>
                  </div>
                  {confirmPassword && confirmPassword !== password && (
                    <p className="mt-2 text-xs text-red-500">
                      Passwords don't match
                    </p>
                  )}
                  {confirmPassword &&
                    confirmPassword === password &&
                    password.length >= 8 && (
                      <p className="mt-2 text-xs text-green-600">
                        ✓ Passwords match
                      </p>
                    )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-rose-400 via-purple-500 to-sky-500 text-white font-semibold shadow-lg shadow-purple-200 hover:shadow-xl hover:shadow-purple-300 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:translate-y-0 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <SpinnerIcon />
                      <span>Creating account...</span>
                    </>
                  ) : (
                    "Create Account"
                  )}
                </button>
              </form>
            )}

            {/* Footer text */}
            <p className="mt-6 text-center text-xs text-gray-400">
              {activeTab === "signin" ? (
                <>
                  Don't have an account?{" "}
                  <button
                    onClick={() => handleTabChange("signup")}
                    className="text-purple-500 font-medium hover:text-purple-600 transition-colors"
                  >
                    Create one
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    onClick={() => handleTabChange("signin")}
                    className="text-purple-500 font-medium hover:text-purple-600 transition-colors"
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Bottom branding */}
        <p className="text-center mt-6 text-xs text-gray-400">
          Made with 💜 for learners everywhere
        </p>
      </div>

      {/* Custom animations */}
      <style jsx>{`
        @keyframes shake {
          0%,
          100% {
            transform: translateX(0);
          }
          10%,
          30%,
          50%,
          70%,
          90% {
            transform: translateX(-4px);
          }
          20%,
          40%,
          60%,
          80% {
            transform: translateX(4px);
          }
        }
        .animate-shake {
          animation: shake 0.5s ease-in-out;
        }
      `}</style>
    </div>
  );
}
