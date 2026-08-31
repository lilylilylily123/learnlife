#pragma once

// Over-the-air firmware updates over the local network.
//
// ── WHY ──────────────────────────────────────────────────────────────────
//
// Without this, every firmware fix means carrying a laptop and a USB cable to
// each device and opening the enclosure — which for a screwed-shut box on a
// front desk is enough friction that fixes simply don't get deployed. The
// Tauri app it replaces already updates itself; the firmware should too.
//
// It also de-risks the CA pinning that lands later in this phase. If
// PocketHost ever changes certificate issuer, a device with a pinned CA and no
// OTA is a device that has to be physically opened. Shipping OTA first means
// that becomes a push instead.
//
// ── SECURITY ─────────────────────────────────────────────────────────────
//
// An unauthenticated OTA port on a school network is a remote code execution
// hole that any student on the WiFi could find with a port scan. So OTA is
// only enabled when a password has been provisioned, and ArduinoOTA is given
// the MD5 of that password rather than the password itself.
//
// This is LAN-only by design — the device does not fetch updates from the
// internet. Someone has to be on the school network and know the password.
//
// ── USAGE ────────────────────────────────────────────────────────────────
//
//   pio run -e esp32dev_ota -t upload
//
// with the hostname and password set in platformio.ini (or passed with
// --upload-port / --auth). The device's hostname is printed at boot and shown
// by the `ota` serial command.

#include <string>

namespace llattender::ota {

// Start the OTA listener. No-op (with a log line) when `password` is empty,
// so a device that has never been given one simply doesn't expose the port.
//
// `device_id` becomes the mDNS hostname: ll-attender-<id>.local
bool init(const std::string& device_id, const std::string& password);

// Pump the OTA handler. Call from the network task; cheap when idle.
void tick();

// True while an update is being received. The NFC path checks this and stops
// accepting scans — a tap that arrives mid-flash would be acknowledged on the
// OLED and then lost by the reboot, which is worse than not reading the card.
bool in_progress();

// Hostname the device is reachable at, for logs and the `ota` command.
std::string hostname();

}  // namespace llattender::ota
