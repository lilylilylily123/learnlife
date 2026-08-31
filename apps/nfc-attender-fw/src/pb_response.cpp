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
  out.updated          = str_or_empty(row["updated"]);

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

// Filters naming exactly the fields the device reads. Anything not listed is
// parsed and discarded without allocating — which is what keeps a 61-row page
// inside the heap budget, since PocketBase also returns collectionId,
// collectionName, created, updated metadata and any expand payload.
//
// `items[0]` in a filter means "apply this to every element of items"; it is
// ArduinoJson's array-filter idiom, not an index.
void build_attendance_filter(JsonDocument& f) {
  f["page"] = true;
  f["totalPages"] = true;
  f["totalItems"] = true;
  auto item = f["items"][0].to<JsonObject>();
  item["id"] = true;
  item["learner"] = true;
  item["date"] = true;
  item["time_in"] = true;
  item["time_out"] = true;
  item["status"] = true;
  item["lunch_status"] = true;
  item["lunch_events"] = true;
  item["lunch_out"] = true;
  item["lunch_in"] = true;
  item["updated"] = true;  // drives the delta-sync watermark
}

void build_learners_filter(JsonDocument& f) {
  f["page"] = true;
  f["totalPages"] = true;
  f["totalItems"] = true;
  auto item = f["items"][0].to<JsonObject>();
  item["id"] = true;
  item["name"] = true;
  item["NFC_ID"] = true;
  item["program"] = true;
}

void read_meta(JsonDocument& doc, PageMeta& meta) {
  meta.page        = doc["page"]       | 0;
  meta.total_pages = doc["totalPages"] | 0;
  meta.total_items = doc["totalItems"] | 0;
}

}  // namespace

bool stream_attendance_page(ByteSource& src, PageMeta& meta,
                            const AttendanceRowSink& sink) {
  JsonDocument filter;
  build_attendance_filter(filter);

  JsonDocument doc;
  if (deserializeJson(doc, src, DeserializationOption::Filter(filter))) {
    return false;
  }
  read_meta(doc, meta);

  auto items = doc["items"].as<JsonArrayConst>();
  if (items.isNull()) return true;  // an empty page is valid, not an error
  for (auto v : items) {
    pb_client::AttendanceRow row;
    fill_attendance(v.as<JsonObjectConst>(), row);
    if (row.id.empty()) continue;
    if (!sink(std::move(row))) break;  // sink asked to stop
  }
  return true;
}

bool stream_learners_page(ByteSource& src, PageMeta& meta,
                          const LearnerRowSink& sink) {
  JsonDocument filter;
  build_learners_filter(filter);

  JsonDocument doc;
  if (deserializeJson(doc, src, DeserializationOption::Filter(filter))) {
    return false;
  }
  read_meta(doc, meta);

  auto items = doc["items"].as<JsonArrayConst>();
  if (items.isNull()) return true;
  for (auto v : items) {
    pb_client::LearnerRow row;
    fill_learner(v.as<JsonObjectConst>(), row);
    if (row.id.empty()) continue;
    if (!sink(std::move(row))) break;
  }
  return true;
}

bool parse_login(const std::string& json, std::string& out_token) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return false;
  const char* tok = doc["token"];
  if (!tok || !*tok) return false;
  out_token = tok;
  return true;
}

// Thin wrapper over the streaming parser: same code path, one extra copy of
// the body. Kept because it is the right tool for a small response and because
// the existing test suite exercises it.
bool parse_learners_page(const std::string& json, LearnersPage& out) {
  StringByteSource src(json);
  PageMeta meta;
  out.items.clear();
  const bool ok = stream_learners_page(src, meta, [&](pb_client::LearnerRow&& r) {
    out.items.push_back(std::move(r));
    return true;
  });
  if (!ok) return false;
  out.page        = meta.page;
  out.total_pages = meta.total_pages;
  out.total_items = meta.total_items;
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

// Wrapper over the streaming parser. NOTE: this materialises every row in a
// vector, which is the allocation pattern that OOMed on a 61-row page. It
// survives for the tests and for small responses; the device's prefetch path
// calls stream_attendance_page directly and sinks rows into the cache.
bool parse_attendance_page(const std::string& json, AttendancePage& out) {
  StringByteSource src(json);
  PageMeta meta;
  out.items.clear();
  const bool ok = stream_attendance_page(src, meta, [&](pb_client::AttendanceRow&& r) {
    out.items.push_back(std::move(r));
    return true;
  });
  if (!ok) return false;
  out.page        = meta.page;
  out.total_pages = meta.total_pages;
  out.total_items = meta.total_items;
  return true;
}

}  // namespace llattender::pb_response
