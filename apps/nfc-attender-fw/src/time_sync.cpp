#include "time_sync.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>
#include <time.h>

namespace llattender::time_sync {

// TODO: DS3231 + NTP. For now use the ESP32's internal clock so the rest of
// the firmware has a working timebase from the moment NTP first succeeds.

namespace {
int g_override_hour = -1;
int g_override_min  = -1;
int g_override_wday = -1;
}  // namespace

bool init() {
  // The state machine reads `tm_hour` and `tm_wday` against thresholds defined
  // in school-local time (10:01 late, 13–14 lunch, 16:59 checkout, Friday=5).
  // Without a TZ set, localtime() returns UTC and those thresholds shift by
  // an hour — letting late tappers slip through. Default to Europe/Madrid
  // (the deployment locale per docs/capstone-notes.md); reconfigurable from
  // NVS in a later phase.
  // POSIX TZ string: `CET-1CEST,M3.5.0,M10.5.0/3` =
  //   standard CET (UTC+1), summer CEST (UTC+2), DST starts last Sun of March
  //   ends last Sun of October at 03:00.
  setenv("TZ", "CET-1CEST,M3.5.0,M10.5.0/3", /*overwrite=*/1);
  tzset();
  Serial.println("[time] init (TZ=Europe/Madrid; RTC stub)");
  return true;
}

bool sync_ntp() {
  // Default pool servers; timezone offset zero (we work in UTC and convert
  // for display). The school's local TZ should be set via configTime once the
  // captive-portal exposes a TZ field.
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  // configTime() resets the TZ env to UTC — re-apply our Madrid setting so
  // localtime() converts correctly.
  setenv("TZ", "CET-1CEST,M3.5.0,M10.5.0/3", /*overwrite=*/1);
  tzset();
  // Wait briefly for time to be set. Real implementation should be in a task.
  for (int i = 0; i < 20; ++i) {
    if (now_unix() > 1700000000) return true;
    delay(100);
  }
  return false;
}

std::time_t now_unix() {
  std::time_t real = ::time(nullptr);
  if (g_override_hour < 0) return real;
  // Shift the unix epoch by the difference between real and overridden local
  // time so the ISO timestamps the state machine writes to PB also reflect
  // the simulated clock. Without this, timestamps stay at real wall time and
  // the test rows look wrong in the admin UI.
  std::tm tm{};
  localtime_r(&real, &tm);
  long real_offset_today =
      tm.tm_hour * 3600L + tm.tm_min * 60L + tm.tm_sec;
  long override_offset_today =
      g_override_hour * 3600L + g_override_min * 60L;
  return real + (override_offset_today - real_offset_today);
}

void set_time_override(int hour, int minute, int wday) {
  g_override_hour = hour;
  g_override_min  = minute;
  g_override_wday = wday;
}

void clear_time_override() {
  g_override_hour = -1;
  g_override_min  = -1;
  g_override_wday = -1;
}

bool has_time_override() { return g_override_hour >= 0; }

std::tm now_local() {
  std::time_t t = now_unix();  // already shifted when an override is active
  std::tm out{};
  // Use localtime_r so tm_wday is populated. Caller should have called
  // setenv("TZ", ...) once during boot.
  localtime_r(&t, &out);
  // The wday override is the one piece that can't be derived from a shifted
  // unix time — apply it explicitly so e.g. Friday-only check-out rules can
  // be tested on a real Monday.
  if (g_override_wday >= 0) out.tm_wday = g_override_wday;
  return out;
}

}  // namespace llattender::time_sync

#endif  // LLATTENDER_NATIVE_BUILD
