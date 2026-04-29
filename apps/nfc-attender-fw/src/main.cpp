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
#include <WiFi.h>

#include <cstring>
#include <string>

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

    // TODO (phase 2): pull today's snapshot from a local map keyed by
    // learner.id. For now run the state machine against an empty snapshot,
    // which yields a CheckIn on every tap — not correct in production but
    // exercises the pipeline end-to-end.
    llattender::AttendanceState state;
    auto now_local = time_sync::now_local();
    auto now_unix = time_sync::now_unix();
    auto action = compute_check_in_action(state, now_local, now_unix);

    post_ui(ui_event_for_action(action), learner->name.c_str());

    // NoAction: nothing to write, just the UI feedback above.
    if (action.type == ActionType::NoAction) continue;

    // Serialise the action fields and append to the offline queue so the
    // network task can flush them when WiFi is up.
    queue::PendingScan p;
    p.learner_id = learner->id;
    p.ts_unix = now_unix;
    p.fields_json = fields::serialize_action(action);
    queue::append(p);
    if (g_flush_signal) xQueueSend(g_flush_signal, &p.ts_unix, 0);
  }
}

[[noreturn]] void ui_task(void*) {
  UiMsg m{};
  for (;;) {
    if (xQueueReceive(g_ui_q, &m, portMAX_DELAY) != pdTRUE) continue;
    ui::show(m.event, m.name[0] ? m.name : nullptr);
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
        }
      }
    }

    // Wait for a flush signal or 5s timeout, whichever comes first.
    int64_t dummy = 0;
    xQueueReceive(g_flush_signal, &dummy, pdMS_TO_TICKS(5000));

    if (online && queue::size() > 0) {
      queue::drain([](const queue::PendingScan& s) {
        // TODO (phase 2): look up s.attendance_id, call patch_attendance.
        return pb_client::patch_attendance(s.attendance_id, s.fields_json);
      });
    }
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[boot] LearnLife NFC Attender starting");

  g_scan_q = xQueueCreate(8, sizeof(ScanMsg));
  g_ui_q = xQueueCreate(16, sizeof(UiMsg));
  g_flush_signal = xQueueCreate(4, sizeof(int64_t));

  using namespace llattender;
  ui::init();
  time_sync::init();
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

void loop() {
  // All work happens in the pinned tasks above.
  vTaskDelay(pdMS_TO_TICKS(1000));
}

#endif  // LLATTENDER_NATIVE_BUILD
