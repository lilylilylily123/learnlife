// LearnLife NFC Attender — firmware bootstrap.
//
// setup() initialises every subsystem via its module header. loop() stays
// empty; the real work runs in four pinned FreeRTOS tasks so the NFC reader
// keeps responding even when the network task is blocked on TLS:
//
//   nfc  (core 0, prio 5)  poll the PN532, debounce, emit UIDs
//   proc (core 1, prio 4)  UID -> learner, clock gate, state machine, enqueue
//   ui   (core 1, prio 3)  drive the OLED and buzzer
//   net  (core 0, prio 3)  WiFi, NTP, PocketBase, OTA, queue drain
//
// The tap path never touches the network: proc reads the today-cache only
// (pb_client::lookup_today_row) and appends to the durable queue, and net
// creates rows, recomputes cache-miss entries against the authoritative row,
// and PATCHes. That split is what keeps ~80 morning check-ins from serialising
// behind one TLS handshake each.

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
#include "clock_gate.h"
#include "config.h"
#include "fields.h"
#include "nfc.h"
#include "ota.h"
#include "pb_client.h"
#include "queue.h"
#include "roster.h"
#include "state_machine.h"
#include "time_sync.h"
#include "ui.h"
#include "version.h"

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
      // Never drop a tap silently. Timeout stays 0 — nfc_task must keep
      // polling the reader — but the learner has to be told, or they walk
      // away believing they signed in.
      if (xQueueSend(g_scan_q, &m, 0) != pdTRUE) {
        Serial.println("[nfc] scan queue full — tap dropped");
        post_ui(ui::Event::ScanBusy);
      }
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

    // Drop scans while firmware is being written. A tap acknowledged on the
    // OLED now would be wiped by the reboot that follows, which is worse than
    // simply not reading the card — the learner would believe they signed in.
    if (ota::in_progress()) {
      Serial.println("[proc] OTA in progress — ignoring scan");
      continue;
    }

    const std::string uid_hex = in.uid_hex;
    const auto* learner = roster::lookup_by_uid(uid_hex);
    if (learner == nullptr) {
      Serial.printf("[proc] unknown UID %s\n", uid_hex.c_str());
      post_ui(ui::Event::UnknownCard);
      continue;
    }
    g_last_learner_id = learner->id;

    // Refuse to act on an untrusted clock.
    //
    // There is no DS3231 in this build, so until NTP lands the ESP32 believes
    // it is 1970-01-01. Every threshold in the state machine is time-of-day
    // based — 10:01 decides present vs late — so acting now would silently
    // mark everyone `present` and stamp the PocketBase rows with a 1970 date,
    // which then has to be unpicked by hand.
    //
    // Being visibly unavailable for the first few seconds after power-on is
    // much cheaper than being confidently wrong all morning. See
    // src/clock_gate.h.
    if (!clock_gate::may_write_attendance(time_sync::is_synced(),
                                          time_sync::has_time_override())) {
      Serial.printf("[proc] clock not trusted — refusing to record tap by %s\n",
                    learner->name.c_str());
      post_ui(ui::Event::WaitingClock, learner->name.c_str());
      continue;
    }

    auto now_local = time_sync::now_local();
    auto now_unix = time_sync::now_unix();
    const std::string today = format_yyyy_mm_dd(now_local);

    // Cache-only. processor_task must never block on TLS: at ~80 learners the
    // morning rush is ~80 consecutive cache misses, and a synchronous
    // handshake per tap (a GET plus a POST, ~2 s) would overrun the scan
    // queue and drop taps silently. A miss runs the state machine on an empty
    // state — correct for a first tap of the day — and network_task creates
    // the row during drain, where it also recomputes the action against the
    // authoritative row (see the empty attendance_id branch below).
    pb_client::AttendanceRow row;
    AttendanceState state;
    bool have_state = false;
    if (pb_client::lookup_today_row(learner->id, today, row)) {
      attendance_adapter::state_from_row(row, state);
      have_state = true;
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
    ui::set_pending_count(queue::size());
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

// How often the network task asks PocketBase for attendance rows changed since
// the last poll. Without this, a dashboard-side change (Reset day, a
// justification, a manual time edit) never reaches the firmware — the cache
// stays pinned to whatever PB had at the last reconnect or local action.
//
// 30 s, not 10 s, and the number comes from arithmetic rather than taste:
//
//   PocketHost allows 1000 requests/hour PER IP
//   (x-pockethost-ratelimit-ip-hourly-limit), and both devices plus the Tauri
//   dashboard sit behind the school's single NAT'd address.
//
//     at 10 s: 360 req/h/device -> 720/h for two devices = 72% of the budget
//              spent doing nothing
//     at 30 s: 120 req/h/device -> 240/h, leaving room for scans, roster
//              refreshes and the dashboard
//
// The cost is latency: a guide who presses "Reset day" and walks to the reader
// sees it within 30 s instead of 10. That is still faster than the walk.
//
// This is a DELTA poll (`updated > watermark`), so the normal case is one
// request returning an empty page — far cheaper than the full re-fetch this
// replaced, which is what OOMed on 61 rows.
constexpr int64_t kDeltaPollMs = 30000;

// How often to retry NTP while online but still without a trusted clock.
// Until this succeeds the device refuses to record attendance (clock_gate),
// so it is effectively out of service — retry briskly, but not so fast that a
// blocked UDP/123 (common on school networks) turns into a busy loop.
constexpr int64_t kNtpRetryMs = 30000;

[[noreturn]] void network_task(void*) {
  bool last_online = false;
  int64_t last_prefetch_ms = 0;
  int64_t last_ntp_try_ms = 0;
  for (;;) {
    bool online = WiFi.status() == WL_CONNECTED;
    if (online != last_online) {
      ui::set_network_error(!online);
      last_online = online;
      if (online) {
        time_sync::sync_ntp();
        last_ntp_try_ms = millis();
        // OTA needs an IP, so it can only start once WiFi is actually up.
        // init() is idempotent; re-running it on a reconnect is harmless.
        {
          config::DeviceConfig c;
          config::load(c);
          ota::init(c.device_id, c.ota_password);
        }
        // First-online roster refresh; in phase 3 also drain on schedule.
        std::vector<pb_client::LearnerRow> items;
        if (pb_client::ensure_token() && pb_client::fetch_roster(items)) {
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
          last_prefetch_ms = millis();
        }
      }
    }

    // Pump OTA before the long block below. handle() is cheap when idle, but
    // it has to be called often enough that an upload attempt isn't left
    // waiting up to 5 seconds for the queue timeout to expire.
    for (int i = 0; i < 50; ++i) {
      ota::tick();
      if (ota::in_progress()) {
        // Give the transfer the whole task. Nothing else here matters while
        // firmware is being written, and competing for the CPU would only
        // slow it down.
        vTaskDelay(pdMS_TO_TICKS(10));
        continue;
      }
      vTaskDelay(pdMS_TO_TICKS(2));
    }

    // Wait for a flush signal or 5s timeout, whichever comes first.
    int64_t dummy = 0;
    xQueueReceive(g_flush_signal, &dummy, pdMS_TO_TICKS(5000));

    // Keep retrying NTP while the clock is untrusted. Without this the only
    // sync attempt is the one on the offline->online edge, so a single failed
    // sync (a slow DHCP lease, a firewall dropping UDP/123 for the first few
    // seconds) would leave the device refusing every tap until someone power
    // cycles it or the WiFi drops and returns.
    if (online && !time_sync::is_synced() &&
        static_cast<int64_t>(millis()) - last_ntp_try_ms >= kNtpRetryMs) {
      last_ntp_try_ms = millis();
      Serial.println("[net] clock still untrusted — retrying NTP");
      if (time_sync::sync_ntp()) {
        // The idle screen shows "--:--" until this point; force a repaint so
        // the real time appears without waiting for the next tap.
        ui::show(ui::Event::Idle);
      }
    }

    if (online && queue::size() > 0) {
      queue::drain_ex([](const queue::PendingScan& s) -> WriteOutcome {
        // Entries queued against a warm cache already carry an
        // attendance_id and replay their original fields unchanged — those
        // were computed against the authoritative row and are correct.
        //
        // Entries with no attendance_id were computed on a cache MISS, i.e.
        // against an empty state, so they cannot have seen an excusal
        // (jLate/jAbsent inheritance) or a time_in written by another client.
        // For those we ensure the row exists and then recompute.
        std::string id = s.attendance_id;
        std::string fields_json = s.fields_json;
        // Set only on the recompute path. The cache must NOT be updated
        // until the PATCH actually lands: an optimistic update followed by a
        // RetryLater would leave the cache claiming a time_in that was never
        // written, and the retry would then recompute to NoAction and DROP
        // the check-in.
        bool have_recomputed = false;
        CheckInAction recomputed_action;
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
            // Couldn't find or create the row — almost always the network.
            // Keep the entry and try again next cycle.
            return WriteOutcome::RetryLater;
          }
          id = row.id;

          // Recompute against the authoritative row rather than replaying
          // fields computed from an empty state. This is what makes the
          // jLate/jAbsent inheritance correct on a cold cache, and it drops a
          // check-in whose precondition no longer holds instead of
          // overwriting an existing time_in.
          AttendanceState authoritative;
          attendance_adapter::state_from_row(row, authoritative);
          const auto recomputed =
              compute_check_in_action(authoritative, tm, s.ts_unix);
          if (recomputed.type == ActionType::NoAction ||
              recomputed.type == ActionType::Locked) {
            Serial.printf("[net] scan for learner %s no longer applicable — "
                          "dropping\n", s.learner_id.c_str());
            // Ok: drop the entry, nothing to write.
            return WriteOutcome::Ok;
          }
          fields_json = fields::serialize_action(recomputed);
          recomputed_action = recomputed;
          have_recomputed = true;
        }

        // Classify by HTTP status rather than a bare bool. A 404 means the row
        // was deleted server-side and no number of retries will change that —
        // and because a failed drain stops at the head of the queue, retrying
        // it forever would block every scan queued behind it.
        const int code = pb_client::patch_attendance_status(id, fields_json);
        if (code == 401) {
          // Token rejected. Drop it so the next cycle logs in again rather
          // than replaying a credential the server has already refused. The
          // entry stays queued (401 classifies as RetryLater).
          Serial.println("[net] 401 — clearing cached token");
          pb_client::clear_token();
        }
        const WriteOutcome outcome = classify_http_status(code);
        if (outcome == WriteOutcome::Ok && have_recomputed) {
          // Now that the write has landed, fold the recomputed mutations onto
          // the authoritative cache entry ensure_today_row installed, so a
          // follow-up tap by this learner reads real state instead of a blank
          // row.
          pb_client::update_today_cache_after_action(s.learner_id,
                                                    recomputed_action);
        }
        if (outcome == WriteOutcome::PermanentFail) {
          Serial.printf("[net] giving up on scan for learner %s (HTTP %d) — "
                        "moved to dead-letter file\n",
                        s.learner_id.c_str(), code);
        }
        return outcome;
      });
      ui::set_pending_count(queue::size());
    }

    // Periodic delta poll. Previously disabled: the old full re-fetch OOMed on
    // a 61-row page, because it copied the whole body into a JsonDocument and
    // built a vector of rows on top. Both allocations are gone — the response
    // is parsed straight off the socket into the cache — so this is live again.
    if (online &&
        static_cast<int64_t>(millis()) - last_prefetch_ms >= kDeltaPollMs) {
      last_prefetch_ms = millis();
      auto t = time_sync::now_local();
      char date[16];
      std::snprintf(date, sizeof(date), "%04d-%02d-%02d",
                    t.tm_year + 1900, t.tm_mon + 1, t.tm_mday);

      // Log the low-water mark alongside each poll. This is the evidence that
      // the streaming parse actually fixed the OOM rather than just moving it:
      // if `min` keeps falling poll after poll, something is still growing.
      Serial.printf("[heap] free %u min %u (pre-poll)\n",
                    static_cast<unsigned>(ESP.getFreeHeap()),
                    static_cast<unsigned>(esp_get_minimum_free_heap_size()));

      int changed = 0;
      if (!pb_client::refresh_today_delta(date, changed)) {
        // No watermark for this date yet — either the first poll after boot
        // failed, or the day rolled over. A full prefetch re-establishes it.
        if (pb_client::ensure_token()) {
          pb_client::prefetch_today_attendance(date);
        }
      } else if (changed > 0) {
        // Something was edited server-side. Repaint so a guide standing at the
        // device sees the idle screen refresh rather than wondering whether
        // the reset landed.
        ui::show(ui::Event::Idle);
      }
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
  Serial.printf("[boot] version %s (build %s %s)\n",
                llattender::kFirmwareVersion, __DATE__, __TIME__);
  Serial.printf("[boot] reset reason: %s\n",
                reset_reason_str(esp_reset_reason()));

  // 32 deep, not 8: the morning arrival rush at ~80 learners can burst faster
  // than processor_task runs the state machine. ScanMsg is 24 B, so this
  // costs well under 1 KB and absorbs the burst instead of dropping taps.
  g_scan_q = xQueueCreate(32, sizeof(ScanMsg));
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
  }

  if (!nfc::init()) {
    Serial.println("[boot] NFC init failed — continuing in degraded mode");
    ui::set_network_error(true);  // reuse the error indicator for now
  }

  // Roster and queue come up BEFORE WiFi, and that ordering is the point.
  //
  // The roster is loaded from LittleFS, so a cold boot on a morning when the
  // router is slow still resolves every card to a name. Previously the roster
  // was RAM-only and populated solely on the offline->online WiFi edge, which
  // meant a boot without network made all 61 cards read "Unknown card" —
  // during the exact fifteen minutes when everyone arrives.
  //
  // The queue is restored from disk here too, so scans that were pending when
  // the power was cut are still pending now rather than silently gone.
  roster::init();
  queue::init();
  // Surface a queue restored from disk right away, so a device that was
  // power-cut with unsent scans says so on the idle screen from boot rather
  // than only after the next tap.
  ui::set_pending_count(queue::size());

  WiFi.mode(WIFI_STA);
  if (!cfg.wifi_ssid.empty()) {
    WiFi.begin(cfg.wifi_ssid.c_str(), cfg.wifi_pw.c_str());
  }
  // Must happen before any task starts: pb_client's token, config snapshot and
  // today-cache are touched from processor_task, network_task AND the serial
  // console on the Arduino loop task.
  pb_client::init();

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
    Serial.println("[cli]   t HH:MM [W]      override clock (W: 0=Sun..6=Sat)");
    Serial.println("[cli]   t off            clear override");
    Serial.println("[cli]   c                clear local today-cache");
    Serial.println("[cli]   heap             free / min-ever / largest block");
    Serial.println("[cli]   q                queue depth + pending entries");
    Serial.println("[cli]   r                roster size + age");
    Serial.println("[cli]   ota              OTA hostname + upload command");
    Serial.println("[cli]   v                firmware version + device identity");
    Serial.println("[cli]   w                wipe PB row for last-scanned learner");
    Serial.println("[cli]   wifi <ssid>|<pw> update saved WiFi creds + reboot");
    Serial.println("[cli]   ?                this help");
    return;
  }
  if (line.rfind("wifi ", 0) == 0) {
    const std::string rest = line.substr(5);
    const size_t bar = rest.find('|');
    if (bar == std::string::npos) {
      Serial.println("[cli] usage: wifi <ssid>|<password>");
      return;
    }
    llattender::config::DeviceConfig c;
    llattender::config::load(c);
    c.wifi_ssid = rest.substr(0, bar);
    c.wifi_pw = rest.substr(bar + 1);
    if (c.wifi_ssid.empty()) {
      Serial.println("[cli] empty SSID — not saving");
      return;
    }
    if (!llattender::config::save(c)) {
      Serial.println("[cli] wifi save failed");
      return;
    }
    Serial.printf("[cli] saved wifi creds (ssid='%s') — rebooting\n",
                  c.wifi_ssid.c_str());
    delay(500);
    ESP.restart();
    return;
  }
  if (line == "heap") {
    // `min ever` is the number that actually matters for the OOM: free heap
    // right now says nothing about the low-water mark hit during a TLS
    // handshake plus a page parse. Watch it across a few delta polls — if it
    // stops falling, the streaming parse is holding.
    Serial.printf("[heap] free %u, min ever %u, largest block %u\n",
                  static_cast<unsigned>(ESP.getFreeHeap()),
                  static_cast<unsigned>(esp_get_minimum_free_heap_size()),
                  static_cast<unsigned>(ESP.getMaxAllocHeap()));
    return;
  }
  if (line == "v") {
    llattender::config::DeviceConfig c;
    llattender::config::load(c);
    Serial.printf("[cli] version %s (build %s %s)\n",
                  llattender::kFirmwareVersion, __DATE__, __TIME__);
    Serial.printf("[cli] device id: %s  name: %s\n",
                  c.device_id.empty() ? "-" : c.device_id.c_str(),
                  c.device_name.empty() ? "-" : c.device_name.c_str());
    Serial.printf("[cli] pb url: %s\n", c.pb_url.c_str());
    return;
  }
  if (line == "ota") {
    llattender::config::DeviceConfig c;
    llattender::config::load(c);
    if (c.ota_password.empty()) {
      Serial.println("[cli] OTA disabled — no password provisioned. Re-run "
                     "setup (type RESET at boot) to generate one.");
    } else {
      Serial.printf("[cli] OTA host: %s.local\n",
                    llattender::ota::hostname().c_str());
      Serial.println("[cli]   pio run -e esp32dev_ota -t upload");
      Serial.println("[cli] password is NOT shown here — it was displayed once "
                     "on the setup confirmation page.");
    }
    return;
  }
  if (line == "q") {
    llattender::queue::debug_dump();
    return;
  }
  if (line == "r") {
    const int n = llattender::roster::count();
    const std::time_t age = llattender::roster::age_seconds();
    if (age < 0) {
      Serial.println("[cli] roster: never loaded — cards will not resolve");
    } else {
      Serial.printf("[cli] roster: %d learners, loaded %ld s ago (%s)\n",
                    n, static_cast<long>(age),
                    llattender::roster::ready() ? "ready" : "NOT ready");
    }
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
