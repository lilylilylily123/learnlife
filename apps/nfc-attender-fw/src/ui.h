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
  AlreadyDone,
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

}  // namespace llattender::ui
