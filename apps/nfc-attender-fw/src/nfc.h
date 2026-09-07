#pragma once

// PN532 wrapper. Mirrors the absent→present edge detection and
// last-UID dedupe in apps/nfc-attender/src-tauri/src/main.rs:74-97.

#include <string>

namespace llattender::nfc {

// Initialise the PN532 over I2C. Returns false on probe failure.
bool init();

// Enumerate every responding address on the I2C bus to Serial. Runs
// automatically when init() fails, because a device wedged in a boot loop
// never reaches the serial console — the failure has to describe itself.
void scan_i2c();

// Electrical check of SDA/SCL before the I2C peripheral claims the pins.
// Reports whether anything external holds each line high, which separates
// "module is wired and powered but not talking I2C" from "the line isn't
// connected to a powered module at all" — a distinction the address scan
// cannot make, since both look like an empty bus. MUST be called before
// Wire.begin(), i.e. before ui::init().
void probe_i2c_lines();

// Poll the reader once. If a new card has been presented since the last call
// (absent→present transition AND uid != previous uid), writes the lowercase
// hex UID into `out` and returns true. Otherwise returns false.
//
// Called from nfc_task on a 50 ms loop (main.cpp). The PN532's IRQ line is
// wired to nothing in this build — Adafruit_PN532 is constructed with
// irq=-1 — so polling is the only path, not a placeholder for one.
bool poll_uid(std::string& out_uid_hex);

}  // namespace llattender::nfc
