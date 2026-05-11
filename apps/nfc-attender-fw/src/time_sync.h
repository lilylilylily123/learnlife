#pragma once

// NTP + DS3231 RTC. The RTC is the source of truth for timestamps so a long
// offline stretch still produces correct wall-clock times after reconnect.

#include <ctime>

namespace llattender::time_sync {

bool init();          // bring up the RTC and seed the system clock from it
bool sync_ntp();      // pull from NTP and write through to the DS3231

std::time_t now_unix();
std::tm now_local();  // local-time tm with tm_wday populated

// Test-mode time travel. When set, now_local() returns a tm with the
// overridden hour/min (and optional weekday); now_unix() is unchanged so PB
// timestamps remain real. Used by the serial command console to exercise the
// state machine at different times of day without waiting for real time.
void set_time_override(int hour, int minute, int wday = -1);
void clear_time_override();
bool has_time_override();

}  // namespace llattender::time_sync
