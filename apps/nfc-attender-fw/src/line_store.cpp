#include "line_store.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>
#include <LittleFS.h>

namespace llattender {

bool LittleFsLineStore::append(const std::string& line) {
  fs::File f = LittleFS.open(path_, "a");
  if (!f) {
    Serial.printf("[store] append: open %s failed\n", path_);
    return false;
  }
  const size_t want = line.size() + 1;
  size_t wrote = f.print(line.c_str());
  wrote += f.print('\n');
  f.close();
  if (wrote != want) {
    // Almost always a full filesystem. Say so plainly — a silent short write
    // here means a scan is acknowledged on screen but never reaches PB.
    Serial.printf("[store] append: short write to %s (%u/%u) — disk full?\n",
                  path_, static_cast<unsigned>(wrote),
                  static_cast<unsigned>(want));
    return false;
  }
  return true;
}

bool LittleFsLineStore::read_all(std::vector<std::string>& out) {
  out.clear();
  if (!LittleFS.exists(path_)) return true;  // absent == empty, not an error

  fs::File f = LittleFS.open(path_, "r");
  if (!f) {
    Serial.printf("[store] read: open %s failed\n", path_);
    return false;
  }
  std::string cur;
  while (f.available()) {
    const char c = static_cast<char>(f.read());
    if (c == '\n') {
      if (!cur.empty()) out.push_back(cur);
      cur.clear();
    } else if (c != '\r') {
      cur += c;
    }
  }
  // A final line with no trailing newline is what a power cut mid-append
  // leaves behind. Hand it to the caller anyway — only the caller's format
  // knows whether it is complete, and queue_core/roster skip what won't parse.
  if (!cur.empty()) out.push_back(cur);
  f.close();
  return true;
}

bool LittleFsLineStore::replace_all(const std::vector<std::string>& lines) {
  // Write to a temp file, then rename over the target. LittleFS renames are
  // atomic, so a power cut during this either leaves the old file completely
  // intact or the new one completely written — never a truncated mixture,
  // which is what a plain open("w") would risk.
  std::string tmp = std::string(path_) + ".tmp";

  {
    fs::File f = LittleFS.open(tmp.c_str(), "w");
    if (!f) {
      Serial.printf("[store] replace: open %s failed\n", tmp.c_str());
      return false;
    }
    for (const auto& l : lines) {
      const size_t want = l.size() + 1;
      size_t wrote = f.print(l.c_str());
      wrote += f.print('\n');
      if (wrote != want) {
        f.close();
        LittleFS.remove(tmp.c_str());
        Serial.printf("[store] replace: short write — disk full? (%s)\n", path_);
        return false;
      }
    }
    f.close();
  }

  // rename() won't overwrite an existing file on LittleFS, so drop the old
  // one first. This is the one instant where a power cut loses data; the
  // window is a single metadata operation, and the alternative (no
  // compaction) grows the file without bound.
  LittleFS.remove(path_);
  if (!LittleFS.rename(tmp.c_str(), path_)) {
    Serial.printf("[store] replace: rename %s -> %s failed\n",
                  tmp.c_str(), path_);
    return false;
  }
  return true;
}

size_t LittleFsLineStore::size_bytes() const {
  if (!LittleFS.exists(path_)) return 0;
  fs::File f = LittleFS.open(path_, "r");
  if (!f) return 0;
  const size_t n = f.size();
  f.close();
  return n;
}

bool LittleFsLineStore::clear() {
  if (!LittleFS.exists(path_)) return true;
  return LittleFS.remove(path_);
}

}  // namespace llattender

#endif  // LLATTENDER_NATIVE_BUILD
