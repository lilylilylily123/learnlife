#include "time_sync.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>
#include <time.h>

namespace llattender::time_sync {

// TODO: DS3231 + NTP. For now use the ESP32's internal clock so the rest of
// the firmware has a working timebase from the moment NTP first succeeds.

bool init() {
  Serial.println("[time] init (stub: no RTC yet)");
  return true;
}

bool sync_ntp() {
  // Default pool servers; timezone offset zero (we work in UTC and convert
  // for display). The school's local TZ should be set via configTime once the
  // captive-portal exposes a TZ field.
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  // Wait briefly for time to be set. Real implementation should be in a task.
  for (int i = 0; i < 20; ++i) {
    if (now_unix() > 1700000000) return true;
    delay(100);
  }
  return false;
}

std::time_t now_unix() {
  return ::time(nullptr);
}

std::tm now_local() {
  std::time_t t = now_unix();
  std::tm out{};
  // Use localtime_r so tm_wday is populated. Caller should have called
  // setenv("TZ", ...) once during boot.
  localtime_r(&t, &out);
  return out;
}

}  // namespace llattender::time_sync

#endif  // LLATTENDER_NATIVE_BUILD
