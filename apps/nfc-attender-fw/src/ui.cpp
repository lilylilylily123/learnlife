#include "ui.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>

namespace llattender::ui {

// TODO: wire SSD1306 + RGB LED + buzzer. For now log to serial so the
// firmware boots and the rest of the system can be exercised.

bool init() {
  Serial.println("[ui] init (stub)");
  return true;
}

void show(Event ev, const char* learner_name) {
  Serial.printf("[ui] event=%d name=%s\n", static_cast<int>(ev),
                learner_name ? learner_name : "");
}

void set_network_error(bool on) {
  Serial.printf("[ui] network_error=%d\n", on ? 1 : 0);
}

}  // namespace llattender::ui

#endif  // LLATTENDER_NATIVE_BUILD
