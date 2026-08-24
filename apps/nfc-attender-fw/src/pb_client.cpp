#include "pb_client.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <WiFiClientSecure.h>

#include <map>

#include "chunked_source.h"
#include "config.h"
#include "fields.h"
#include "json_source.h"
#include "pb_request.h"
#include "pb_response.h"

namespace llattender::pb_client {

namespace {

// ── Concurrency ──────────────────────────────────────────────────────────
//
// Every global below is reachable from three FreeRTOS contexts: processor_task
// (core 1), network_task (core 0) and the Arduino loop task running the serial
// console. std::map and std::string are not thread-safe, and both the
// processor and network paths also write /today.json. Without this lock the
// failure mode is heap corruption surfacing as an unexplained reboot minutes
// later — the kind of bug that gets blamed on the power supply or the
// enclosure.
//
// Recursive because it costs nothing here and removes a whole class of
// self-deadlock if a public function ever ends up calling another one.
SemaphoreHandle_t g_mtx = nullptr;

// RAII guard. Deliberately tolerant of a null mutex: if init() was somehow not
// called, the correct behaviour is to run unlocked exactly as before rather
// than to hard-fault a device sitting on a school front desk.
class Lock {
 public:
  Lock() : held_(false) {
    if (g_mtx != nullptr) {
      held_ = xSemaphoreTakeRecursive(g_mtx, portMAX_DELAY) == pdTRUE;
    }
  }
  ~Lock() {
    if (held_) xSemaphoreGiveRecursive(g_mtx);
  }
  Lock(const Lock&) = delete;
  Lock& operator=(const Lock&) = delete;

