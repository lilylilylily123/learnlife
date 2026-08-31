#include "jwt.h"

#include <ArduinoJson.h>

namespace llattender::jwt {

namespace {

// Value of one base64url character, or -1.
int b64url_val(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '-') return 62;  // '+' in standard base64
  if (c == '_') return 63;  // '/' in standard base64
  return -1;
}

}  // namespace

bool base64url_decode(const std::string& in, std::string& out) {
  out.clear();
  if (in.empty()) return false;

  uint32_t buf = 0;
  int bits = 0;
  for (char c : in) {
    if (c == '=') break;  // padding, if the encoder bothered to include it
    const int v = b64url_val(c);
    if (v < 0) return false;
    buf = (buf << 6) | static_cast<uint32_t>(v);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += static_cast<char>((buf >> bits) & 0xFF);
    }
  }
  // Leftover bits are the expected remainder of unpadded base64, not an error.
  return true;
}

bool extract_exp(const std::string& token, std::time_t& out_exp) {
  out_exp = 0;

  // A JWT is header.payload.signature. Only the payload is wanted, and the
  // signature is deliberately not checked — see the note in jwt.h.
  const size_t dot1 = token.find('.');
  if (dot1 == std::string::npos) return false;
  const size_t dot2 = token.find('.', dot1 + 1);
  if (dot2 == std::string::npos) return false;

  const std::string payload_b64 = token.substr(dot1 + 1, dot2 - dot1 - 1);
  if (payload_b64.empty()) return false;

  std::string payload;
  if (!base64url_decode(payload_b64, payload)) return false;

  // Filtered so a large token (PocketBase embeds the whole user record in
  // some configurations) doesn't allocate more than the one number needed.
  JsonDocument filter;
  filter["exp"] = true;

  JsonDocument doc;
  if (deserializeJson(doc, payload, DeserializationOption::Filter(filter))) {
    return false;
  }

  auto exp = doc["exp"];
  if (exp.isNull() || !exp.is<long long>()) return false;

  const long long v = exp.as<long long>();
  if (v <= 0) return false;

  out_exp = static_cast<std::time_t>(v);
  return true;
}

bool is_usable(const std::string& token, std::time_t expires_at,
               std::time_t now, std::time_t skew_seconds) {
  if (token.empty()) return false;
  if (expires_at <= 0) return false;
  // Unknown clock (no NTP yet) — refuse rather than guess. Attempting a
  // request with an expired token just costs an extra round-trip.
  if (now <= 0) return false;
  return expires_at - now > skew_seconds;
}

}  // namespace llattender::jwt
