#include "pb_client.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <WiFiClientSecure.h>

#include <map>

#include "config.h"
#include "fields.h"
#include "pb_request.h"
#include "pb_response.h"

namespace llattender::pb_client {

namespace {

// Cached bearer token. Refreshed on every login() call. We don't persist it
// to NVS yet — the device re-logs in on boot, which is fine in Phase 2.
std::string g_token;

// Cached snapshot of the config used by all calls. Re-loaded each time we go
// online so the user can update credentials via the serial provisioner without
// rebooting twice.
config::DeviceConfig g_cfg;
bool g_cfg_loaded = false;

// In-memory cache of today's attendance rows, keyed by learner_id. Populated
// lazily by ensure_today_row, then kept up to date by the processor task via
// update_today_cache_after_action. Eliminates the per-scan TLS roundtrip for
// every tap after the first one per learner per day.
std::map<std::string, AttendanceRow> g_today_rows;
std::string g_today_date;  // YYYY-MM-DD — flush cache when this changes

void reset_cache_if_new_day(const std::string& date) {
  if (g_today_date != date) {
    g_today_rows.clear();
    g_today_date = date;
  }
}

constexpr const char* kCachePath = "/today.json";

// Serialise the cache to LittleFS so a mid-day reboot doesn't lose state and
// cause duplicate CheckIn writes on the next tap.
void persist_today_cache() {
  if (g_today_date.empty()) return;
  fs::File f = LittleFS.open(kCachePath, "w");
  if (!f) {
    Serial.println("[pb] persist: open /today.json failed");
    return;
  }
  JsonDocument doc;
  doc["date"] = g_today_date;
  auto items = doc["items"].to<JsonObject>();
  for (auto& kv : g_today_rows) {
    auto o = items[kv.first].to<JsonObject>();
    o["id"]                = kv.second.id;
    o["learner_id"]        = kv.second.learner_id;
    o["date"]              = kv.second.date;
    o["time_in"]           = kv.second.time_in;
    o["time_out"]          = kv.second.time_out;
    o["status"]            = kv.second.status;
    o["lunch_status"]      = kv.second.lunch_status;
    o["lunch_events_json"] = kv.second.lunch_events_json;
    o["lunch_out_legacy"]  = kv.second.lunch_out_legacy;
    o["lunch_in_legacy"]   = kv.second.lunch_in_legacy;
  }
  serializeJson(doc, f);
  f.close();
}

// Try to repopulate g_today_rows from disk. Only loads if the persisted date
// matches `today` — otherwise the cache is stale and ignored.
bool load_today_cache(const std::string& today) {
  fs::File f = LittleFS.open(kCachePath, "r");
  if (!f) return false;
  JsonDocument doc;
  auto err = deserializeJson(doc, f);
  f.close();
  if (err) {
    Serial.printf("[pb] cache parse err: %s\n", err.c_str());
    return false;
  }
  std::string date = doc["date"] | "";
  if (date != today) {
    Serial.printf("[pb] cache on disk is for %s, today is %s — discarding\n",
                  date.c_str(), today.c_str());
    return false;
  }
  g_today_date = date;
  g_today_rows.clear();
  auto items = doc["items"].as<JsonObjectConst>();
  if (items.isNull()) return true;
  for (auto kv : items) {
    AttendanceRow row;
    auto o = kv.value().as<JsonObjectConst>();
    row.id                = std::string(o["id"]                | "");
    row.learner_id        = std::string(o["learner_id"]        | "");
    row.date              = std::string(o["date"]              | "");
    row.time_in           = std::string(o["time_in"]           | "");
    row.time_out          = std::string(o["time_out"]          | "");
    row.status            = std::string(o["status"]            | "");
    row.lunch_status      = std::string(o["lunch_status"]      | "");
    row.lunch_events_json = std::string(o["lunch_events_json"] | "");
    row.lunch_out_legacy  = std::string(o["lunch_out_legacy"]  | "");
    row.lunch_in_legacy   = std::string(o["lunch_in_legacy"]   | "");
    g_today_rows[std::string(kv.key().c_str())] = std::move(row);
  }
  Serial.printf("[pb] loaded %u cached rows from disk for %s\n",
                static_cast<unsigned>(g_today_rows.size()), today.c_str());
  return true;
}

bool ensure_cfg() {
  if (g_cfg_loaded) return true;
  if (!config::load(g_cfg)) {
    Serial.println("[pb] config load failed");
    return false;
  }
  if (g_cfg.pb_url.empty() || g_cfg.pb_email.empty() ||
      g_cfg.pb_password.empty()) {
    Serial.println("[pb] config missing pb_url / email / password");
    return false;
  }
  g_cfg_loaded = true;
  return true;
}

// Configure HTTPS, set common headers, return true if begin() succeeded.
// Caller owns `http` and `client` and is responsible for end() / cleanup.
bool open_https(HTTPClient& http, WiFiClientSecure& client,
                const std::string& url, bool with_auth = true) {
  client.setInsecure();  // TODO (phase 6+): pin pockethost.io's CA.
  // Long-ish timeouts so flaky WiFi doesn't immediately abort an in-flight
  // PATCH. The network task is the one waiting; the NFC task is unaffected.
  http.setConnectTimeout(8000);
  http.setTimeout(8000);
  if (!http.begin(client, String(url.c_str()))) {
    Serial.printf("[pb] http.begin failed for %s\n", url.c_str());
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  if (with_auth && !g_token.empty()) {
    http.addHeader("Authorization", String("Bearer ") + g_token.c_str());
  }
  return true;
}

// Read the entire response body. HTTPClient::getString() handles transfer
// encoding for us.
std::string read_body(HTTPClient& http) {
  String s = http.getString();
  return std::string(s.c_str(), s.length());
}

}  // namespace

bool login() {
  // Force a re-load so a freshly-provisioned config takes effect without a
  // reboot.
  g_cfg_loaded = false;
  if (!ensure_cfg()) return false;

  WiFiClientSecure client;
  HTTPClient http;
  const std::string url = pb_request::login_url(g_cfg.pb_url);
  if (!open_https(http, client, url, /*with_auth=*/false)) return false;

  const std::string body =
      pb_request::login_body(g_cfg.pb_email, g_cfg.pb_password);
  int code = http.POST(reinterpret_cast<uint8_t*>(const_cast<char*>(body.data())),
                       body.size());
  if (code != 200) {
    Serial.printf("[pb] login HTTP %d\n", code);
    http.end();
    return false;
  }
  std::string resp = read_body(http);
  http.end();

  std::string tok;
  if (!pb_response::parse_login(resp, tok)) {
    Serial.println("[pb] login response parse failed");
    return false;
  }
  g_token = std::move(tok);
  Serial.println("[pb] login ok");
  return true;
}

bool prefetch_today_attendance(const std::string& date) {
  if (g_token.empty()) {
    Serial.println("[pb] prefetch_today: not logged in");
    return false;
  }
  reset_cache_if_new_day(date);

  constexpr int kPerPage = 500;
  int page = 1;
  int inserted = 0;
  while (true) {
    WiFiClientSecure client;
    HTTPClient http;
    const std::string url =
        pb_request::list_attendance_for_date_url(g_cfg.pb_url, date, page, kPerPage);
    if (!open_https(http, client, url)) return false;
    int code = http.GET();
    if (code != 200) {
      Serial.printf("[pb] prefetch_today page %d HTTP %d\n", page, code);
      http.end();
      return false;
    }
    std::string body = read_body(http);
    http.end();

    pb_response::AttendancePage parsed;
    if (!pb_response::parse_attendance_page(body, parsed)) {
      Serial.println("[pb] prefetch_today parse failed");
      return false;
    }
    for (auto& r : parsed.items) {
      if (!r.learner_id.empty()) {
        g_today_rows[r.learner_id] = std::move(r);
        ++inserted;
      }
    }
    if (parsed.total_pages <= page) break;
    ++page;
  }
  Serial.printf("[pb] prefetched %d attendance rows for %s\n",
                inserted, date.c_str());
  persist_today_cache();
  return true;
}

bool fetch_roster(std::vector<LearnerRow>& out) {
  if (g_token.empty()) {
    Serial.println("[pb] fetch_roster: not logged in");
    return false;
  }
  out.clear();

  // PocketBase caps perPage at 500. The roster is small enough that one page
  // covers it, but the loop generalises in case we grow.
  constexpr int kPerPage = 500;
  int page = 1;
  while (true) {
    WiFiClientSecure client;
    HTTPClient http;
    const std::string url =
        pb_request::list_learners_url(g_cfg.pb_url, page, kPerPage);
    if (!open_https(http, client, url)) return false;
    int code = http.GET();
    if (code != 200) {
      Serial.printf("[pb] fetch_roster page %d HTTP %d\n", page, code);
      http.end();
      return false;
    }
    std::string body = read_body(http);
    http.end();

    pb_response::LearnersPage parsed;
    if (!pb_response::parse_learners_page(body, parsed)) {
      Serial.println("[pb] fetch_roster parse failed");
      return false;
    }
    for (auto& l : parsed.items) out.push_back(std::move(l));
    if (parsed.total_pages <= page) break;
    ++page;
  }
  Serial.printf("[pb] fetched %u learners\n", static_cast<unsigned>(out.size()));
  return true;
}

bool ensure_today_row(const std::string& learner_id,
                      const std::string& date,
                      AttendanceRow& out, bool& created) {
  created = false;
  if (g_token.empty()) {
    Serial.println("[pb] ensure_today_row: not logged in");
    return false;
  }

  reset_cache_if_new_day(date);
  auto cached = g_today_rows.find(learner_id);
  if (cached != g_today_rows.end()) {
    out = cached->second;
    return true;
  }

  // GET filtered list — find existing row for (learner, date).
  {
    WiFiClientSecure client;
    HTTPClient http;
    const std::string url =
        pb_request::find_today_attendance_url(g_cfg.pb_url, learner_id, date);
    if (!open_https(http, client, url)) return false;
    int code = http.GET();
    if (code != 200) {
      Serial.printf("[pb] find_today HTTP %d\n", code);
      http.end();
      return false;
    }
    std::string body = read_body(http);
    http.end();
    if (!pb_response::parse_attendance_search(body, out)) {
      Serial.println("[pb] find_today parse failed");
      return false;
    }
    if (!out.id.empty()) {
      g_today_rows[learner_id] = out;
      persist_today_cache();
      return true;  // existing row
    }
  }

  // No row yet — create one.
  WiFiClientSecure client;
  HTTPClient http;
  const std::string url = pb_request::create_attendance_url(g_cfg.pb_url);
  if (!open_https(http, client, url)) return false;
  const std::string body =
      pb_request::create_attendance_body(learner_id, date);
  int code = http.POST(reinterpret_cast<uint8_t*>(const_cast<char*>(body.data())),
                       body.size());
  if (code != 200 && code != 201) {
    Serial.printf("[pb] create_attendance HTTP %d\n", code);
    http.end();
    return false;
  }
  std::string resp = read_body(http);
  http.end();
  if (!pb_response::parse_attendance_record(resp, out)) {
    Serial.println("[pb] create_attendance parse failed");
    return false;
  }
  created = true;
  g_today_rows[learner_id] = out;
  persist_today_cache();
  return true;
}

void update_today_cache_after_action(const std::string& learner_id,
                                     const CheckInAction& action) {
  auto it = g_today_rows.find(learner_id);
  if (it == g_today_rows.end()) return;  // nothing cached yet
  AttendanceRow& row = it->second;
  switch (action.type) {
    case ActionType::CheckIn:
      row.time_in = action.time_in_iso;
      row.status  = status_to_str(action.status);
      break;
    case ActionType::CheckOut:
      row.time_out = action.time_out_iso;
      break;
    case ActionType::LunchEvent:
    case ActionType::LateLunchReturn:
      row.lunch_events_json =
          fields::serialize_lunch_events_array(action.lunch_events_after);
      if (action.set_lunch_status) {
        row.lunch_status = status_to_str(action.lunch_status);
      }
      break;
    case ActionType::NoAction:
      break;
  }
  persist_today_cache();
}

bool load_today_cache_from_disk(const std::string& today) {
  return load_today_cache(today);
}

void clear_today_cache() {
  g_today_rows.clear();
  g_today_date.clear();
  LittleFS.remove(kCachePath);
  Serial.println("[pb] today-cache cleared (memory + disk)");
}

bool patch_attendance(const std::string& id, const std::string& fields_json) {
  if (g_token.empty()) {
    Serial.println("[pb] patch_attendance: not logged in");
    return false;
  }
  if (id.empty()) {
    Serial.println("[pb] patch_attendance: empty id");
    return false;
  }
  WiFiClientSecure client;
  HTTPClient http;
  const std::string url =
      pb_request::patch_attendance_url(g_cfg.pb_url, id);
  if (!open_https(http, client, url)) return false;
  int code = http.sendRequest(
      "PATCH",
      reinterpret_cast<uint8_t*>(const_cast<char*>(fields_json.data())),
      fields_json.size());
  http.end();
  if (code != 200) {
    Serial.printf("[pb] patch_attendance HTTP %d\n", code);
    return false;
  }
  return true;
}

}  // namespace llattender::pb_client

#endif  // LLATTENDER_NATIVE_BUILD
