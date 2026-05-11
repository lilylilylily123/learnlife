#pragma once

// PN532 wrapper. Mirrors the absent→present edge detection and
// last-UID dedupe in apps/nfc-attender/src-tauri/src/main.rs:74-97.

#include <string>

namespace llattender::nfc {

// Initialise the PN532 over I2C. Returns false on probe failure.
bool init();

// Poll the reader once. If a new card has been presented since the last call
// (absent→present transition AND uid != previous uid), writes the lowercase
// hex UID into `out` and returns true. Otherwise returns false.
//
// Designed to be called from the nfc_task in a tight loop with a small delay,
// or from an IRQ-driven path in a future revision.
bool poll_uid(std::string& out_uid_hex);

}  // namespace llattender::nfc
