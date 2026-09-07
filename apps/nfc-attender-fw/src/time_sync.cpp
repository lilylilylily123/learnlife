#include "time_sync.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>
#include <time.h>

namespace llattender::time_sync {

// Timebase is NTP over WiFi plus the ESP32's internal clock. There is
// deliberately no DS3231 fitted (README.md "Hardware — not fitted"; the clock
// gate in clock_gate.h covers the boot window instead, by refusing to record
// taps until the clock is trustworthy).

namespace {
int g_override_hour = -1;
int g_override_min  = -1;
int g_override_wday = -1;

// Any real clock reading is far above this; anything below it means the
// system clock has never been set and is still sitting near the 1970 epoch.
// 1700000000 is 2023-11-14, comfortably before this device existed and
// comfortably after 1970.
constexpr std::time_t kMinValidEpoch = 1700000000;

// Latched once NTP has produced a plausible clock. See is_synced().
bool g_synced = false;
}  // namespace

bool init() {
  // The state machine reads `tm_hour` and `tm_wday` against thresholds defined
  // in school-local time (10:01 late, 13–14 lunch, 17:00 checkout, Friday=5).
  // Without a TZ set, localtime() returns UTC and those thresholds shift by
  // an hour — letting late tappers slip through. Default to Europe/Madrid
  // (the deployment locale per capstone-notes.md at the repo root); still
  // compiled in rather than reconfigurable from NVS, so a second site in
  // another timezone is a rebuild. Known gap; see docs/OPERATIONS.md.
  // POSIX TZ string: `CET-1CEST,M3.5.0,M10.5.0/3` =
  //   standard CET (UTC+1), summer CEST (UTC+2), DST starts last Sun of March
  //   ends last Sun of October at 03:00.
  setenv("TZ", "CET-1CEST,M3.5.0,M10.5.0/3", /*overwrite=*/1);
  tzset();
  Serial.println("[time] init (TZ=Europe/Madrid)");
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
    if (is_synced()) return true;
    delay(100);
  }
  Serial.println("[time] NTP sync failed — clock still untrusted");
  return false;
}

bool is_synced() {
  if (g_synced) return true;
  // Deliberately ::time() rather than now_unix(): this asks whether the REAL
  // system clock has been set, and now_unix() applies the test-mode override
  // shift, which would let `t 09:30` on a 1970 clock look like a genuine sync.
  // The override is accounted for separately, in clock_gate.
  if (::time(nullptr) > kMinValidEpoch) {
    g_synced = true;
    Serial.println("[time] clock trusted (NTP acquired)");
    return true;
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
