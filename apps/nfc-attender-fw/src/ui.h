#pragma once

// OLED + RGB LED + buzzer feedback. The UI feedback grid is documented in
// /Users/lily/.claude/plans/goofy-spinning-leaf.md.

#include <string>

namespace llattender::ui {

enum class Event {
  Boot,
  Idle,
  CheckInPresent,
  CheckInLate,
  LunchOut,
  LunchIn,
  LunchInLate,
  CheckOut,
  AlreadyDone,    // both time_in and time_out are set for today
  AlreadyIn,      // already checked in, day still in progress (no checkout yet)
  ScanLocked,     // 14:00–17:00 reject (state machine returned Locked)
  UnknownCard,
  ScanBusy,       // scan queue full — the tap was NOT recorded, tap again.
                  // Never silent: a learner who gets no feedback walks away
                  // believing they signed in.
  WaitingClock,   // tapped before NTP set the clock — nothing was recorded.
                  // Without a DS3231 the device boots believing it is 1970,
                  // and 10:01 is the present/late boundary, so acting on an
                  // untrusted clock would silently mis-mark everyone. See
                  // src/clock_gate.h.
  Queued,         // appended after one of the action events when offline
  NetworkError,   // persistent indicator until cleared
};

bool init();

// Show feedback for an event. `learner_name` is shown on the OLED when
// applicable (i.e. all the action events). Pass nullptr/empty for events
// that don't need a name.
void show(Event ev, const char* learner_name = nullptr);

// Toggle the persistent network-error indicator. Layered on top of whatever
// is currently being displayed.
void set_network_error(bool on);

// How many scans are waiting to reach PocketBase. Shown on the idle screen
// when non-zero.
//
// This is the one operational signal a guide can act on: a number that keeps
// climbing means the device is recording taps but not delivering them, which
// otherwise looks identical to everything working — the learner still sees
// their name and a green verdict.
void set_pending_count(int n);

// Show the setup-mode screen: the AP name and its per-boot password.
//
// Persistent — no timeout — because it must stay readable for as long as it
// takes someone to type it into a phone. The OLED is the only way to read the
// password without a serial cable, which is the whole point during a field
// setup.
void show_provisioning(const std::string& ssid, const std::string& password);

// Called periodically from the UI task to advance time-based transitions
// (auto-revert action feedback to idle, redraw the idle clock, blink the
// network-error glyph). Cheap when nothing changed.
void tick();

}  // namespace llattender::ui
