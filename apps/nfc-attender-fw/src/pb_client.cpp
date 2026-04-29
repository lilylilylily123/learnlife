#include "pb_client.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>

namespace llattender::pb_client {

// TODO: HTTPClient + WiFiClientSecure for HTTPS calls. ArduinoJson for
// parsing list/getOne responses. Token cache lives in config.cpp.

bool login() {
  Serial.println("[pb] login (stub)");
  return false;
}

bool fetch_roster(std::vector<LearnerRow>& out) {
  (void)out;
  Serial.println("[pb] fetch_roster (stub)");
  return false;
}

bool ensure_today_row(const std::string& learner_id,
                      const std::string& date,
                      AttendanceRow& out, bool& created) {
  (void)learner_id;
  (void)date;
  (void)out;
  created = false;
  Serial.println("[pb] ensure_today_row (stub)");
  return false;
}

bool patch_attendance(const std::string& id, const std::string& fields_json) {
  (void)id;
  (void)fields_json;
  Serial.println("[pb] patch_attendance (stub)");
  return false;
}

}  // namespace llattender::pb_client

#endif  // LLATTENDER_NATIVE_BUILD
