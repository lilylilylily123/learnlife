#pragma once

// Device configuration: WiFi credentials, PocketBase endpoint and account.
// Persisted in NVS (Preferences) so it survives an OTA + LittleFS wipe.
// Captive-portal provisioning runs on first boot or when the boot button
// is held during power-up.

#include <ctime>
#include <string>

namespace llattender::config {

struct DeviceConfig {
  std::string wifi_ssid;
  std::string wifi_pw;
  std::string pb_url = "https://learnlife.pockethost.io";
  std::string pb_email;
  std::string pb_password;
  std::string device_id;        // last 4 of MAC, populated on first boot
  std::string token;            // cached PB auth token
  std::time_t token_expires = 0;
};

bool load(DeviceConfig& out);
bool save(const DeviceConfig& c);

// True if `wifi_ssid` and `pb_email` are populated — i.e. provisioning is done.
bool is_provisioned();

// Run the captive-portal provisioning flow. Blocks until the user submits
// valid credentials or the device is power-cycled. Persists on success.
bool run_provisioning();

// Wipe every key in the device namespace. Used by the factory-reset hotkey
// so the next boot drops back into provisioning mode.
bool wipe_nvs();

// Watch Serial for ~2s at boot for a "RESET\n" command. Wipes NVS + reboots
// if seen, otherwise returns. Cheap escape hatch for re-provisioning.
void check_factory_reset_command();

}  // namespace llattender::config
