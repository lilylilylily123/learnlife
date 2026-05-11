// LearnLife NFC Attender — firmware bootstrap.
//
// setup() initialises every subsystem via its module header. loop() stays
// empty; the real work runs in pinned FreeRTOS tasks so the NFC reader
// keeps responding even when the network task is blocked on TLS.
//
// Phase-1 wiring: the per-scan path is connected end-to-end, but the network
// task currently logs and discards writes — pb_client and roster are stubs
// until phases 2-3.

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>
#include <LittleFS.h>
#include <WiFi.h>
#include <esp_system.h>

#include <cstdio>
#include <cstring>
#include <string>

#include "attendance_adapter.h"
#include "buzzer.h"
#include "config.h"
#include "fields.h"
#include "nfc.h"
#include "pb_client.h"
#include "queue.h"
#include "roster.h"
#include "state_machine.h"
#include "time_sync.h"
#include "ui.h"

namespace {

using namespace llattender;

// ── Inter-task queues ────────────────────────────────────────────────────
struct ScanMsg {
  char uid_hex[24];
};

struct UiMsg {
  ui::Event event;
  char name[64];
};

QueueHandle_t g_scan_q = nullptr;
QueueHandle_t g_ui_q = nullptr;
QueueHandle_t g_flush_signal = nullptr;  // any-value signal to wake the network task

// Most recently resolved learner — used by the `w` (wipe) serial command so
// the user can clear today's PB row for whoever just tapped without having
// to remember IDs.
std::string g_last_learner_id;

void post_ui(ui::Event ev, const char* name = "") {
  UiMsg m{};
  m.event = ev;
  if (name) {
    std::strncpy(m.name, name, sizeof(m.name) - 1);
  }
  if (g_ui_q) xQueueSend(g_ui_q, &m, 0);
}

// Map a state-machine outcome to a UI event.
ui::Event ui_event_for_action(const llattender::CheckInAction& a) {
  using AT = llattender::ActionType;
  switch (a.type) {
    case AT::CheckIn:
      return a.status == llattender::Status::Late ? ui::Event::CheckInLate
                                                  : ui::Event::CheckInPresent;
    case AT::LunchEvent:
      if (!a.set_lunch_status) return ui::Event::LunchOut;
      return a.lunch_status == llattender::Status::Late ? ui::Event::LunchInLate
                                                        : ui::Event::LunchIn;
    case AT::LateLunchReturn:
      return ui::Event::LunchInLate;
    case AT::CheckOut:
      return ui::Event::CheckOut;
    case AT::Locked:
      return ui::Event::ScanLocked;
    case AT::NoAction:
      return ui::Event::AlreadyDone;
  }
  return ui::Event::AlreadyDone;
}

// ── Tasks ────────────────────────────────────────────────────────────────

[[noreturn]] void nfc_task(void*) {
  std::string uid;
  for (;;) {
    if (nfc::poll_uid(uid)) {
      ScanMsg m{};
      std::strncpy(m.uid_hex, uid.c_str(), sizeof(m.uid_hex) - 1);
      xQueueSend(g_scan_q, &m, 0);
    }
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

// Format a local-time tm as the "YYYY-MM-DD" string PocketBase stores in
// `attendance.date`. Mirrors `new Date().toISOString().split("T")[0]`.
std::string format_yyyy_mm_dd(const std::tm& t) {
  char buf[16];
  std::snprintf(buf, sizeof(buf), "%04d-%02d-%02d",
                t.tm_year + 1900, t.tm_mon + 1, t.tm_mday);
  return buf;
}

[[noreturn]] void processor_task(void*) {
  ScanMsg in{};
  for (;;) {
    if (xQueueReceive(g_scan_q, &in, portMAX_DELAY) != pdTRUE) continue;

    const std::string uid_hex = in.uid_hex;
    const auto* learner = roster::lookup_by_uid(uid_hex);
    if (learner == nullptr) {
      Serial.printf("[proc] unknown UID %s\n", uid_hex.c_str());
      post_ui(ui::Event::UnknownCard);
      continue;
    }
    g_last_learner_id = learner->id;

    auto now_local = time_sync::now_local();
    auto now_unix = time_sync::now_unix();
    const std::string today = format_yyyy_mm_dd(now_local);

    // Pull today's row from PocketBase so the state machine sees the real
    // history (existing time_in, lunch_events, etc.). Synchronous TLS call
    // adds ~1s of latency per scan — acceptable for phase 2; phase 3 swaps
    // this for an on-disk snapshot refreshed by the network task.
    pb_client::AttendanceRow row;
    bool created = false;
    AttendanceState state;
    bool have_state = false;
    if (WiFi.status() == WL_CONNECTED &&
        pb_client::ensure_today_row(learner->id, today, row, created)) {
      attendance_adapter::state_from_row(row, state);
      have_state = true;
    } else {
      Serial.println("[proc] offline — running state machine on empty state");
    }

    auto action = compute_check_in_action(state, now_local, now_unix);

    ui::Event ev = ui_event_for_action(action);
    // "All set today" should only show when the whole day is complete
    // (time_in + time_out both set). Mid-day re-taps get a softer
    // "Already in" instead.
    if (action.type == ActionType::NoAction &&
        state.has_time_in && !state.has_time_out) {
      ev = ui::Event::AlreadyIn;
    }
    post_ui(ev, learner->name.c_str());

    // NoAction / Locked: nothing to write, just the UI + buzzer feedback.
    if (action.type == ActionType::NoAction ||
        action.type == ActionType::Locked) continue;

    // Update the in-memory cache with the predicted post-action state so a
    // quick follow-up tap of the same card sees correct state instead of
    // repeating the same action.
    pb_client::update_today_cache_after_action(learner->id, action);

    // Serialise the action fields and append to the offline queue so the
    // network task can flush them when WiFi is up.
    queue::PendingScan p;
    p.learner_id = learner->id;
    p.attendance_id = have_state ? row.id : std::string{};
    p.ts_unix = now_unix;
    p.fields_json = fields::serialize_action(action);
    queue::append(p);
    if (g_flush_signal) xQueueSend(g_flush_signal, &p.ts_unix, 0);
  }
}

[[noreturn]] void ui_task(void*) {
  UiMsg m{};
  for (;;) {
    // Short timeout so the OLED clock keeps ticking and the network-error
    // glyph can blink even when no event is pending.
    if (xQueueReceive(g_ui_q, &m, pdMS_TO_TICKS(50)) == pdTRUE) {
      ui::show(m.event, m.name[0] ? m.name : nullptr);
      buzzer::cue(m.event);
    }
    ui::tick();
  }
}

[[noreturn]] void network_task(void*) {
  bool last_online = false;
  for (;;) {
    bool online = WiFi.status() == WL_CONNECTED;
    if (online != last_online) {
      ui::set_network_error(!online);
      last_online = online;
      if (online) {
        time_sync::sync_ntp();
        // First-online roster refresh; in phase 3 also drain on schedule.
        std::vector<pb_client::LearnerRow> items;
        if (pb_client::login() && pb_client::fetch_roster(items)) {
          roster::replace(items);
          // Pre-fetch today's attendance rows once. Every learner's first
          // tap of the day now hits cache instead of doing two TLS calls.
          auto t = time_sync::now_local();
          char date[16];
          std::snprintf(date, sizeof(date), "%04d-%02d-%02d",
                        t.tm_year + 1900, t.tm_mon + 1, t.tm_mday);
          // Try the on-disk snapshot first (free, survives reboots). Only
          // fall through to the network pre-fetch if the cache is missing
          // or stale.
          if (!pb_client::load_today_cache_from_disk(date)) {
            pb_client::prefetch_today_attendance(date);
          }
        }
      }
    }

    // Wait for a flush signal or 5s timeout, whichever comes first.
    int64_t dummy = 0;
    xQueueReceive(g_flush_signal, &dummy, pdMS_TO_TICKS(5000));

    if (online && queue::size() > 0) {
      queue::drain([](const queue::PendingScan& s) {
        // Online scans already carry an attendance_id (populated by
        // processor_task). Offline scans don't — for those we ensure the row
        // exists before patching. Either way, only the patch fields are taken
        // from the queued entry; the local state machine already produced
        // them and the row's other fields stay untouched.
        std::string id = s.attendance_id;
        if (id.empty()) {
          // Re-derive today from ts_unix so a queued entry that survives a
          // midnight rollover still hits its original date.
          std::time_t t = s.ts_unix;
          std::tm tm{};
          localtime_r(&t, &tm);
          char date[16];
          std::snprintf(date, sizeof(date), "%04d-%02d-%02d",
                        tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday);
          pb_client::AttendanceRow row;
          bool created = false;
          if (!pb_client::ensure_today_row(s.learner_id, date, row, created)) {
            return false;  // keep on queue, retry next cycle
          }
          id = row.id;
        }
        return pb_client::patch_attendance(id, s.fields_json);
      });
    }
  }
}

}  // namespace

const char* reset_reason_str(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_POWERON:  return "power-on";
    case ESP_RST_EXT:      return "external pin";
    case ESP_RST_SW:       return "software";
    case ESP_RST_PANIC:    return "panic";
    case ESP_RST_INT_WDT:  return "int watchdog";
    case ESP_RST_TASK_WDT: return "task watchdog";
    case ESP_RST_WDT:      return "other watchdog";
    case ESP_RST_DEEPSLEEP:return "deep-sleep wake";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_SDIO:     return "SDIO";
    case ESP_RST_UNKNOWN:
    default:               return "unknown";
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[boot] LearnLife NFC Attender starting");
  Serial.printf("[boot] build %s %s\n", __DATE__, __TIME__);
  Serial.printf("[boot] reset reason: %s\n",
                reset_reason_str(esp_reset_reason()));

  g_scan_q = xQueueCreate(8, sizeof(ScanMsg));
  g_ui_q = xQueueCreate(16, sizeof(UiMsg));
  g_flush_signal = xQueueCreate(4, sizeof(int64_t));

  using namespace llattender;
  if (!LittleFS.begin(/*formatOnFail=*/true)) {
    Serial.println("[fs] LittleFS mount failed — persistence disabled");
  } else {
    Serial.println("[fs] LittleFS mounted");
  }
  ui::init();
  buzzer::init();
  time_sync::init();

  // Watch Serial briefly for "RESET" — easiest way for the user to wipe
  // saved WiFi/PB credentials and re-enter the captive-portal flow.
  config::check_factory_reset_command();

  config::DeviceConfig cfg;
  config::load(cfg);

  if (!config::is_provisioned()) {
    post_ui(ui::Event::Boot, "Setup mode");
    config::run_provisioning();
    // TODO: once provisioning is implemented this branch will reboot.
  }

  if (!nfc::init()) {
    Serial.println("[boot] NFC init failed — continuing in degraded mode");
    ui::set_network_error(true);  // reuse the error indicator for now
  }

  WiFi.mode(WIFI_STA);
  if (!cfg.wifi_ssid.empty()) {
    WiFi.begin(cfg.wifi_ssid.c_str(), cfg.wifi_pw.c_str());
  }

  roster::init();
  queue::init();

  xTaskCreatePinnedToCore(nfc_task,       "nfc",  4096, nullptr, 5, nullptr, 0);
  xTaskCreatePinnedToCore(processor_task, "proc", 8192, nullptr, 4, nullptr, 1);
  xTaskCreatePinnedToCore(ui_task,        "ui",   4096, nullptr, 3, nullptr, 1);
  xTaskCreatePinnedToCore(network_task,   "net",  8192, nullptr, 3, nullptr, 0);

  Serial.println("[boot] tasks running");
}

// Test-mode serial console. Reads single-line commands from Serial so the
// user can exercise the state machine without waiting for real time:
//   t HH:MM [W]   override hour/minute (W = 0..6, 1=Mon; optional weekday)
//   t off         clear time override
//   c             clear today cache (next tap re-fetches from PB)
//   ?             help
void handle_console_line(const std::string& line) {
  if (line.empty()) return;
  if (line == "?" || line == "h" || line == "help") {
    Serial.println("[cli] commands:");
    Serial.println("[cli]   t HH:MM [W]  override clock (W: 0=Sun..6=Sat)");
    Serial.println("[cli]   t off        clear override");
    Serial.println("[cli]   c            clear local today-cache");
    Serial.println("[cli]   w            wipe PB row for last-scanned learner");
    Serial.println("[cli]   ?            this help");
    return;
  }
  if (line == "c") {
    llattender::pb_client::clear_today_cache();
    return;
  }
  if (line == "w") {
    if (g_last_learner_id.empty()) {
      Serial.println("[cli] no learner scanned yet — tap a card first");
      return;
    }
    auto t = llattender::time_sync::now_local();
    char date[16];
    std::snprintf(date, sizeof(date), "%04d-%02d-%02d",
                  t.tm_year + 1900, t.tm_mon + 1, t.tm_mday);
    llattender::pb_client::AttendanceRow row;
    bool created = false;
    if (!llattender::pb_client::ensure_today_row(g_last_learner_id, date,
                                                 row, created)) {
      Serial.println("[cli] wipe: couldn't find PB row");
      return;
    }
    const std::string body =
        "{\"time_in\":\"\",\"time_out\":\"\","
        "\"lunch_events\":\"[]\","
        "\"status\":\"\",\"lunch_status\":\"\"}";
    if (llattender::pb_client::patch_attendance(row.id, body)) {
      Serial.printf("[cli] wiped PB row %s for learner %s\n",
                    row.id.c_str(), g_last_learner_id.c_str());
      llattender::pb_client::clear_today_cache();
    } else {
      Serial.println("[cli] wipe: PATCH failed");
    }
    return;
  }
  if (line.rfind("t ", 0) == 0) {
    std::string arg = line.substr(2);
    if (arg == "off") {
      llattender::time_sync::clear_time_override();
      Serial.println("[cli] time override cleared");
      return;
    }
    int hh = -1, mm = -1, w = -1;
    int parsed = std::sscanf(arg.c_str(), "%d:%d %d", &hh, &mm, &w);
    if (parsed >= 2 && hh >= 0 && hh < 24 && mm >= 0 && mm < 60) {
      llattender::time_sync::set_time_override(hh, mm, w);
      if (w >= 0) {
        Serial.printf("[cli] time override: %02d:%02d wday=%d\n", hh, mm, w);
      } else {
        Serial.printf("[cli] time override: %02d:%02d\n", hh, mm);
      }
      return;
    }
  }
  Serial.printf("[cli] unknown: '%s' (type ? for help)\n", line.c_str());
}

void loop() {
  // Test-mode console: read line-terminated commands from Serial. Echoes
  // every char back so the user can see what they're typing — pio monitor
  // doesn't do local echo by default. Accept either \r or \n as terminator
  // since terminals disagree on which they send.
  static std::string buf;
  while (Serial.available() > 0) {
    char c = static_cast<char>(Serial.read());
    if (c == '\r' || c == '\n') {
      Serial.write('\n');
      if (!buf.empty()) {
        handle_console_line(buf);
        buf.clear();
      }
    } else if (c == 0x7f || c == 0x08) {  // backspace / delete
      if (!buf.empty()) {
        buf.pop_back();
        Serial.write("\b \b");
      }
    } else if (c >= 0x20 && c < 0x7f) {  // printable ASCII
      buf += c;
      Serial.write(c);
      if (buf.size() > 64) {
        buf.clear();
        Serial.println("\n[cli] line too long, cleared");
      }
    }
  }
  vTaskDelay(pdMS_TO_TICKS(50));
}

#endif  // LLATTENDER_NATIVE_BUILD
