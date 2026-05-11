#include "roster.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>

namespace llattender::roster {

namespace {
std::vector<pb_client::LearnerRow> g_items;
bool g_ready = false;
}  // namespace

bool init() {
  // TODO: load /roster.json from LittleFS.
  Serial.println("[roster] init (stub)");
  return true;
}

bool replace(const std::vector<pb_client::LearnerRow>& items) {
  g_items = items;
  g_ready = true;
  // TODO: persist to /roster.json.
  Serial.printf("[roster] cached %u learners\n",
                static_cast<unsigned>(g_items.size()));
  return true;
}

const pb_client::LearnerRow* lookup_by_uid(const std::string& uid_hex) {
  for (const auto& l : g_items) {
    if (l.nfc_id == uid_hex) return &l;
  }
  return nullptr;
}

bool ready() { return g_ready; }

}  // namespace llattender::roster

#endif  // LLATTENDER_NATIVE_BUILD
