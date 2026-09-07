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

// Does something external hold this line high? Drive it low to discharge the
// line capacitance, release it as a no-pull input, then look. An external
// pull-up (the PN532 carries its own) recovers in well under a microsecond —
// 4.7k into ~100 pF is a ~470 ns time constant. A floating line has only
// nanoamp leakage to charge it and stays low for milliseconds. 10 us is
// therefore ~20 time constants of margin on one side and nowhere near enough
// on the other, so the reading is unambiguous.
bool line_has_pullup(uint8_t pin) {
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  delayMicroseconds(50);
  pinMode(pin, INPUT);  // no internal pull — we want the external answer only
  delayMicroseconds(10);
  const bool high = digitalRead(pin) == HIGH;
  pinMode(pin, INPUT);
  return high;
}

// Can the ESP32's own ~45k pull-up lift this line? A floating or merely
// disconnected line goes high; one that stays low is being held there by
// something — a short to ground, reversed power at the module, or a bent pin
// bridging to a GND neighbour. Without this, "no external pullup" covers both
// an open circuit and a dead short, which need opposite fixes.
bool line_rises_on_internal_pullup(uint8_t pin) {
  pinMode(pin, INPUT_PULLUP);
  delayMicroseconds(50);
  const bool high = digitalRead(pin) == HIGH;
  pinMode(pin, INPUT);
  return high;
}

// Every pin on the 30-pin DevKit that can be driven low and released safely
// while the firmware is running. Excluded: 34/35/36/39 (input-only, so the
// line can never be discharged and the test is meaningless), 1/3 (UART0 —
// driving them destroys this very log), 6-11 (SPI flash, not brought out),
// and 0 (its onboard boot-button pull-up would always read as present).
constexpr uint8_t kSweepPins[] = {2,  4,  5,  12, 13, 14, 16, 17, 18,
                                  19, 21, 22, 23, 25, 26, 27, 32, 33};

// Which pins does something external hold high? If the peripherals are wired
// correctly but the DevKit sits offset or reversed in the breakout headers,
// the module's pull-ups are still on the bus — just landing on GPIOs other
// than 21/22. Two unexpected hits here name the actual mapping and turn a
// "nothing is connected" dead end into an off-by-N seating error.
void sweep_pullups() {
  Serial.println("[i2c] sweeping every safe GPIO for external pullups...");
  int found = 0;
  for (uint8_t pin : kSweepPins) {
    if (!line_has_pullup(pin)) continue;
    Serial.printf("[i2c]   GPIO%u pulled up externally%s\n",
                  static_cast<unsigned>(pin),
                  (pin == SDA || pin == SCL) ? " (expected I2C line)" : "");
    ++found;
  }
  if (found == 0) {
    Serial.println("[i2c]   none — no powered module is reaching ANY GPIO, so "
                   "the break is upstream of the pin headers (DevKit not "
                   "seated in the breakout, or no 3V3 to the peripherals)");
  }
}

// Live view of both lines, so a cold joint can be diagnosed by hand. Pressing
// a press-fit or unwetted header restores contact for as long as the pressure
// lasts, but the one-shot probe above samples ~700 ms into boot — far too
// early to press and reset at the same time. This holds the window open and
// reports every transition, so "wiggle it and watch" becomes a valid test.
void watch_lines(uint32_t window_ms) {
  Serial.printf("[i2c] watching lines for %us — press or wiggle each module's "
                "header now, one at a time\n",
                static_cast<unsigned>(window_ms / 1000));
  bool last_sda = false, last_scl = false, first = true;
  const uint32_t started = millis();
  while (millis() - started < window_ms) {
    const bool s = line_has_pullup(SDA);
    const bool c = line_has_pullup(SCL);
    if (first || s != last_sda || c != last_scl) {
      Serial.printf("[i2c]   +%5lums SDA=%s SCL=%s%s\n",
                    static_cast<unsigned long>(millis() - started),
                    s ? "present" : "ABSENT", c ? "present" : "ABSENT",
                    (s && c) ? "   <-- CONTACT" : "");
      last_sda = s;
      last_scl = c;
      first = false;
    }
    delay(40);
  }
  Serial.println("[i2c] watch window closed");
}
}  // namespace

void probe_i2c_lines() {
  const bool sda = line_has_pullup(SDA);
  const bool scl = line_has_pullup(SCL);
  Serial.printf("[i2c] line pullups: SDA(D%u)=%s SCL(D%u)=%s\n",
                static_cast<unsigned>(SDA), sda ? "present" : "ABSENT",
                static_cast<unsigned>(SCL), scl ? "present" : "ABSENT");
  if (sda && scl) return;

  // No external pullup. Separate "nothing is there" from "something is holding
  // the line down", because the first is a power/wiring gap and the second is
  // a short or a reversed module.
  for (uint8_t pin : {static_cast<uint8_t>(SDA), static_cast<uint8_t>(SCL)}) {
    if (line_has_pullup(pin)) continue;
    Serial.printf("[i2c]   D%u: %s\n", static_cast<unsigned>(pin),
                  line_rises_on_internal_pullup(pin)
                      ? "open circuit — no powered module on this line"
                      : "HELD LOW — short to GND, reversed VCC/GND, or a bent "
                        "pin bridging a neighbour");
  }
  sweep_pullups();
  // 10 s, not 60: long enough to press a suspect header and see it, short
  // enough that a genuinely absent module doesn't hold every boot hostage.
  watch_lines(10000);
}

void scan_i2c() {
  Serial.println("[i2c] scanning bus...");
  int found = 0;
  for (uint8_t addr = 0x08; addr < 0x78; ++addr) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() != 0) continue;
    const char* who = "";
    if (addr == PN532_I2C_ADDRESS) who = " (PN532)";
    else if (addr == 0x3C || addr == 0x3D) who = " (SSD1306)";
    Serial.printf("[i2c] 0x%02X%s\n", static_cast<unsigned>(addr), who);
    ++found;
  }
  if (found == 0) {
    Serial.println("[i2c] no devices — check SDA=D21, SCL=D22, 3V3, GND");
  }
}

bool init() {
  Wire.begin();  // SDA=21, SCL=22 by default on ESP32 DevKitC
  // No scan here. It runs from setup() before provisioning can block the boot,
  // and it must precede this probe regardless: a failed PN532 probe leaves the
  // ESP32 I2C peripheral wedged, after which nothing ACKs and a scan would
  // report an empty bus, blaming the shared wiring for a fault confined to
  // the PN532.
  g_pn532.begin();
  uint32_t version = g_pn532.getFirmwareVersion();
  if (!version) {
    Serial.println("[nfc] PN532 not found on I2C bus — see the scan above");
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
