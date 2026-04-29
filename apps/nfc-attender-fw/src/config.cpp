#include "config.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>
#include <Preferences.h>

namespace llattender::config {

// TODO: full captive portal. For now load/save round-trips through Preferences
// so wiring through main.cpp works.

namespace {
constexpr const char* kNs = "llattender";

void put_str(Preferences& p, const char* key, const std::string& v) {
  p.putString(key, v.c_str());
}
std::string get_str(Preferences& p, const char* key) {
  String v = p.getString(key, "");
  return std::string(v.c_str());
}
}  // namespace

bool load(DeviceConfig& out) {
  Preferences p;
  if (!p.begin(kNs, /*readOnly=*/true)) return false;
  out.wifi_ssid     = get_str(p, "wifi_ssid");
  out.wifi_pw       = get_str(p, "wifi_pw");
  std::string url   = get_str(p, "pb_url");
  if (!url.empty()) out.pb_url = url;
  out.pb_email      = get_str(p, "pb_email");
  out.pb_password   = get_str(p, "pb_password");
  out.device_id     = get_str(p, "device_id");
  out.token         = get_str(p, "token");
  out.token_expires = p.getULong64("tok_exp", 0);
  p.end();
  return true;
}

bool save(const DeviceConfig& c) {
  Preferences p;
  if (!p.begin(kNs, /*readOnly=*/false)) return false;
  put_str(p, "wifi_ssid",  c.wifi_ssid);
  put_str(p, "wifi_pw",    c.wifi_pw);
  put_str(p, "pb_url",     c.pb_url);
  put_str(p, "pb_email",   c.pb_email);
  put_str(p, "pb_password",c.pb_password);
  put_str(p, "device_id",  c.device_id);
  put_str(p, "token",      c.token);
  p.putULong64("tok_exp", c.token_expires);
  p.end();
  return true;
}

bool is_provisioned() {
  DeviceConfig c;
  if (!load(c)) return false;
  return !c.wifi_ssid.empty() && !c.pb_email.empty();
}

bool run_provisioning() {
  Serial.println("[config] run_provisioning (stub: not yet implemented)");
  // TODO: AP mode, captive portal at 192.168.4.1, validate WiFi + PB login,
  // save() on success and ESP.restart().
  return false;
}

}  // namespace llattender::config

#endif  // LLATTENDER_NATIVE_BUILD
