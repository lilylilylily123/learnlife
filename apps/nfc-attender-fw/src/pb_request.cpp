#include "pb_request.h"

#include <cstdio>

#include "fields.h"  // json_escape

namespace llattender::pb_request {

std::string percent_encode(const std::string& s) {
  static const char* hex = "0123456789ABCDEF";
  std::string out;
  out.reserve(s.size());
  for (unsigned char c : s) {
    const bool unreserved =
        (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
        (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~';
    if (unreserved) {
      out += static_cast<char>(c);
    } else {
      out += '%';
      out += hex[c >> 4];
      out += hex[c & 0xF];
    }
  }
  return out;
}

std::string canonical_base(const std::string& base) {
  if (!base.empty() && base.back() == '/') {
    return base.substr(0, base.size() - 1);
  }
  return base;
}

std::string login_url(const std::string& base) {
  return canonical_base(base) + "/api/collections/users/auth-with-password";
}

std::string login_body(const std::string& identity, const std::string& password) {
  std::string body;
  body += "{\"identity\":\"";
  body += fields::json_escape(identity);
  body += "\",\"password\":\"";
  body += fields::json_escape(password);
  body += "\"}";
  return body;
}

std::string list_learners_url(const std::string& base, int page, int per_page) {
  char buf[64];
  std::snprintf(buf, sizeof(buf), "?page=%d&perPage=%d&sort=name",
                page, per_page);
  return canonical_base(base) + "/api/collections/learners/records" + buf;
}

std::string find_today_attendance_url(const std::string& base,
                                      const std::string& learner_id,
                                      const std::string& date) {
  // Build the raw filter exactly as the JS SDK does for getFirstListItem,
  // matching apps/nfc-attender/src/lib/pb-client.ts:115:
  //   learner = "<id>" && date ~ "<date>"
  std::string filter = "learner = \"";
  filter += learner_id;
  filter += "\" && date ~ \"";
  filter += date;
  filter += "\"";
  return canonical_base(base) +
         "/api/collections/attendance/records?perPage=1&page=1&filter=" +
         percent_encode(filter);
}

std::string list_attendance_for_date_url(const std::string& base,
                                         const std::string& date,
                                         int page, int per_page) {
  std::string filter = "date ~ \"";
  filter += date;
  filter += "\"";
  char buf[64];
  std::snprintf(buf, sizeof(buf), "?page=%d&perPage=%d&filter=",
                page, per_page);
  return canonical_base(base) + "/api/collections/attendance/records" +
         buf + percent_encode(filter);
}

std::string create_attendance_url(const std::string& base) {
  return canonical_base(base) + "/api/collections/attendance/records";
}

std::string create_attendance_body(const std::string& learner_id,
                                   const std::string& date) {
  std::string body;
  body += "{\"learner\":\"";
  body += fields::json_escape(learner_id);
  body += "\",\"date\":\"";
  body += fields::json_escape(date);
  body += "\"}";
  return body;
}

std::string patch_attendance_url(const std::string& base,
                                 const std::string& attendance_id) {
  return canonical_base(base) +
         "/api/collections/attendance/records/" + attendance_id;
}

}  // namespace llattender::pb_request
