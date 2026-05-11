#include "config.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>

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

bool wipe_nvs() {
  Preferences p;
  if (!p.begin(kNs, /*readOnly=*/false)) return false;
  bool ok = p.clear();
  p.end();
  return ok;
}

void check_factory_reset_command() {
  // Watch Serial for ~2 seconds. If the user types "RESET" we wipe NVS and
  // reboot — next boot lands in AP-mode provisioning.
  Serial.println("[config] type 'RESET' within 2s to factory-reset");
  String buf;
  unsigned long start = millis();
  while (millis() - start < 2000) {
    while (Serial.available() > 0) {
      char c = Serial.read();
      if (c == '\r' || c == '\n') {
        buf.trim();
        if (buf.equalsIgnoreCase("RESET")) {
          Serial.println("[config] factory reset confirmed — wiping NVS");
          wipe_nvs();
          delay(200);
          ESP.restart();
        }
        buf = "";
      } else {
        buf += c;
        if (buf.length() > 16) buf = buf.substring(buf.length() - 16);
      }
    }
    delay(20);
  }
}

bool is_provisioned() {
  DeviceConfig c;
  if (!load(c)) return false;
  return !c.wifi_ssid.empty() && !c.pb_email.empty();
}

namespace {

// Build an AP SSID like "LL-Attender-A1B2" using the last 4 hex digits of the
// MAC so multiple devices on the same bench don't collide.
std::string ap_ssid() {
  uint8_t mac[6] = {0};
  WiFi.macAddress(mac);
  char buf[24];
  std::snprintf(buf, sizeof(buf), "LL-Attender-%02X%02X", mac[4], mac[5]);
  return buf;
}

// HTML form served at the AP's root. Inline CSS for a clean mobile look —
// LittleFS isn't wired up yet so embedding in PROGMEM is the simplest path.
const char* kFormHtml = R"HTML(<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LL-Attender setup</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
       margin: 0; padding: 24px; max-width: 480px; margin-inline: auto; }
