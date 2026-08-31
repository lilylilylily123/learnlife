#pragma once

// Firmware version, bumped by hand. There is no release pipeline: the
// deployment flow is a local `pio run` plus a USB or LAN OTA push, so a
// generated version would have nothing to generate from. Printed in the boot
// banner and by the `v` console command, and recorded in the device register
// at assembly (hardware/README.md step 11).
//
// Header-only, so it needs no build_src_filter entry — same reason
// clock_gate.h has none.

namespace llattender {
inline constexpr const char* kFirmwareVersion = "1.0.0";
}  // namespace llattender