 private:
  bool held_;
};

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

// Highest `updated` value seen among today's rows. The delta poll asks
// PocketBase for rows newer than this instead of re-fetching the whole day.
std::string g_updated_watermark;

// PocketBase datetimes are fixed-width "YYYY-MM-DD HH:MM:SS.sssZ", so a
// lexicographic comparison is also chronological — no parsing needed.
//
// Advanced ONLY from values PocketBase returned, never from device time: the
// device clock can lag the server's, and a watermark set from local time would
// permanently skip every row modified inside that gap.
void note_watermark(const std::string& updated) {
  if (updated.empty()) return;
  if (updated > g_updated_watermark) g_updated_watermark = updated;
}

void reset_cache_if_new_day(const std::string& date) {
  if (g_today_date != date) {
    g_today_rows.clear();
    g_today_date = date;
    // The watermark is per-day: carrying yesterday's across midnight would
    // make the new day's first delta poll return nothing.
    g_updated_watermark.clear();
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
//
// Fine for small responses (login, a single record). NOT used for list pages —
// see ResponseSource below.
std::string read_body(HTTPClient& http) {
  String s = http.getString();
  return std::string(s.c_str(), s.length());
}

// Presents an HTTP response body as a ByteSource the JSON parser can read
// directly, without ever holding the whole body in RAM.
//
// Two things to know:
//
//  1. getStream() returns the RAW socket. Unlike getString(), it does NOT
//     de-chunk. PocketHost is behind Cloudflare, so a chunked response is
//     possible, and chunk framing fed to a JSON parser produces garbage.
//     HTTPClient signals chunked by reporting getSize() < 0 (no
//     Content-Length), which is what selects the de-chunking wrapper here.
//
//  2. Both members are constructed either way and only one is handed out.
//     ChunkedByteSource is a few bytes of bookkeeping, so keeping it unused is
//     cheaper than the branchy alternative.
struct ResponseSource {
  StreamByteSource raw;
  ChunkedByteSource chunked;
  bool is_chunked;

  explicit ResponseSource(HTTPClient& http)
      : raw(http.getStream()),
        chunked(raw),
        is_chunked(http.getSize() < 0) {}

  ByteSource& get() {
    return is_chunked ? static_cast<ByteSource&>(chunked)
                      : static_cast<ByteSource&>(raw);
  }
};

}  // namespace

void init() {
  if (g_mtx != nullptr) return;
  g_mtx = xSemaphoreCreateRecursiveMutex();
  if (g_mtx == nullptr) {
    Serial.println("[pb] FATAL: could not create state mutex");
  }
}

bool login() {
  Lock lk;
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
  Lock lk;
  if (g_token.empty()) {
    Serial.println("[pb] prefetch_today: not logged in");
    return false;
  }
  reset_cache_if_new_day(date);

  // 25, not 500. Smaller pages mean the parser's working set stays small even
  // though rows are consumed as they decode — and with ~61 learners this is
  // three requests instead of one, which is a fine trade against an OOM.
  constexpr int kPerPage = 25;
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

    // Parse straight off the socket and drop each row into the cache as it
    // decodes. Nothing ever holds the whole body, and no vector of rows is
    // built — the two allocations that together caused the OOM.
    ResponseSource rs(http);
    pb_response::PageMeta meta;
    const bool ok = pb_response::stream_attendance_page(
        rs.get(), meta, [&](AttendanceRow&& r) {
          if (r.learner_id.empty()) return true;
          note_watermark(r.updated);
          const std::string key = r.learner_id;  // copy before the move
          g_today_rows[key] = std::move(r);
          ++inserted;
          return true;
        });
    http.end();

    if (!ok) {
      Serial.printf("[pb] prefetch_today page %d parse failed\n", page);
      return false;
    }
    if (meta.total_pages <= page) break;
    ++page;
  }
  Serial.printf("[pb] prefetched %d attendance rows for %s (watermark %s)\n",
                inserted, date.c_str(),
                g_updated_watermark.empty() ? "-" : g_updated_watermark.c_str());
  persist_today_cache();
  return true;
}

bool refresh_today_delta(const std::string& date, int& out_changed) {
  Lock lk;
  out_changed = 0;
  if (g_token.empty()) return false;

  // No watermark means nothing has been fetched for today yet, so there is no
  // "since" to ask about. Caller should do a full prefetch first.
  if (g_today_date != date || g_updated_watermark.empty()) return false;

  constexpr int kPerPage = 25;
  int page = 1;
  while (true) {
    WiFiClientSecure client;
    HTTPClient http;
    const std::string url = pb_request::list_attendance_updated_since_url(
        g_cfg.pb_url, date, g_updated_watermark, page, kPerPage);
    if (!open_https(http, client, url)) return false;
    int code = http.GET();
    if (code != 200) {
      Serial.printf("[pb] delta page %d HTTP %d\n", page, code);
      http.end();
      return false;
    }

    ResponseSource rs(http);
    pb_response::PageMeta meta;
    const bool ok = pb_response::stream_attendance_page(
        rs.get(), meta, [&](AttendanceRow&& r) {
          if (r.learner_id.empty()) return true;
          note_watermark(r.updated);
          const std::string key = r.learner_id;
          g_today_rows[key] = std::move(r);
          ++out_changed;
          return true;
        });
    http.end();

    if (!ok) {
      Serial.println("[pb] delta parse failed");
      return false;
    }
    if (meta.total_pages <= page) break;
    ++page;
  }

  if (out_changed > 0) {
    Serial.printf("[pb] delta: %d row(s) changed server-side\n", out_changed);
    persist_today_cache();
  }
  return true;
}

bool fetch_roster(std::vector<LearnerRow>& out) {
  Lock lk;
  if (g_token.empty()) {
    Serial.println("[pb] fetch_roster: not logged in");
    return false;
  }
  out.clear();

  // Paged for the same reason as the attendance prefetch: a single 500-row
  // page would put the whole roster in the parser's working set at once.
  constexpr int kPerPage = 25;
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

    ResponseSource rs(http);
    pb_response::PageMeta meta;
    const bool ok = pb_response::stream_learners_page(
        rs.get(), meta, [&](LearnerRow&& l) {
          out.push_back(std::move(l));
          return true;
        });
    http.end();

    if (!ok) {
      Serial.printf("[pb] fetch_roster page %d parse failed\n", page);
      return false;
    }
    if (meta.total_pages <= page) break;
    ++page;
  }
  Serial.printf("[pb] fetched %u learners\n", static_cast<unsigned>(out.size()));
  return true;
}

bool ensure_today_row(const std::string& learner_id,
                      const std::string& date,
                      AttendanceRow& out, bool& created) {
  Lock lk;
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
  Lock lk;
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
  Lock lk;
  return load_today_cache(today);
}

void clear_today_cache() {
  Lock lk;
  g_today_rows.clear();
  g_today_date.clear();
  LittleFS.remove(kCachePath);
  Serial.println("[pb] today-cache cleared (memory + disk)");
}

bool patch_attendance(const std::string& id, const std::string& fields_json) {
  Lock lk;
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
