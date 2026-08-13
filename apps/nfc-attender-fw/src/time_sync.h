#pragma once

// NTP + DS3231 RTC. The RTC is the source of truth for timestamps so a long
// offline stretch still produces correct wall-clock times after reconnect.

#include <ctime>

namespace llattender::time_sync {

bool init();          // bring up the RTC and seed the system clock from it
bool sync_ntp();      // pull from NTP and write through to the DS3231

std::time_t now_unix();
std::tm now_local();  // local-time tm with tm_wday populated

// True once the real system clock has been set from NTP this boot.
//
// There is no DS3231 in this build, so before the first successful sync the
// ESP32 believes it is 1970-01-01 and every time-of-day comparison in the
// state machine is wrong. Callers pair this with has_time_override() through
// clock_gate::may_write_attendance() to decide whether recording attendance
// is safe at all — see src/clock_gate.h.
//
// Latches: once true it stays true for the rest of the boot. A later NTP
// failure means the clock has drifted slightly, not that it has reverted to
// 1970, and refusing to work over a transient sync failure would be worse
// than a few seconds of drift.
bool is_synced();

// Test-mode time travel. When set, now_local() returns a tm with the
// overridden hour/min (and optional weekday); now_unix() is unchanged so PB
// timestamps remain real. Used by the serial command console to exercise the
// state machine at different times of day without waiting for real time.
void set_time_override(int hour, int minute, int wday = -1);
void clear_time_override();
bool has_time_override();

}  // namespace llattender::time_sync