h1 { font-size: 1.5rem; margin: 0 0 4px; }
p.lede { color: #666; margin: 0 0 24px; }
label { display: block; margin: 16px 0 4px; font-weight: 600; font-size: 0.9rem; }
input { width: 100%; padding: 10px 12px; font-size: 1rem; border: 1px solid #ccc;
        border-radius: 8px; background: canvas; color: canvastext; }
input:focus { outline: 2px solid #4a8cff; outline-offset: 1px; }
button { margin-top: 24px; width: 100%; padding: 12px; font-size: 1rem; font-weight: 600;
         background: #2563eb; color: white; border: 0; border-radius: 8px; cursor: pointer; }
button:hover { background: #1d4ed8; }
small { display: block; color: #888; font-size: 0.8rem; margin-top: 4px; }
</style>
</head>
<body>
<h1>LL-Attender setup</h1>
<p class="lede">Enter your WiFi and PocketBase credentials. The device will save them and reboot.</p>
<form method="POST" action="/save">
  <label for="ssid">WiFi network</label>
  <input id="ssid" name="ssid" required autocomplete="off" autocapitalize="none" autocorrect="off">
  <label for="pw">WiFi password</label>
  <input id="pw" name="pw" type="password" autocomplete="off">
  <label for="pburl">PocketBase URL</label>
  <input id="pburl" name="pburl" value="https://learnlife.pockethost.io" autocapitalize="none" autocorrect="off">
  <small>Leave the default unless you're using a different instance.</small>
  <label for="email">PB device email</label>
  <input id="email" name="email" type="email" required autocomplete="off" autocapitalize="none" autocorrect="off">
  <label for="pbpw">PB device password</label>
  <input id="pbpw" name="pbpw" type="password" required autocomplete="off">
  <button type="submit">Save and reboot</button>
</form>
</body>
</html>)HTML";

const char* kSavedHtml = R"HTML(<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saved</title>
<style>
body { font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
       max-width: 480px; margin: 24px auto; padding: 0 24px; text-align: center; }
.ok { font-size: 4rem; margin: 16px 0 0; }
h1 { font-size: 1.4rem; margin: 8px 0; }
p { color: #666; }
</style>
</head>
<body>
<div class="ok">&#10003;</div>
<h1>Saved</h1>
<p>The device is rebooting. You can disconnect from this WiFi and use it as normal.</p>
</body>
</html>)HTML";

// Block until a non-empty line is available on Serial. Strips CR/LF and any
// surrounding whitespace. Returns the trimmed value as a std::string.
std::string read_line(const char* prompt) {
  Serial.print(prompt);
  Serial.flush();
  while (Serial.available() == 0) {
    delay(20);
  }
  String s = Serial.readStringUntil('\n');
  s.trim();
  // Echo back so the user sees what they typed even if their terminal
  // doesn't echo locally.
  Serial.println(s);
  return std::string(s.c_str(), s.length());
}

bool run_serial_provisioning_fallback() {
  Serial.println("[config] (serial fallback) answer each prompt:");
  DeviceConfig c;
  load(c);
  c.wifi_ssid = read_line("WiFi SSID: ");
  if (c.wifi_ssid.empty()) {
    Serial.println("[config] empty SSID — booting in degraded mode");
    return false;
  }
  c.wifi_pw     = read_line("WiFi password: ");
  std::string url = read_line("PB URL [https://learnlife.pockethost.io]: ");
  if (!url.empty()) c.pb_url = url;
  c.pb_email    = read_line("PB device email: ");
  c.pb_password = read_line("PB device password: ");
  if (!save(c)) {
    Serial.println("[config] save failed");
    return false;
  }
  Serial.println("[config] saved — rebooting");
  delay(500);
  ESP.restart();
  return true;
}

void run_web_provisioning() {
  WebServer server(80);
  DNSServer dns;

  WiFi.mode(WIFI_AP);
  const std::string ssid = ap_ssid();
  // Open AP (no password). Phase-4 hardening: random per-boot password printed
  // on the OLED. For now, ease-of-setup wins.
  WiFi.softAP(ssid.c_str());
  IPAddress ip = WiFi.softAPIP();
  Serial.printf("[config] AP up: SSID=%s, IP=%s\n",
                ssid.c_str(), ip.toString().c_str());
  Serial.println("[config] connect a phone to that WiFi, the setup page");
  Serial.println("[config] should pop up automatically (or visit");
  Serial.printf("[config] http://%s manually).\n", ip.toString().c_str());

  // Catch-all DNS so the OS captive-portal detector lands on our form.
  dns.start(53, "*", ip);

  server.on("/", HTTP_GET, [&server]() {
    server.send(200, "text/html", kFormHtml);
  });
  server.on("/save", HTTP_POST, [&server]() {
    DeviceConfig c;
    load(c);
    auto take = [&server](const char* k) {
      String v = server.arg(k);
      v.trim();
      return std::string(v.c_str(), v.length());
    };
    c.wifi_ssid   = take("ssid");
    c.wifi_pw     = take("pw");
    std::string url = take("pburl");
    if (!url.empty()) c.pb_url = url;
    c.pb_email    = take("email");
    c.pb_password = take("pbpw");

    if (c.wifi_ssid.empty() || c.pb_email.empty() || c.pb_password.empty()) {
      server.send(400, "text/plain",
                  "Missing fields — go back and fill them all in.");
      return;
    }
    if (!save(c)) {
      server.send(500, "text/plain", "NVS save failed.");
      return;
    }
    server.send(200, "text/html", kSavedHtml);
    server.client().flush();
    delay(500);
    ESP.restart();
  });
  // Captive-portal probes (iOS/Android/Windows) hit specific URLs to detect
  // an active portal. Funnel everything else to the form.
  server.onNotFound([&server]() {
    server.sendHeader("Location", "/", true);
    server.send(302, "text/plain", "");
  });
  server.begin();

  // Spin forever; the only exit is ESP.restart() inside /save.
  for (;;) {
    dns.processNextRequest();
    server.handleClient();
    delay(2);
  }
}

}  // namespace

bool run_provisioning() {
  // Default: spin up an AP + web GUI. Most users will never see the serial
  // console. As a dev escape, anything typed on Serial within the first 3
  // seconds drops into the serial-prompt fallback (handy for headless
  // debugging when AP mode itself is broken).
  Serial.println();
  Serial.println("================================================================");
  Serial.println("[config] device not provisioned.");
  Serial.println("[config]   Starting WiFi setup AP (\"LL-Attender-XXXX\").");
  Serial.println("[config]   Connect a phone to it; the setup page should pop");
  Serial.println("[config]   up automatically. (Type any key within 3s for the");
  Serial.println("[config]    serial fallback.)");
  Serial.println("================================================================");

  unsigned long start = millis();
  while (millis() - start < 3000) {
    if (Serial.available() > 0) {
      while (Serial.available() > 0) Serial.read();  // drain
      return run_serial_provisioning_fallback();
    }
    delay(20);
  }

  run_web_provisioning();  // never returns; reboots from inside.
  return true;  // unreachable
}

}  // namespace llattender::config

#endif  // LLATTENDER_NATIVE_BUILD
