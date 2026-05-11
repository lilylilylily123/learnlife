#include "nfc.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>
#include <Adafruit_PN532.h>
#include <Wire.h>

namespace llattender::nfc {

namespace {
// Default I2C IRQ/RESET pins are unused for I2C bus mode (-1 disables them).
Adafruit_PN532 g_pn532(/*irq=*/-1, /*reset=*/-1, &Wire);

// Time-based UID debounce. The PN532 occasionally returns "no target" for one
// poll while a card is still on the reader; the previous edge-only debounce
// would then count the next detection as a fresh tap, producing duplicate
// scans. Suppress same-UID emissions within this window regardless of any
// in-between "not present" reads.
constexpr uint32_t kDebounceMs = 1500;
std::string g_last_uid;
uint32_t g_last_emit_ms = 0;
}  // namespace

bool init() {
  Wire.begin();  // SDA=21, SCL=22 by default on ESP32 DevKitC
  g_pn532.begin();
  uint32_t version = g_pn532.getFirmwareVersion();
  if (!version) {
    Serial.println("[nfc] PN532 not found on I2C bus");
    return false;
  }
  Serial.printf("[nfc] PN532 firmware %lu\n", static_cast<unsigned long>(version));
  g_pn532.SAMConfig();
  return true;
}

bool poll_uid(std::string& out_uid_hex) {
  uint8_t uid[7] = {0};
  uint8_t uid_len = 0;
  // 50 ms timeout — short enough that the task can still service shutdown signals.
  bool found = g_pn532.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uid_len, 50);
  if (!found) return false;

  // Build lowercase hex string to match the Rust hex::encode output.
  char buf[2 * 7 + 1];
  for (uint8_t i = 0; i < uid_len; ++i) {
    snprintf(buf + 2 * i, 3, "%02x", uid[i]);
  }
  std::string this_uid(buf, 2 * uid_len);

  const uint32_t now_ms = millis();
  if (this_uid == g_last_uid && (now_ms - g_last_emit_ms) < kDebounceMs) {
    return false;  // same card recently emitted — suppress regardless of any
                   // "not present" blips in between
  }
  g_last_uid = this_uid;
  g_last_emit_ms = now_ms;
  out_uid_hex = std::move(this_uid);
  return true;
}

}  // namespace llattender::nfc

#endif  // LLATTENDER_NATIVE_BUILD
