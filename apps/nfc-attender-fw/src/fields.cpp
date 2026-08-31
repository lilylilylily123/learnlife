#include "fields.h"

#include <cstdio>

namespace llattender::fields {

std::string json_escape(const std::string& s) {
  std::string out;
  out.reserve(s.size() + 2);
  for (unsigned char c : s) {
    switch (c) {
      case '"':  out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b";  break;
      case '\f': out += "\\f";  break;
      case '\n': out += "\\n";  break;
      case '\r': out += "\\r";  break;
      case '\t': out += "\\t";  break;
      default:
        if (c < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else {
          out += static_cast<char>(c);
        }
    }
  }
  return out;
}

std::string serialize_lunch_events_array(const std::vector<LunchEvent>& events) {
  std::string out;
  out += '[';
  for (size_t i = 0; i < events.size(); ++i) {
    if (i > 0) out += ',';
    out += "{\"type\":\"";
    out += (events[i].type == LunchEvent::Out ? "out" : "in");
    out += "\",\"time\":\"";
    out += json_escape(events[i].time_iso);
    out += "\"}";
  }
  out += ']';
  return out;
}

namespace {

void emit_kv_string(std::string& out, const char* key, const std::string& value,
                    bool first) {
  if (!first) out += ',';
  out += '"';
  out += key;
  out += "\":\"";
  out += json_escape(value);
  out += '"';
}

}  // namespace

std::string serialize_action(const CheckInAction& action) {
  std::string body;

  switch (action.type) {
    case ActionType::CheckIn: {
      body += '{';
      emit_kv_string(body, "time_in", action.time_in_iso, /*first=*/true);
      emit_kv_string(body, "arrival", status_to_str(action.arrival), /*first=*/false);
      emit_kv_string(body, "status", status_to_str(action.status), /*first=*/false);
      body += '}';
      return body;
    }

    case ActionType::CheckOut: {
      body += '{';
      emit_kv_string(body, "time_out", action.time_out_iso, /*first=*/true);
      body += '}';
      return body;
    }

    case ActionType::LunchEvent:
    case ActionType::LateLunchReturn: {
      // The TS code stringifies the events array (attendance.ts:98) and
      // stores it as a string in the JSON field. Match that on the wire so
      // the row shape is identical regardless of which client wrote it.
      const std::string arr = serialize_lunch_events_array(action.lunch_events_after);
      body += '{';
      emit_kv_string(body, "lunch_events", arr, /*first=*/true);
      if (action.set_lunch_status) {
        emit_kv_string(body, "lunch_status",
                       status_to_str(action.lunch_status), /*first=*/false);
      }
      body += '}';
      return body;
    }

    case ActionType::NoAction:
    case ActionType::Locked:
      // Neither writes anything. Locked is the 14:00-17:00 rejection: the tap
      // is acknowledged on screen but must not touch the row.
      //
      // processor_task already skips both before reaching here (main.cpp), so
      // this is unreachable today — but listing them makes the switch
      // exhaustive, which is what makes -Wswitch useful as a tripwire if a new
      // ActionType is ever added.
      return "";
  }
  return "";
}

}  // namespace llattender::fields
