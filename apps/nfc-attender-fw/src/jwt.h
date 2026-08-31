#pragma once

// Minimal JWT inspection: extract the `exp` claim.
//
// ── WHY ──────────────────────────────────────────────────────────────────
//
// config.h has carried `token` and `token_expires` fields since Phase 1, and
// config.cpp faithfully persists them — but pb_client keeps the bearer token
// in RAM and logs in again on every boot and every reconnect. The fields have
// never meant anything.
//
// Caching the token removes a full TLS login round-trip per boot, which
// matters for three reasons: it is the slowest thing between power-on and the
// first usable tap; it spends the PocketHost per-IP request budget shared by
// both devices and the dashboard; and it means the account password is sent
// over the wire far less often.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────
//
// It does NOT verify the signature. The device is not making an authorization
// decision — it is asking "is the token I already hold worth trying, or should
// I log in first?" A forged token would simply be rejected by PocketBase, and
// the 401 path handles that.
//
// Verifying would mean shipping the server's signing key to a device sitting
// on a front desk, which trades a real secret for no benefit.
//
// So this reads the payload as untrusted data, and every failure mode returns
// false — meaning "log in again", which is always safe.

#include <ctime>
#include <string>

namespace llattender::jwt {

// Extract the `exp` (expiry) claim, as a unix timestamp.
//
// Returns false if the string isn't a three-part JWT, the payload isn't valid
// base64url, the payload isn't JSON, or there is no numeric `exp`. Callers
// treat false as "unusable — log in".
bool extract_exp(const std::string& token, std::time_t& out_exp);

// Decode base64url (RFC 4648 §5): '-' and '_' replace '+' and '/', and the
// trailing '=' padding is usually omitted. Exposed for testing.
bool base64url_decode(const std::string& in, std::string& out);

// True if the token is present and has at least `skew_seconds` of life left.
//
// The skew exists because a token that expires between the check and the
// request produces a 401 the caller has to recover from. Five minutes is
// generous next to a PocketBase token's default lifetime and costs nothing.
bool is_usable(const std::string& token, std::time_t expires_at,
               std::time_t now, std::time_t skew_seconds = 300);

}  // namespace llattender::jwt
