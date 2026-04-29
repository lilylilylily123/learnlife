#include "state_machine.h"

#include <cstdio>
#include <cstring>

namespace llattender {

namespace {

// packages/pb-client/src/constants.ts:15-26
constexpr int LATE_HOUR = 10;
constexpr int LATE_MINUTE = 1;
constexpr int LUNCH_START_HOUR = 13;
constexpr int LUNCH_END_HOUR = 14;
constexpr int LUNCH_LATE_HOUR = 14;
constexpr int LUNCH_LATE_MINUTE = 1;
constexpr int CHECKOUT_HOUR = 16;
constexpr int CHECKOUT_MINUTE = 59;
constexpr int FRIDAY_CHECKOUT_HOUR = 14;
constexpr int FRIDAY_CHECKOUT_MINUTE = 0;

inline bool at_or_after(int hour, int minute, int target_hour, int target_minute) {
  return hour > target_hour || (hour == target_hour && minute >= target_minute);
}

}  // namespace

const char* status_to_str(Status s) {
  switch (s) {
    case Status::Present: return "present";
    case Status::Late:    return "late";
    case Status::Absent:  return "absent";
    case Status::JLate:   return "jLate";
    case Status::JAbsent: return "jAbsent";
    case Status::None:    return "";
  }
  return "";
}

Status status_from_str(const char* s) {
  if (s == nullptr || *s == '\0') return Status::None;
  if (std::strcmp(s, "present") == 0) return Status::Present;
  if (std::strcmp(s, "late") == 0)    return Status::Late;
  if (std::strcmp(s, "absent") == 0)  return Status::Absent;
  if (std::strcmp(s, "jLate") == 0)   return Status::JLate;
  if (std::strcmp(s, "jAbsent") == 0) return Status::JAbsent;
  return Status::None;
}

std::string format_iso8601(std::time_t t) {
  std::tm utc{};
#if defined(_WIN32)
  gmtime_s(&utc, &t);
#else
  gmtime_r(&t, &utc);
#endif
  char buf[32];
  // Match JS Date.toISOString(): YYYY-MM-DDTHH:MM:SS.000Z
  std::snprintf(buf, sizeof(buf),
                "%04d-%02d-%02dT%02d:%02d:%02d.000Z",
                utc.tm_year + 1900, utc.tm_mon + 1, utc.tm_mday,
                utc.tm_hour, utc.tm_min, utc.tm_sec);
  return buf;
}

CheckInAction compute_check_in_action(const AttendanceState& state,
                                      const std::tm& local_now,
                                      std::time_t now_unix) {
  const int hour = local_now.tm_hour;
  const int minute = local_now.tm_min;
  const std::string now_iso = format_iso8601(now_unix);

  // ── Step 1: Morning check-in (attendance.ts:60-79) ──────────────────────
  if (!state.has_time_in) {
    CheckInAction a;
    a.type = ActionType::CheckIn;
    a.time_in_iso = now_iso;
    a.status = at_or_after(hour, minute, LATE_HOUR, LATE_MINUTE)
                   ? Status::Late
                   : Status::Present;
    return a;
  }

  // ── Step 2: Lunch window 13:00-13:59 (attendance.ts:85-117) ─────────────
  if (hour >= LUNCH_START_HOUR && hour < LUNCH_END_HOUR) {
    const auto& events = state.lunch_events;
    LunchEvent::Type next_type =
        (events.empty() || events.back().type == LunchEvent::In)
            ? LunchEvent::Out
            : LunchEvent::In;

    CheckInAction a;
    a.type = ActionType::LunchEvent;
    a.lunch_events_after = events;
    LunchEvent ev;
    ev.type = next_type;
    ev.time_unix = now_unix;
    ev.time_iso = now_iso;
    a.lunch_events_after.push_back(std::move(ev));

    if (next_type == LunchEvent::In) {
      a.set_lunch_status = true;
      a.lunch_status = at_or_after(hour, minute, LUNCH_LATE_HOUR, LUNCH_LATE_MINUTE)
                           ? Status::Late
                           : Status::Present;
    }
    return a;
  }

  // ── Step 3: Late lunch return after 14:00 (attendance.ts:122-143) ───────
  if (hour >= LUNCH_LATE_HOUR) {
    const auto& events = state.lunch_events;
    const bool currently_at_lunch =
        !events.empty() && events.back().type == LunchEvent::Out;
    const bool currently_at_lunch_legacy =
        state.has_lunch_out_legacy && !state.has_lunch_in_legacy;

    if (currently_at_lunch || currently_at_lunch_legacy) {
      CheckInAction a;
      a.type = ActionType::LateLunchReturn;
      a.lunch_events_after = events;
      LunchEvent ev;
      ev.type = LunchEvent::In;
      ev.time_unix = now_unix;
      ev.time_iso = now_iso;
      a.lunch_events_after.push_back(std::move(ev));
      a.set_lunch_status = true;
      a.lunch_status = Status::Late;
      return a;
    }
  }

  // ── Step 4: End-of-day checkout (attendance.ts:148-160) ─────────────────
  // tm_wday: Sun=0 .. Sat=6. Friday is 5. Matches Date.getDay() in JS.
  const bool is_friday = local_now.tm_wday == 5;
  const int checkout_hour =
      is_friday ? FRIDAY_CHECKOUT_HOUR : CHECKOUT_HOUR;
  const int checkout_minute =
      is_friday ? FRIDAY_CHECKOUT_MINUTE : CHECKOUT_MINUTE;
  if (at_or_after(hour, minute, checkout_hour, checkout_minute) &&
      !state.has_time_out) {
    CheckInAction a;
    a.type = ActionType::CheckOut;
    a.time_out_iso = now_iso;
    return a;
  }

  // ── Fallback (attendance.ts:163) ────────────────────────────────────────
  CheckInAction a;
  a.type = ActionType::NoAction;
  a.reason = "All check-ins complete for today";
  return a;
}

}  // namespace llattender
