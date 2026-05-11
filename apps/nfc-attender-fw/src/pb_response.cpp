#include "pb_response.h"

#include <ArduinoJson.h>

namespace llattender::pb_response {

namespace {

// Pull a string field, treating missing or null as empty.
inline std::string str_or_empty(JsonVariantConst v) {
  if (v.isNull()) return {};
  const char* s = v.as<const char*>();
  return s ? std::string(s) : std::string{};
}

void fill_learner(JsonObjectConst row, pb_client::LearnerRow& out) {
  out.id      = str_or_empty(row["id"]);
  out.name    = str_or_empty(row["name"]);
  // PocketBase column is `NFC_ID` (matches the TS Learner type).
  out.nfc_id  = str_or_empty(row["NFC_ID"]);
  out.program = str_or_empty(row["program"]);
}

void fill_attendance(JsonObjectConst row, pb_client::AttendanceRow& out) {
  out.id            = str_or_empty(row["id"]);
  out.learner_id    = str_or_empty(row["learner"]);
  out.date          = str_or_empty(row["date"]);
  out.time_in       = str_or_empty(row["time_in"]);
  out.time_out      = str_or_empty(row["time_out"]);
  out.status        = str_or_empty(row["status"]);
  out.lunch_status  = str_or_empty(row["lunch_status"]);
  out.lunch_out_legacy = str_or_empty(row["lunch_out"]);
  out.lunch_in_legacy  = str_or_empty(row["lunch_in"]);

  // `lunch_events` is a JSON column. PocketBase returns it as a real array;
  // serialise it back to a string so callers (e.g. the state machine adapter)
  // can re-parse without holding a reference into the document arena.
  auto le = row["lunch_events"];
  if (le.isNull()) {
    out.lunch_events_json.clear();
  } else {
    out.lunch_events_json.clear();
    serializeJson(le, out.lunch_events_json);
  }
}

}  // namespace

bool parse_login(const std::string& json, std::string& out_token) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return false;
  const char* tok = doc["token"];
  if (!tok || !*tok) return false;
  out_token = tok;
  return true;
}

bool parse_learners_page(const std::string& json, LearnersPage& out) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return false;
  out.page        = doc["page"]        | 0;
  out.total_pages = doc["totalPages"]  | 0;
  out.total_items = doc["totalItems"]  | 0;
  out.items.clear();
  auto items = doc["items"].as<JsonArrayConst>();
  if (items.isNull()) return true;  // empty page is valid
  out.items.reserve(items.size());
  for (auto v : items) {
    pb_client::LearnerRow row;
    fill_learner(v.as<JsonObjectConst>(), row);
    if (!row.id.empty()) out.items.push_back(std::move(row));
  }
  return true;
}

bool parse_attendance_search(const std::string& json,
                             pb_client::AttendanceRow& out) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return false;
  out = pb_client::AttendanceRow{};
  auto items = doc["items"].as<JsonArrayConst>();
  if (items.isNull() || items.size() == 0) return true;  // not found, not error
  fill_attendance(items[0].as<JsonObjectConst>(), out);
  return true;
}

bool parse_attendance_record(const std::string& json,
                             pb_client::AttendanceRow& out) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return false;
  out = pb_client::AttendanceRow{};
  fill_attendance(doc.as<JsonObjectConst>(), out);
  return !out.id.empty();
}

bool parse_attendance_page(const std::string& json, AttendancePage& out) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return false;
  out.page        = doc["page"]       | 0;
  out.total_pages = doc["totalPages"] | 0;
  out.total_items = doc["totalItems"] | 0;
  out.items.clear();
  auto items = doc["items"].as<JsonArrayConst>();
  if (items.isNull()) return true;
  out.items.reserve(items.size());
  for (auto v : items) {
    pb_client::AttendanceRow row;
    fill_attendance(v.as<JsonObjectConst>(), row);
    if (!row.id.empty()) out.items.push_back(std::move(row));
  }
  return true;
}

}  // namespace llattender::pb_response
