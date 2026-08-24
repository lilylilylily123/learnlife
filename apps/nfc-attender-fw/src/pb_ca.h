#pragma once

// Root certificate for verifying https://learnlife.pockethost.io.
//
// ── WHY PIN AT ALL ───────────────────────────────────────────────────────
//
// pb_client used to call client.setInsecure(), which disables certificate
// verification entirely. That means the device would happily hand its
// PocketBase account password to anything that answered on the right host —
// including a laptop running a rogue access point named after the school WiFi,
// which is a fifteen-minute attack with a €30 device.
//
// Pinning a root means TLS only succeeds against a certificate chaining to
// THIS root. An attacker would need a certificate issued by Google Trust
// Services for *.pockethost.io, which is a materially different problem.
//
// ── WHICH ROOT, AND WHY THIS ONE ─────────────────────────────────────────
//
// Verified against the live host rather than assumed. As served today:
//
//   leaf   CN=*.pockethost.io
//   ← i:   C=US, O=Google Trust Services, CN=WE1
//   ← i:   C=US, O=Google Trust Services LLC, CN=GTS Root R4
//   ← i:   C=BE, O=GlobalSign nv-sa, CN=GlobalSign Root CA   (cross-sign)
//
// Note it is Google Trust Services, NOT Let's Encrypt — pinning ISRG X1, the
// reflexive choice for a small hosted service, would have failed every
// handshake.
//
// The root below is the SELF-SIGNED GTS Root R4, fetched from Google's PKI
// repository (https://i.pki.goog/r4.crt) rather than scraped from the
// connection. Confirmed sufficient on its own:
//
//   $ openssl verify -CAfile r4.pem -untrusted chain.pem leaf.pem
//   OK
//
// The GlobalSign cross-signature above R4 exists for older clients; because
// R4 itself is a trust anchor here, the chain terminates at R4 and the
// cross-sign is not needed.
//
//   Subject:     C=US, O=Google Trust Services LLC, CN=GTS Root R4
//   SHA-256:     34:9D:FA:40:58:C5:E2:63:12:3B:39:8A:E7:95:57:3C:4E:13:13:C8:3F:E6:8F:93:55:6C:D5:E8:03:1B:3C:7D
//   Valid until: 2036-06-22
//
// ── OPERATIONAL RISK, AND WHY OTA SHIPPED FIRST ──────────────────────────
//
// If PocketHost ever moves to a different certificate authority, every device
// goes offline until reflashed. That is precisely why OTA landed earlier in
// this phase: the fix becomes a push instead of opening two enclosures with a
// laptop.
//
// The root itself is good until 2036, so the realistic trigger is a hosting
// change, not expiry. If devices suddenly fail to reach PocketBase, check this
// first:
//
//   openssl s_client -connect learnlife.pockethost.io:443 \\
//       -servername learnlife.pockethost.io -showcerts | grep "^ *i:"
//
// ── DEPENDS ON A CORRECT CLOCK ───────────────────────────────────────────
//
// With a CA configured, mbedTLS enforces the certificate's notBefore/notAfter.
// A device that has not yet reached NTP believes it is 1970 and every
// handshake fails as "not yet valid". The clock gate (src/clock_gate.h) is
// what makes this safe, and is why pinning had to land after it.

namespace llattender {

// PEM, NUL-terminated, for WiFiClientSecure::setCACert().
inline const char* kPocketHostRootCA =
    "-----BEGIN CERTIFICATE-----\n"
    "MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD\n"
    "VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG\n"
    "A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw\n"
    "WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz\n"
    "IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi\n"
    "AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi\n"
    "QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR\n"
    "HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW\n"
    "BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D\n"
    "9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8\n"
    "p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD\n"
    "-----END CERTIFICATE-----\n";

}  // namespace llattender
