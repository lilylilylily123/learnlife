#include "queue_format.h"

#include <cstdio>
#include <cstdlib>

namespace llattender::queue_format {

std::string serialize(const queue::PendingScan& s) {
  std::string line;
  line += kVersion;
  line += kDelimiter;
  line += s.learner_id;
  line += kDelimiter;
  line += s.attendance_id;
  line += kDelimiter;
  char ts[32];
  std::snprintf(ts, sizeof(ts), "%lld", static_cast<long long>(s.ts_unix));
  line += ts;
  line += kDelimiter;
  line += s.fields_json;
  return line;
}

bool parse(const std::string& line, queue::PendingScan& out) {
  int delim_count = 0;
  for (char c : line) {
    if (c == kDelimiter) ++delim_count;
  }
  if (delim_count != 4) return false;

  std::string parts[5];
  int idx = 0;
  size_t start = 0;
  for (size_t i = 0; i < line.size(); ++i) {
    if (line[i] == kDelimiter) {
      parts[idx++] = line.substr(start, i - start);
      start = i + 1;
    }
  }
  parts[4] = line.substr(start);

  if (parts[0] != kVersion) return false;
  if (parts[1].empty()) return false;  // learner_id is required

  out.learner_id = parts[1];
  out.attendance_id = parts[2];
  out.ts_unix = static_cast<std::time_t>(std::atoll(parts[3].c_str()));
  out.fields_json = parts[4];
  return true;
}

}  // namespace llattender::queue_format
