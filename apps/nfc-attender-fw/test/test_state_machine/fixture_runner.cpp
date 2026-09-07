#include "fixture_runner.h"

#include <unity.h>

#include <ArduinoJson.h>

#include <cstdio>
#include <cstring>
#include <ctime>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "state_machine.h"

#ifndef LL_ATTENDANCE_FIXTURE
#error "LL_ATTENDANCE_FIXTURE is not defined. Add it to [env:native] build_flags in platformio.ini — a missing path must be a compile error, never a silent zero-case run."
#endif

namespace llattender_fixture {
namespace {

using llattender::ActionType;
using llattender::AttendanceState;
using llattender::CheckInAction;
using llattender::LunchEvent;
using llattender::Status;
using llattender::compute_check_in_action;
using llattender::format_iso8601;
using llattender::status_from_str;
using llattender::status_to_str;

// ── Fixture state ────────────────────────────────────────────────────────────

JsonDocument g_doc;
JsonArrayConst g_cases;
JsonArrayConst g_sweep;
size_t g_index = 0;

// Unity keeps the test-name pointer, so it has to outlive the call.
std::string g_name;
// Buffer for assertion messages; Unity does not copy them either.
std::string g_msg;

std::vector<std::string> g_divergent;


const char* msg(const std::string& s) {
  g_msg = s;
  return g_msg.c_str();
}

// ── Fixture → C++ input ──────────────────────────────────────────────────────

AttendanceState state_from(JsonObjectConst s) {
  AttendanceState st;
  st.has_time_in = !s["time_in"].isNull();
  st.has_time_out = !s["time_out"].isNull();
  st.has_lunch_out_legacy = !s["lunch_out"].isNull();
  st.has_lunch_in_legacy = !s["lunch_in"].isNull();
  st.status = status_from_str(s["status"] | "");
  st.lunch_status = status_from_str(s["lunch_status"] | "");

  JsonArrayConst events = s["lunch_events"];
  for (JsonObjectConst e : events) {
    LunchEvent ev;
    ev.type = std::strcmp(e["type"] | "", "out") == 0 ? LunchEvent::Out : LunchEvent::In;
    ev.time_iso = e["time"] | "";
    // Pre-existing events are opaque to the state machine, which copies them
    // through untouched — only the ISO string is ever compared.
    ev.time_unix = 0;
    st.lunch_events.push_back(std::move(ev));
  }
  return st;
}

/**
 * Build the case's wall clock and verify it survived mktime unchanged.
 *
 * Both implementations read local fields, so a host timezone with a DST
 * transition inside a case's date could renormalise the hour and surface as a
 * phantom divergence. main() pins TZ=UTC; this is the check that says so out
 * loud if that pin is ever lost.
 */
std::tm clock_from(JsonObjectConst n, const std::string& id) {
  std::tm t{};
  t.tm_year = (n["year"] | 0) - 1900;
  t.tm_mon = (n["month"] | 0) - 1;
  t.tm_mday = n["day"] | 0;
  t.tm_hour = n["hour"] | 0;
  t.tm_min = n["minute"] | 0;
  t.tm_sec = 0;
  t.tm_isdst = -1;
  std::mktime(&t);  // normalises and fills tm_wday

  const int want_hour = n["hour"] | -1;
  const int want_min = n["minute"] | -1;
  const int want_wday = n["weekday"] | -1;
  if (t.tm_hour != want_hour || t.tm_min != want_min || t.tm_wday != want_wday) {
    // ASCII only: Unity escapes non-ASCII bytes in assertion messages, which
    // turns a readable diagnostic into hex noise.
    char buf[256];
    std::snprintf(buf, sizeof(buf),
                  "%s: wall clock mismatch - fixture says %02d:%02d weekday %d but "
                  "mktime produced %02d:%02d weekday %d. Both suites must run "
                  "under TZ=UTC; see the fixture's \"timezone\" block.",
                  id.c_str(), want_hour, want_min, want_wday, t.tm_hour, t.tm_min,
                  t.tm_wday);
    TEST_FAIL_MESSAGE(msg(buf));
  }
  return t;
}

std::time_t to_unix(const std::tm& local) {
  std::tm copy = local;
  copy.tm_isdst = -1;
  return std::mktime(&copy);
}

// ── C++ output → fixture expectation shape ───────────────────────────────────

const char* action_name(ActionType t) {
  switch (t) {
    case ActionType::CheckIn:         return "check_in";
    case ActionType::LunchEvent:      return "lunch_event";
    case ActionType::LateLunchReturn: return "late_lunch_return";
    case ActionType::CheckOut:        return "check_out";
    case ActionType::Locked:          return "locked";
    case ActionType::NoAction:        return "no_action";
  }
  return "(unknown)";
}

/**
 * Mirror of normalizeAction() in packages/shared/scripts/attendance-fixture.ts:
 * `action` plus exactly the fields that branch sets. A field left unset here
 * means the fixture must not carry that key — that negative is what pins D2a.
 */
struct Actual {
  const char* action = "";
  bool has_time_in = false;
  std::string time_in;
  bool has_time_out = false;
  std::string time_out;
  bool has_arrival = false;
  Status arrival = Status::None;
  bool has_status = false;
  Status status = Status::None;
  bool has_events = false;
  std::vector<LunchEvent> events;
  bool has_lunch_status = false;
  Status lunch_status = Status::None;
  bool has_reason = false;
  std::string reason;
};

Actual normalize(const CheckInAction& a) {
  Actual o;
  o.action = action_name(a.type);
  switch (a.type) {
    case ActionType::CheckIn:
      o.has_time_in = true;
      o.time_in = a.time_in_iso;
      o.has_arrival = true;
      o.arrival = a.arrival;
      o.has_status = true;
      o.status = a.status;
      break;
    case ActionType::LunchEvent:
      o.has_events = true;
      o.events = a.lunch_events_after;
      if (a.set_lunch_status) {
        o.has_lunch_status = true;
        o.lunch_status = a.lunch_status;
      }
      break;
    case ActionType::LateLunchReturn:
      o.has_events = true;
      o.events = a.lunch_events_after;
      o.has_lunch_status = true;
      o.lunch_status = a.lunch_status;
      break;
    case ActionType::CheckOut:
      o.has_time_out = true;
      o.time_out = a.time_out_iso;
      // D2a: the port leaves these empty today. Surfaced rather than assumed,
      // so the day it starts populating them the fixture has to agree.
      if (!a.lunch_events_after.empty()) {
        o.has_events = true;
        o.events = a.lunch_events_after;
      }
      if (a.set_lunch_status) {
        o.has_lunch_status = true;
        o.lunch_status = a.lunch_status;
      }
      break;
    case ActionType::Locked:
    case ActionType::NoAction:
      o.has_reason = true;
      o.reason = a.reason != nullptr ? a.reason : "";
      break;
  }
  return o;
}

// ── Comparison ───────────────────────────────────────────────────────────────

/** Expand the "$now" sentinel into this case's ISO timestamp. */
std::string expand(const char* want, const std::string& now_iso) {
  return std::strcmp(want, "$now") == 0 ? now_iso : std::string(want);
}

void expect_presence(const std::string& id, const char* key, bool want, bool got) {
  if (want == got) return;
  TEST_FAIL_MESSAGE(msg(
      id + ": field \"" + key + "\" " + (want ? "is missing but the fixture expects it"
                                              : "was set but the fixture does not list it "
                                                "- an absent key means the field must not "
                                                "be written")));
}

void expect_str(const std::string& id, const char* key, const std::string& want,
                const std::string& got) {
  if (want == got) return;
  TEST_FAIL_MESSAGE(
      msg(id + ": \"" + key + "\" expected \"" + want + "\" but got \"" + got + "\""));
}

void compare(const std::string& id, JsonObjectConst want, const Actual& got,
             const std::string& now_iso) {
  expect_str(id, "action", std::string(want["action"] | ""), std::string(got.action));

  expect_presence(id, "time_in", !want["time_in"].isNull(), got.has_time_in);
  if (got.has_time_in) {
    expect_str(id, "time_in", expand(want["time_in"] | "", now_iso), got.time_in);
  }

  expect_presence(id, "time_out", !want["time_out"].isNull(), got.has_time_out);
  if (got.has_time_out) {
    expect_str(id, "time_out", expand(want["time_out"] | "", now_iso), got.time_out);
  }

  expect_presence(id, "arrival", !want["arrival"].isNull(), got.has_arrival);
  if (got.has_arrival) {
    expect_str(id, "arrival", std::string(want["arrival"] | ""),
               std::string(status_to_str(got.arrival)));
  }

  expect_presence(id, "status", !want["status"].isNull(), got.has_status);
  if (got.has_status) {
    expect_str(id, "status", std::string(want["status"] | ""),
               std::string(status_to_str(got.status)));
  }

  expect_presence(id, "lunch_status", !want["lunch_status"].isNull(), got.has_lunch_status);
  if (got.has_lunch_status) {
    expect_str(id, "lunch_status", std::string(want["lunch_status"] | ""),
               std::string(status_to_str(got.lunch_status)));
  }

  expect_presence(id, "reason", !want["reason"].isNull(), got.has_reason);
  if (got.has_reason) {
    expect_str(id, "reason", std::string(want["reason"] | ""), got.reason);
  }

  expect_presence(id, "lunch_events", !want["lunch_events"].isNull(), got.has_events);
  if (got.has_events) {
    JsonArrayConst list = want["lunch_events"];
    if (list.size() != got.events.size()) {
      TEST_FAIL_MESSAGE(msg(id + ": lunch_events length expected " +
                            std::to_string(list.size()) + " but got " +
                            std::to_string(got.events.size())));
    }
    for (size_t i = 0; i < got.events.size(); ++i) {
      JsonObjectConst e = list[i];
      const std::string slot = "lunch_events[" + std::to_string(i) + "]";
      expect_str(id, (slot + ".type").c_str(), std::string(e["type"] | ""),
                 got.events[i].type == LunchEvent::Out ? "out" : "in");
      expect_str(id, (slot + ".time").c_str(), expand(e["time"] | "", now_iso),
                 got.events[i].time_iso);
    }
  }

  // Unknown-key guard.
  //
  // Every comparison above names its key explicitly, so a key the fixture
  // grows that this function does not know about would otherwise be silently
  // unchecked — the port could stop writing it and nothing here would notice.
  // That is exactly how `justified` slipped through when the spec gained it.
  // Anything not handled and not explicitly excused by a registered
  // divergence is a hard failure.
  static const char* kHandled[] = {"action",       "time_in",      "time_out",
                                   "arrival",      "status",       "lunch_status",
                                   "reason",       "lunch_events"};
  for (JsonPairConst kv : want) {
    const char* key = kv.key().c_str();
    bool handled = false;
    for (const char* h : kHandled) {
      if (std::strcmp(h, key) == 0) {
        handled = true;
        break;
      }
    }
    if (handled) continue;
    TEST_FAIL_MESSAGE(msg(
        id + ": fixture expects field \"" + std::string(key) +
        "\" but this harness does not compare it. Add it to compare() in "
        "fixture_runner.cpp."));
  }
}

// ── Per-case Unity test ──────────────────────────────────────────────────────

bool refs_divergence(JsonObjectConst c, const char* ref) {
  JsonArrayConst refs = c["divergence"]["refs"];
  for (JsonVariantConst r : refs) {
    if (std::strcmp(r | "", ref) == 0) return true;
  }
  return false;
}

void run_current_case() {
  JsonObjectConst c = g_cases[g_index];
  const std::string id = c["id"] | "(unnamed)";

  const std::tm local = clock_from(c["now"], id);
  const std::time_t unix_now = to_unix(local);
  const std::string now_iso = format_iso8601(unix_now);

  const AttendanceState state = state_from(c["state"]);
  const Actual got = normalize(compute_check_in_action(state, local, unix_now));

  // A divergent case asserts against the RECORDED C++ behaviour, not the spec.
  // Both sides stay pinned, so unintended drift inside a known-bad case still
  // fails — which a skip would not catch.
  JsonObjectConst divergence = c["divergence"];
  const bool is_divergent = !divergence.isNull();
  JsonObjectConst want = is_divergent ? divergence["cpp"].as<JsonObjectConst>()
                                      : c["expect"].as<JsonObjectConst>();

  compare(id, want, got, now_iso);

  if (is_divergent) {
    std::string refs;
    for (JsonVariantConst r : divergence["refs"].as<JsonArrayConst>()) {
      if (!refs.empty()) refs += ",";
      refs += r | "";
    }
    g_divergent.push_back(id + " [" + refs + "] spec=" +
                          std::string(c["expect"]["action"] | "?") +
                          " device=" + std::string(got.action));
  }
}

// ── Guards and reports ───────────────────────────────────────────────────────

void test_fixture_loaded() {
  // A path typo or an empty allow-list entry must fail loudly. Running zero
  // cases and reporting success is the exact failure mode this whole exercise
  // exists to prevent.
  TEST_ASSERT_NOT_NULL_MESSAGE(g_cases, "fixture has no `cases` array");
  TEST_ASSERT_GREATER_THAN_MESSAGE(0, g_cases.size(), "fixture contains zero cases");
  TEST_ASSERT_EQUAL_INT_MESSAGE(1, g_doc["schema_version"] | 0,
                                "fixture schema_version is not the one this harness reads");
  TEST_ASSERT_EQUAL_STRING_MESSAGE("UTC", g_doc["timezone"]["policy"] | "",
                                   "fixture no longer pins the UTC timezone policy");
}

void test_thresholds_match_the_port() {
  // The port hard-codes its constants (state_machine.cpp:11-24) instead of
  // reading TIME_THRESHOLDS. This pins the ones that agree, so a threshold
  // edit on the TS side cannot pass unnoticed on this side. CHECKOUT_HOUR and
  // CHECKOUT_MINUTE are deliberately absent — that pair IS divergence D1.
  JsonObjectConst t = g_doc["thresholds"];
  TEST_ASSERT_EQUAL_INT_MESSAGE(10, t["LATE_HOUR"] | -1, "LATE_HOUR drifted");
  TEST_ASSERT_EQUAL_INT_MESSAGE(1, t["LATE_MINUTE"] | -1, "LATE_MINUTE drifted");
  TEST_ASSERT_EQUAL_INT_MESSAGE(13, t["LUNCH_START_HOUR"] | -1, "LUNCH_START_HOUR drifted");
  TEST_ASSERT_EQUAL_INT_MESSAGE(14, t["LUNCH_END_HOUR"] | -1, "LUNCH_END_HOUR drifted");
  TEST_ASSERT_EQUAL_INT_MESSAGE(14, t["LUNCH_LATE_HOUR"] | -1, "LUNCH_LATE_HOUR drifted");
  TEST_ASSERT_EQUAL_INT_MESSAGE(1, t["LUNCH_LATE_MINUTE"] | -1, "LUNCH_LATE_MINUTE drifted");
  TEST_ASSERT_EQUAL_INT_MESSAGE(14, t["FRIDAY_CHECKOUT_HOUR"] | -1,
                                "FRIDAY_CHECKOUT_HOUR drifted");
  TEST_ASSERT_EQUAL_INT_MESSAGE(0, t["FRIDAY_CHECKOUT_MINUTE"] | -1,
                                "FRIDAY_CHECKOUT_MINUTE drifted");
}

/**
 * D2a guard.
 *
 * The port's CheckOut branch writes only time_out_iso — it never populates
 * lunch_events_after or lunch_status. The spec closes an open lunch in that
 * same write. Today the defect is unobservable because the late-lunch-return
 * step runs first and catches every at-lunch state from 14:00 onward, and both
 * check-out cutoffs are at or after 14:00, so CheckOut is never reached with an
 * open lunch.
 *
 * That mask is load-bearing, so it is asserted rather than assumed: the moment
 * someone "fixes" D2 by swapping the step order, CheckOut starts firing here
 * and this guard turns a silent field-loss bug into a named failure.
 */
void test_d2a_mask_holds() {
  for (size_t i = 0; i < g_cases.size(); ++i) {
    JsonObjectConst c = g_cases[i];
    if (!refs_divergence(c, "D2a")) continue;

    const std::string id = c["id"] | "(unnamed)";
    const std::tm local = clock_from(c["now"], id);
    const std::time_t unix_now = to_unix(local);
    const AttendanceState state = state_from(c["state"]);
    const CheckInAction a = compute_check_in_action(state, local, unix_now);

    const bool open_lunch =
        (!state.lunch_events.empty() &&
         state.lunch_events.back().type == LunchEvent::Out) ||
        (state.has_lunch_out_legacy && !state.has_lunch_in_legacy);
    if (a.type != ActionType::CheckOut || !open_lunch) continue;

    if (a.lunch_events_after.empty() || !a.set_lunch_status) {
      TEST_FAIL_MESSAGE(msg(
          id + ": D2a is now UNMASKED. CheckOut fired with an open lunch but "
               "populated neither lunch_events nor lunch_status, so the lunch "
               "close the spec performs is silently dropped on the device. "
               "Reordering the steps (D2) alone does not fix this - the "
               "CheckOut branch in state_machine.cpp must also close the lunch."));
    }
  }
}


void test_absence_sweep_is_unported() {
  // D4: findLearnersToMarkAbsent has no C++ counterpart, so these cases cannot
  // execute here. Reported rather than silently absent.
  TEST_ASSERT_EQUAL_STRING_MESSAGE("D4", g_doc["absence_sweep"]["divergence"] | "",
                                   "absence_sweep no longer declares divergence D4");
  TEST_ASSERT_GREATER_THAN_MESSAGE(0, g_sweep.size(),
                                   "absence_sweep declares no cases");

  std::printf("\n  KNOWN DIVERGENT D4 — findLearnersToMarkAbsent is not ported to C++.\n");
  std::printf("  %u spec-only case(s), run by the Vitest harness alone:\n",
              static_cast<unsigned>(g_sweep.size()));
  for (JsonObjectConst c : g_sweep) {
    std::printf("    - %s\n", c["id"] | "(unnamed)");
  }
  std::printf("\n");
}

void test_divergence_report() {
  JsonObjectConst registry = g_doc["divergences"];
  TEST_ASSERT_GREATER_THAN_MESSAGE(0, registry.size(), "fixture has no divergence registry");

  std::printf("\n  KNOWN DIVERGENT — recorded, not failed. Product decision outstanding.\n\n");
  for (JsonPairConst entry : registry) {
    JsonObjectConst d = entry.value().as<JsonObjectConst>();
    std::printf("  %s  %s\n", entry.key().c_str(), d["title"] | "");
    std::printf("        spec:   %s\n", d["ts"] | "");
    std::printf("        device: %s\n", d["cpp"] | "");
    const char* masked = d["masked_by"] | "";
    if (masked[0] != '\0') {
      std::printf("        masked by %s — not observable in isolation today\n", masked);
    }
  }
  std::printf("\n  %u of %u state-machine cases asserted against recorded C++ behaviour:\n",
              static_cast<unsigned>(g_divergent.size()),
              static_cast<unsigned>(g_cases.size()));
  for (const std::string& line : g_divergent) {
    std::printf("    - %s\n", line.c_str());
  }
  std::printf("\n");

  // Every divergent case must genuinely still differ. A case that converged
  // should be promoted out of the divergent set, not left as a false alarm.
  for (size_t i = 0; i < g_cases.size(); ++i) {
    JsonObjectConst c = g_cases[i];
    JsonObjectConst div = c["divergence"];
    if (div.isNull()) continue;
    const std::string id = c["id"] | "(unnamed)";
    const char* spec_action = c["expect"]["action"] | "";
    const char* cpp_action = div["cpp"]["action"] | "";
    if (std::strcmp(spec_action, cpp_action) == 0) {
      // Same action name is allowed only when the fields still differ; the
      // Vitest harness enforces the deep comparison, so here just require the
      // note and refs that make the case reviewable.
      TEST_ASSERT_GREATER_THAN_MESSAGE(
          0, std::strlen(div["note"] | ""),
          msg(id + ": divergent case has no note explaining the difference"));
    }
  }
}

std::string read_file(const char* path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return std::string();
  std::ostringstream buf;
  buf << in.rdbuf();
  return buf.str();
}

}  // namespace

void run_all() {
  const char* path = LL_ATTENDANCE_FIXTURE;
  const std::string raw = read_file(path);
  if (raw.empty()) {
    // Fail as a Unity test rather than aborting, so the rest of the suite still
    // reports and the message names the path that was tried.
    g_msg = std::string("cannot read attendance fixture at ") + path;
    UnityDefaultTestRun([]() { TEST_FAIL_MESSAGE(g_msg.c_str()); },
                        "fixture/load", __LINE__);
    return;
  }

  const DeserializationError err = deserializeJson(g_doc, raw);
  if (err) {
    g_msg = std::string("cannot parse attendance fixture: ") + err.c_str();
    UnityDefaultTestRun([]() { TEST_FAIL_MESSAGE(g_msg.c_str()); },
                        "fixture/parse", __LINE__);
    return;
  }

  g_cases = g_doc["cases"].as<JsonArrayConst>();
  g_sweep = g_doc["absence_sweep"]["cases"].as<JsonArrayConst>();


  UnityDefaultTestRun(test_fixture_loaded, "fixture/loaded", __LINE__);
  UnityDefaultTestRun(test_thresholds_match_the_port, "fixture/thresholds", __LINE__);

  for (size_t i = 0; i < g_cases.size(); ++i) {
    g_index = i;
    g_name = std::string("fixture/") + (g_cases[i]["id"] | "(unnamed)");
    UnityDefaultTestRun(run_current_case, g_name.c_str(), __LINE__);
  }

  UnityDefaultTestRun(test_d2a_mask_holds, "fixture/guard_D2a_mask", __LINE__);
  UnityDefaultTestRun(test_absence_sweep_is_unported, "fixture/report_D4_unported", __LINE__);
  UnityDefaultTestRun(test_divergence_report, "fixture/report_divergences", __LINE__);
}

}  // namespace llattender_fixture
