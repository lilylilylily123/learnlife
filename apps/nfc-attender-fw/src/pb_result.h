#pragma once

// What to do with a queued write after PocketBase answers.
//
// ── WHY THIS MATTERS ─────────────────────────────────────────────────────
//
// The queue today treats every failure identically: the writer returns false,
// the drain stops, and the entry is retried on the next cycle. Forever.
//
// That is right for a dropped connection and wrong for a deleted row. If a
// guide deletes an attendance record from the dashboard while a queued PATCH
// for it is pending, that PATCH will 404 on every retry, every 5 seconds, for
// as long as the device is powered — and because a failed drain stops at the
// head of the queue, it blocks every scan queued behind it. One deleted row
// wedges the whole queue and quietly burns the PocketHost request budget.
//
// So failures are classified: retry the ones that might succeed later, set
// aside the ones that never will, and keep the queue moving either way.

namespace llattender {

enum class WriteOutcome {
  Ok,             // written; drop the entry
  RetryLater,     // transient; keep the entry and stop draining for now
  PermanentFail,  // will never succeed; move to the dead-letter file
};

// Map an HTTP status (or a negative HTTPClient error code) to an outcome.
//
// Header-only and pure so it can be unit-tested without a network stack, and
// so the policy lives in one readable place rather than scattered through
// error handling.
inline WriteOutcome classify_http_status(int code) {
  // HTTPClient reports its own transport failures as negative values
  // (connection refused, timeout, TLS handshake failure). All transient.
  if (code < 0) return WriteOutcome::RetryLater;

  switch (code) {
    case 200:  // PATCH/GET ok
    case 201:  // created
    case 204:  // no content
      return WriteOutcome::Ok;

    case 400:  // malformed body — our own bug; retrying cannot fix it
    case 403:  // forbidden — collection rules reject this device account
    case 404:  // row deleted server-side, or a bad id
      return WriteOutcome::PermanentFail;

    case 401:
      // Token expired. Worth exactly one re-login and retry, which the caller
      // handles; treated as transient so the entry is not thrown away.
      return WriteOutcome::RetryLater;

    case 408:  // request timeout
    case 429:  // rate limited — PocketHost's 1000/hour per IP
      return WriteOutcome::RetryLater;

    default:
      // 5xx and anything unrecognised: assume the server might recover.
      // Erring toward RetryLater is the safe direction — a retried write is
      // wasted effort, but a discarded one is attendance data that silently
      // never existed.
      return WriteOutcome::RetryLater;
  }
}

}  // namespace llattender
