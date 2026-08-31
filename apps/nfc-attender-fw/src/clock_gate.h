#pragma once

// Whether the device is allowed to record attendance yet.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────
//
// This build has no DS3231 (see hardware/enclosure/params.scad,
// `include_rtc`), so the ESP32 has no battery-backed clock. At power-on its
// system time is 1970-01-01 and stays there until NTP succeeds, which needs
// WiFi to be up.
//
// That matters more here than in most projects, because the attendance rules
// are entirely time-of-day driven (src/state_machine.cpp):
//
//   - 10:01 is the present/late boundary
//   - 13:00-14:00 is the lunch window
//   - 14:00-17:00 is the locked window
//   - 17:00 (14:00 on Friday) is check-out
//
// A device that boots at 09:55 while the router is still coming up believes
// it is 00:00 on 1 January 1970. Every threshold comparison then returns the
// wrong answer — everyone tapping gets silently marked `present` when some of
// them are late — and the ISO timestamp written to PocketBase is in 1970.
// Those rows then have to be found and fixed by hand.
//
// So: when the clock is not trusted, refuse to act. The device shows
// "Waiting for clock" and records nothing. Being visibly unavailable for the
// first thirty seconds after power-on is much cheaper than being confidently
// wrong all morning.
//
// This is also a hard prerequisite for TLS certificate pinning. Once a CA is
// pinned, mbedTLS enforces the certificate's `notBefore` date, and a 1970
// clock fails every handshake — so pinning cannot land before this does.
//
// ── WHY A SEPARATE HEADER FOR ONE FUNCTION ───────────────────────────────
//
// It is a policy decision, so it gets a name, one home, and unit tests,
// rather than being an `if` buried in a FreeRTOS task where it can't be
// tested. Header-only and `inline` because there is no state to hold — this
// keeps it out of platformio.ini's `build_src_filter` allow-list, which only
// needs entries for modules with a .cpp.

namespace llattender::clock_gate {

// `ntp_synced`      — the real system clock has been set from NTP at least
//                     once this boot (time_sync::is_synced()).
// `override_active` — the operator has explicitly set a time through the
//                     serial console's `t HH:MM [W]` command
//                     (time_sync::has_time_override()).
//
// The override is honoured deliberately: it is the mechanism used to exercise
// the state machine on the bench without waiting for real time, and it must
// keep working with no network. It means "I, the operator, am asserting the
// time", which is exactly the assurance the gate is looking for.
inline bool may_write_attendance(bool ntp_synced, bool override_active) {
  return ntp_synced || override_active;
}

}  // namespace llattender::clock_gate
