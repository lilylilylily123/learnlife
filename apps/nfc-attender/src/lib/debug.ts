// Production-gated logger. In development we mirror to the real console so
// the developer flow doesn't change; in production these become no-ops so
// learner names, NFC UIDs, and PB error payloads don't leak to the screen
// recorder / Console.app.
//
// Use `error()` for unexpected failures we still want surfaced — those go to
// the console even in production but with a generic prefix and no payload.

const isDev = process.env.NODE_ENV !== "production";

export const debug = {
  log: (...args: unknown[]) => {
    if (isDev) console.log(...args);
  },
  warn: (...args: unknown[]) => {
    if (isDev) console.warn(...args);
  },
  error: (...args: unknown[]) => {
    // Always surface errors but elide details in production.
    if (isDev) {
      console.error(...args);
    } else {
      console.error("[error]");
    }
  },
};
