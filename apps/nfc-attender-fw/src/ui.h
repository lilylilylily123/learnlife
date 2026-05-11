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

// Called periodically from the UI task to advance time-based transitions
// (auto-revert action feedback to idle, redraw the idle clock, blink the
// network-error glyph). Cheap when nothing changed.
void tick();

}  // namespace llattender::ui
