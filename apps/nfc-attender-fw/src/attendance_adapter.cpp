#include "attendance_adapter.h"

#include <ArduinoJson.h>

#include <cstring>

namespace llattender::attendance_adapter {

namespace {

// Parse an ISO-8601 timestamp like "2026-05-06T13:05:00.000Z" into unix seconds.
// Returns 0 on parse failure (the lunch event will still appear with the iso
// string preserved so the JSON round-trips faithfully — only date arithmetic
// downstream is affected).
//
// Done by hand because `timegm` isn't on newlib (ESP32) and `mktime` would
// apply the local-TZ offset, which we don't want — the input is UTC.
std::time_t iso_to_unix(const std::string& iso) {
  if (iso.size() < 19) return 0;  // "YYYY-MM-DDTHH:MM:SS"
  int y, mo, d, h, mi, s;
  if (std::sscanf(iso.c_str(), "%d-%d-%dT%d:%d:%d", &y, &mo, &d, &h, &mi, &s)
      != 6) {
    return 0;
  }
  static const int days_in_month[12] = {
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  auto is_leap = [](int yr) {
    return (yr % 4 == 0 && yr % 100 != 0) || (yr % 400 == 0);
  };
  long days = 0;
  for (int yr = 1970; yr < y; ++yr) {
    days += is_leap(yr) ? 366 : 365;
  }
  for (int m = 0; m < mo - 1; ++m) {
    days += days_in_month[m];
    if (m == 1 && is_leap(y)) days += 1;
  }
  days += d - 1;
  return static_cast<std::time_t>(days * 86400L + h * 3600 + mi * 60 + s);
}

}  // namespace

void state_from_row(const pb_client::AttendanceRow& row,
                    AttendanceState& out) {
  out = AttendanceState{};
  out.has_time_in  = !row.time_in.empty();
  out.has_time_out = !row.time_out.empty();
  out.status        = status_from_str(row.status.c_str());
  out.lunch_status  = status_from_str(row.lunch_status.c_str());
  out.has_lunch_out_legacy = !row.lunch_out_legacy.empty();
  out.has_lunch_in_legacy  = !row.lunch_in_legacy.empty();

  if (row.lunch_events_json.empty()) return;

  JsonDocument doc;
  if (deserializeJson(doc, row.lunch_events_json)) return;
  auto arr = doc.as<JsonArrayConst>();
  if (arr.isNull()) return;
  out.lunch_events.reserve(arr.size());
  for (auto v : arr) {
    auto obj = v.as<JsonObjectConst>();
    if (obj.isNull()) continue;
    const char* type = obj["type"];
    const char* time = obj["time"];
    if (!type || !time) continue;
    LunchEvent ev;
    if (std::strcmp(type, "out") == 0) ev.type = LunchEvent::Out;
    else if (std::strcmp(type, "in") == 0) ev.type = LunchEvent::In;
    else continue;
    ev.time_iso = time;
    ev.time_unix = iso_to_unix(ev.time_iso);
    out.lunch_events.push_back(std::move(ev));
  }
}

}  // namespace llattender::attendance_adapter
