#pragma once

// Piezo buzzer feedback. Driven via Arduino tone() on a single GPIO; works
// for both passive (PWM generates the audible signal) and active (PWM also
// turns the internal oscillator on/off) buzzers.

#include "ui.h"

namespace llattender::buzzer {

bool init();

// Low-level: synchronous beep at frequency for duration_ms. Blocks the
// caller — use only from the UI task.
void beep(int freq_hz, int duration_ms);

// High-level cue matching a UI event. No-op for events that don't have
// a sound (Idle, Boot, etc.).
void cue(ui::Event ev);

}  // namespace llattender::buzzer
