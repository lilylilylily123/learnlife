#include "roster_format.h"

#include <cctype>

namespace llattender::roster_format {

namespace {

// Remove characters that would break the line format. Only CR/LF can do that
// — a '|' inside `name` is fine because name is parsed as the remainder.
std::string sanitize(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  for (char c : s) {
    if (c != '\r' && c != '\n') out += c;
  }
  return out;
}

// Strip a '|' from the machine-generated fields. They should never contain
// one, but a stray value from PocketBase must corrupt at most its own row
// rather than shifting every field after it.
std::string sanitize_field(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  for (char c : s) {
    if (c != '\r' && c != '\n' && c != kDelimiter) out += c;
  }
  return out;
}

}  // namespace

std::string normalize_uid(const std::string& uid) {
  std::string out;
  out.reserve(uid.size());
  for (unsigned char c : uid) {
    out += static_cast<char>(std::tolower(c));
  }
  return out;
}

std::string serialize(const pb_client::LearnerRow& row) {
  std::string line = kVersion;
  line += kDelimiter;
  line += sanitize_field(row.id);
  line += kDelimiter;
  line += normalize_uid(sanitize_field(row.nfc_id));
  line += kDelimiter;
  line += sanitize_field(row.program);
  line += kDelimiter;
  line += sanitize(row.name);  // last field: '|' is allowed here
  return line;
}

bool parse(const std::string& line, pb_client::LearnerRow& out) {
  size_t p0 = line.find(kDelimiter);
  if (p0 == std::string::npos) return false;
  if (line.compare(0, p0, kVersion) != 0) return false;

  size_t p1 = line.find(kDelimiter, p0 + 1);
  if (p1 == std::string::npos) return false;
  size_t p2 = line.find(kDelimiter, p1 + 1);
  if (p2 == std::string::npos) return false;
  size_t p3 = line.find(kDelimiter, p2 + 1);
  if (p3 == std::string::npos) return false;

  out.id      = line.substr(p0 + 1, p1 - p0 - 1);
  out.nfc_id  = normalize_uid(line.substr(p1 + 1, p2 - p1 - 1));
  out.program = line.substr(p2 + 1, p3 - p2 - 1);
  // Everything after the 4th delimiter, so a '|' in a learner's name survives.
  out.name    = line.substr(p3 + 1);

  return !out.id.empty();
}

}  // namespace llattender::roster_format
