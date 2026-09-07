#include "line_store.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>
#include <LittleFS.h>

namespace llattender {

namespace {
// Suffixes for the two-phase replace below. Both stay well inside LittleFS's
// 31-character name limit for every path this store is used with
// ("/queue.dead.jsonl.tmp" is the longest at 21).
constexpr const char* kTmpSuffix = ".tmp";
constexpr const char* kOldSuffix = ".old";

// Write every line to `path`, truncating whatever was there. Split out of
// replace_all so the failure paths below read as one decision each.
bool write_all(const char* path, const std::vector<std::string>& lines) {
  fs::File f = LittleFS.open(path, "w");
  if (!f) {
    Serial.printf("[store] replace: open %s failed\n", path);
    return false;
  }
  for (const auto& l : lines) {
    const size_t want = l.size() + 1;
    size_t wrote = f.print(l.c_str());
    wrote += f.print('\n');
    if (wrote != want) {
      f.close();
      LittleFS.remove(path);
      Serial.printf("[store] replace: short write — disk full? (%s)\n", path);
      return false;
    }
  }
  f.close();
  return true;
}
}  // namespace

bool LittleFsLineStore::append(const std::string& line) {
  recover();
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
  recover();
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

// Finish or undo a replace_all that lost power halfway. Called lazily from
// every public entry point rather than once from setup(): a recovery step
// that has to be wired in by hand is one that gets forgotten the day a third
// store is added.
void LittleFsLineStore::recover() const {
  if (recovered_) return;
  recovered_ = true;

  const std::string tmp = std::string(path_) + kTmpSuffix;
  const std::string old = std::string(path_) + kOldSuffix;

  if (LittleFS.exists(path_)) {
    // Live file in place, so the interrupted replace either never got past
    // its temp write or had already completed. Either way both leftovers are
    // stale and the live file is authoritative.
    if (LittleFS.exists(old.c_str())) {
      Serial.printf("[store] recover: dropping stale %s\n", old.c_str());
      LittleFS.remove(old.c_str());
    }
    if (LittleFS.exists(tmp.c_str())) LittleFS.remove(tmp.c_str());
    return;
  }

  if (LittleFS.exists(old.c_str())) {
    // Crashed between the two renames. Both copies on disk are complete, so
    // either would satisfy the contract; restoring the old one is the choice
    // that needs no assumption about how far the new write got.
    Serial.printf("[store] recover: restoring %s from %s\n", path_,
                  old.c_str());
    if (!LittleFS.rename(old.c_str(), path_)) {
      Serial.printf("[store] recover: restore FAILED — %s and %s left in "
                    "place, data is recoverable by hand\n",
                    old.c_str(), tmp.c_str());
      return;  // do NOT delete either copy; they are all that is left
    }
    LittleFS.remove(tmp.c_str());
    return;
  }

  // Neither a live file nor an old copy. Either this store has never been
  // written, or the crash landed while the temp file was still being written
  // to an empty store. A truncated temp is indistinguishable from a complete
  // one here and there is nothing to compare it against, so discard it —
  // "the old contents survive" is trivially satisfied when they were empty.
  if (LittleFS.exists(tmp.c_str())) {
    Serial.printf("[store] recover: discarding orphan %s\n", tmp.c_str());
    LittleFS.remove(tmp.c_str());
  }
}

bool LittleFsLineStore::replace_all(const std::vector<std::string>& lines) {
  recover();

  // Two renames, not remove-then-rename. LittleFS refuses to rename over an
  // existing file, and the obvious workaround — remove the target first —
  // leaves an instant in which the only complete copy of the queue is a temp
  // file nothing ever looks at. A power cut there loses every undelivered
  // scan, which is precisely the failure the durable queue exists to prevent
  // and precisely what line_store.h:46 promises cannot happen.
  //
  // Parking the old contents under .old instead means every crash point
  // leaves at least one complete copy under a name recover() knows about.
  const std::string tmp = std::string(path_) + kTmpSuffix;
  const std::string old = std::string(path_) + kOldSuffix;

  if (!write_all(tmp.c_str(), lines)) return false;  // path_ untouched

  // An empty store has nothing to park, and renaming a non-existent file
  // fails — so the caller's first compaction must not be treated as an error.
  const bool had_existing = LittleFS.exists(path_);
  if (had_existing && !LittleFS.rename(path_, old.c_str())) {
    LittleFS.remove(tmp.c_str());
    Serial.printf("[store] replace: rename %s -> %s failed\n", path_,
                  old.c_str());
    return false;  // path_ untouched
  }

  if (!LittleFS.rename(tmp.c_str(), path_)) {
    Serial.printf("[store] replace: rename %s -> %s failed\n", tmp.c_str(),
                  path_);
    // Roll back rather than leave the store empty: a failed compaction must
    // cost nothing, which is what test_queue_core.cpp's
    // test_failed_compaction_leaves_live_store_intact asserts.
    if (had_existing && !LittleFS.rename(old.c_str(), path_)) {
      Serial.printf("[store] replace: rollback FAILED — contents are in %s\n",
                    old.c_str());
      return false;  // leave .old for recover() / manual rescue
    }
    LittleFS.remove(tmp.c_str());
    return false;
  }

  if (had_existing) LittleFS.remove(old.c_str());
  return true;
}

size_t LittleFsLineStore::size_bytes() const {
  recover();
  if (!LittleFS.exists(path_)) return 0;
  fs::File f = LittleFS.open(path_, "r");
  if (!f) return 0;
  const size_t n = f.size();
  f.close();
  return n;
}

bool LittleFsLineStore::clear() {
  recover();
  if (!LittleFS.exists(path_)) return true;
  return LittleFS.remove(path_);
}

}  // namespace llattender

#endif  // LLATTENDER_NATIVE_BUILD
