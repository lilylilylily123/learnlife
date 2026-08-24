#include "ota.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>
#include <ArduinoOTA.h>
#include <ESPmDNS.h>
#include <MD5Builder.h>

#include "ui.h"

namespace llattender::ota {

namespace {

bool g_enabled = false;
bool g_in_progress = false;
std::string g_hostname;

// ArduinoOTA wants the MD5 of the password, not the password. Hashing here
// means the plaintext is only ever held briefly during init() rather than
// living in a static for the lifetime of the process.
std::string md5_hex(const std::string& s) {
  MD5Builder md5;
  md5.begin();
  // MD5Builder::add takes a non-const pointer even though it only reads.
  md5.add(reinterpret_cast<uint8_t*>(const_cast<char*>(s.data())), s.size());
  md5.calculate();
  return std::string(md5.toString().c_str());
}

}  // namespace

bool init(const std::string& device_id, const std::string& password) {
  if (password.empty()) {
    // Deliberately fail closed. An OTA port with no authentication on a school
    // WiFi is remote code execution for anyone who runs a port scan; being
    // un-updatable is the lesser problem.
    Serial.println("[ota] no OTA password provisioned — OTA disabled");
    return false;
  }

  std::string id = device_id;
  if (id.empty()) id = "unknown";
  g_hostname = "ll-attender-" + id;

  ArduinoOTA.setHostname(g_hostname.c_str());
  ArduinoOTA.setPasswordHash(md5_hex(password).c_str());

  ArduinoOTA.onStart([]() {
    g_in_progress = true;
    // U_SPIFFS here means the filesystem image, not the app. Worth
    // distinguishing in the log: a filesystem update wipes the queue and
    // roster, an app update does not.
    const bool fs = ArduinoOTA.getCommand() == U_SPIFFS;
    Serial.printf("[ota] update starting (%s)\n", fs ? "filesystem" : "firmware");
    ui::show(ui::Event::Boot, fs ? "Updating files..." : "Updating...");
  });

  ArduinoOTA.onProgress([](unsigned int done, unsigned int total) {
    static int last_pct = -1;
    const int pct = total ? static_cast<int>((done * 100ULL) / total) : 0;
    // Only repaint on a change, and only every 5% — the OLED is on the same
    // I2C bus as the NFC reader, and redrawing it hundreds of times during a
    // flash would slow the transfer for no benefit.
    if (pct / 5 != last_pct / 5) {
      last_pct = pct;
      char line[24];
      std::snprintf(line, sizeof(line), "Updating %d%%", pct);
      ui::show(ui::Event::Boot, line);
      Serial.printf("[ota] %d%%\n", pct);
    }
  });

  ArduinoOTA.onEnd([]() {
    Serial.println("[ota] update complete — rebooting");
    ui::show(ui::Event::Boot, "Rebooting...");
    // No g_in_progress = false: the device reboots from here, and clearing it
    // would briefly let scans through in the moments before that happens.
  });

  ArduinoOTA.onError([](ota_error_t err) {
    g_in_progress = false;
    const char* what = "unknown";
    switch (err) {
      case OTA_AUTH_ERROR:    what = "auth failed (wrong password)"; break;
      case OTA_BEGIN_ERROR:   what = "begin failed (image too big for the slot?)"; break;
      case OTA_CONNECT_ERROR: what = "connect failed"; break;
      case OTA_RECEIVE_ERROR: what = "receive failed"; break;
      case OTA_END_ERROR:     what = "end failed (bad image?)"; break;
    }
    Serial.printf("[ota] ERROR: %s\n", what);
    ui::show(ui::Event::Idle);
  });

  ArduinoOTA.begin();

  // Advertise over mDNS so the uploader can find the device by name instead
  // of chasing a DHCP address that changes.
  if (MDNS.begin(g_hostname.c_str())) {
    MDNS.addService("arduino", "tcp", 3232);
  } else {
    Serial.println("[ota] mDNS failed — use the IP address instead");
  }

  g_enabled = true;
  Serial.printf("[ota] ready at %s.local (password required)\n",
                g_hostname.c_str());
  return true;
}

void tick() {
  if (!g_enabled) return;
  ArduinoOTA.handle();
}

bool in_progress() { return g_in_progress; }

std::string hostname() { return g_hostname; }

}  // namespace llattender::ota

#endif  // LLATTENDER_NATIVE_BUILD
