#pragma once

// NTP + DS3231 RTC. The RTC is the source of truth for timestamps so a long
// offline stretch still produces correct wall-clock times after reconnect.

#include <ctime>

namespace llattender::time_sync {

bool init();          // bring up the RTC and seed the system clock from it
bool sync_ntp();      // pull from NTP and write through to the DS3231

std::time_t now_unix();
std::tm now_local();  // local-time tm with tm_wday populated

}  // namespace llattender::time_sync
