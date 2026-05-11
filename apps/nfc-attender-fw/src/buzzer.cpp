#include "buzzer.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>

namespace llattender::buzzer {

namespace {

constexpr int kPin = 25;

// Tones picked to be distinguishable by ear: higher = OK, lower = problem,
// fast double = late.
constexpr int kFreqOk = 2000;
constexpr int kFreqLow = 600;
constexpr int kFreqMid = 1200;

bool g_have_buzzer = false;

void beep_blocking(int freq, int ms) {
  tone(kPin, freq);
  delay(ms);
  noTone(kPin);
  // Pull line low so an active buzzer doesn't keep humming on residual charge.
  digitalWrite(kPin, LOW);
}

}  // namespace

bool init() {
  pinMode(kPin, OUTPUT);
  digitalWrite(kPin, LOW);
  g_have_buzzer = true;
  Serial.println("[buzzer] init ok (pin 25)");
  // Short startup chirp so the user knows the audio path works.
  beep_blocking(kFreqOk, 80);
  return true;
}

void beep(int freq_hz, int duration_ms) {
  if (!g_have_buzzer) return;
  beep_blocking(freq_hz, duration_ms);
}

void cue(ui::Event ev) {
  if (!g_have_buzzer) return;
  using E = ui::Event;
  switch (ev) {
    case E::CheckInPresent:
    case E::LunchIn:
    case E::CheckOut:
      beep_blocking(kFreqOk, 80);
      break;
    case E::CheckInLate:
    case E::LunchInLate:
      // Two quick chirps for late.
      beep_blocking(kFreqMid, 60);
      delay(60);
      beep_blocking(kFreqMid, 60);
      break;
    case E::LunchOut:
      beep_blocking(kFreqMid, 80);
      break;
    case E::UnknownCard:
      beep_blocking(kFreqLow, 250);
      break;
    case E::AlreadyDone:
      beep_blocking(kFreqMid, 40);
      break;
    case E::AlreadyIn:
      // Gentle ack — distinct from AlreadyDone, says "I see you but nothing
      // new to record".
      beep_blocking(kFreqMid, 60);
      break;
    case E::ScanLocked:
      // Two short low buzzes for "rejected" — distinct from the unknown-card
      // single low buzz and from the late check-in's two mid-tone chirps.
      beep_blocking(kFreqLow, 90);
      delay(60);
      beep_blocking(kFreqLow, 90);
      break;
    case E::Queued:
    case E::NetworkError:
    case E::Boot:
    case E::Idle:
      break;
  }
}

}  // namespace llattender::buzzer

#endif  // LLATTENDER_NATIVE_BUILD
