#include "roster.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>

#include "line_store.h"
#include "roster_format.h"
#include "time_sync.h"

namespace llattender::roster {

namespace {

constexpr const char* kPath = "/roster.txt";

LittleFsLineStore g_store(kPath);
std::vector<pb_client::LearnerRow> g_items;
bool g_ready = false;
std::time_t g_loaded_at = 0;

// lookup_by_uid runs on processor_task; replace() runs on network_task.
SemaphoreHandle_t g_mtx = nullptr;

class Lock {
 public:
  Lock() : held_(false) {
    if (g_mtx) held_ = xSemaphoreTakeRecursive(g_mtx, portMAX_DELAY) == pdTRUE;
  }
  ~Lock() { if (held_) xSemaphoreGiveRecursive(g_mtx); }
  Lock(const Lock&) = delete;
  Lock& operator=(const Lock&) = delete;
 private:
  bool held_;
};

}  // namespace

bool init() {
  if (!g_mtx) g_mtx = xSemaphoreCreateRecursiveMutex();
  Lock lk;

  std::vector<std::string> lines;
  if (!g_store.read_all(lines)) {
    Serial.println("[roster] read failed — no cache available");
    return false;
  }

  g_items.clear();
  g_items.reserve(lines.size());
  int skipped = 0;
  for (const auto& line : lines) {
    pb_client::LearnerRow row;
    if (roster_format::parse(line, row)) {
      g_items.push_back(std::move(row));
    } else {
      ++skipped;
    }
  }

  if (skipped > 0) {
    Serial.printf("[roster] skipped %d unparseable line(s)\n", skipped);
  }

  if (g_items.empty()) {
    // First boot, or the cache was wiped. Cards won't resolve until the first
    // successful fetch — which is exactly the situation this cache exists to
    // prevent on every subsequent boot.
    Serial.println("[roster] no cached roster on disk — cards will not "
                   "resolve until WiFi comes up");
    return true;
  }

  g_ready = true;
  g_loaded_at = time_sync::now_unix();
  Serial.printf("[roster] loaded %u learners from disk (offline-ready)\n",
                static_cast<unsigned>(g_items.size()));
  return true;
}

bool replace(const std::vector<pb_client::LearnerRow>& items) {
  Lock lk;

  if (items.empty()) {
    // Refuse to overwrite a good cache with an empty fetch. A permissions
    // change or an empty page would otherwise wipe the roster and leave the
    // device unable to identify anyone — worse than a slightly stale copy.
    Serial.println("[roster] refusing to replace cache with an empty roster");
    return false;
  }

  g_items = items;
  g_ready = true;
  g_loaded_at = time_sync::now_unix();

  std::vector<std::string> lines;
  lines.reserve(items.size());
  for (const auto& l : items) lines.push_back(roster_format::serialize(l));

  if (!g_store.replace_all(lines)) {
    // In-memory is still correct, so the device keeps working today; it just
    // won't survive a reboot. Worth flagging loudly.
    Serial.printf("[roster] WARNING: cached %u learners in RAM but failed to "
                  "persist — next boot will start empty\n",
                  static_cast<unsigned>(g_items.size()));
    return false;
  }

  Serial.printf("[roster] cached %u learners (memory + disk)\n",
                static_cast<unsigned>(g_items.size()));
  return true;
}

const pb_client::LearnerRow* lookup_by_uid(const std::string& uid_hex) {
  Lock lk;
  // Normalise both sides: nfc.cpp emits lowercase, but NFC_ID is free text in
  // the dashboard and an uppercase value would otherwise never match.
  const std::string want = roster_format::normalize_uid(uid_hex);
  if (want.empty()) return nullptr;

  for (const auto& l : g_items) {
    // Skip learners with no card issued — an empty stored UID must never
    // match an empty scan and hand back an arbitrary learner.
    if (!l.nfc_id.empty() && l.nfc_id == want) return &l;
  }
  return nullptr;
}

bool ready() {
  Lock lk;
  return g_ready;
}

int count() {
  Lock lk;
  return static_cast<int>(g_items.size());
}

std::time_t age_seconds() {
  Lock lk;
  if (g_loaded_at == 0) return -1;
  const std::time_t now = time_sync::now_unix();
  return now > g_loaded_at ? now - g_loaded_at : 0;
}

void debug_dump(int max_items) {
  Lock lk;
  if (g_items.empty()) {
    Serial.println("[roster] empty");
    return;
  }
  int shown = 0;
  for (const auto& l : g_items) {
    if (shown >= max_items) break;
    Serial.printf("[roster]   %-24s uid=%s\n", l.name.c_str(),
                  l.nfc_id.empty() ? "(no card)" : l.nfc_id.c_str());
    ++shown;
  }
  const int rest = static_cast<int>(g_items.size()) - shown;
  if (rest > 0) Serial.printf("[roster]   ... and %d more\n", rest);
}

}  // namespace llattender::roster

#endif  // LLATTENDER_NATIVE_BUILD
