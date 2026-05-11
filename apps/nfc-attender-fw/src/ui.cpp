#include "ui.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#include <cstdio>
#include <cstring>

#include "time_sync.h"

namespace llattender::ui {

namespace {

constexpr uint8_t kOledAddr = 0x3C;
constexpr int16_t kWidth = 128;
constexpr int16_t kHeight = 64;
constexpr uint32_t kFeedbackMs = 2000;
constexpr uint32_t kSplashMs = 1500;

Adafruit_SSD1306 g_oled(kWidth, kHeight, &Wire, /*reset=*/-1);
bool g_have_oled = false;

enum class Mode { Boot, Idle, Action, Unknown };

struct State {
  Mode mode = Mode::Boot;
  uint32_t mode_until_ms = 0;   // 0 = persistent
  Event last_action = Event::Idle;
  char name[64] = {0};
  bool queued_offline = false;  // sticks until next non-Queued event
  bool network_error = false;
  bool dirty = true;
};

State g_st;
uint32_t g_last_redraw_ms = 0;

const char* verdict_for(Event ev) {
  switch (ev) {
    case Event::CheckInPresent: return "Check-in";
    case Event::CheckInLate:    return "Late check-in";
    case Event::LunchOut:       return "Lunch out";
    case Event::LunchIn:        return "Lunch in";
    case Event::LunchInLate:    return "Lunch in (late)";
    case Event::CheckOut:       return "Goodbye";
    case Event::AlreadyDone:    return "All set today";
    case Event::AlreadyIn:      return "Already in";
    case Event::ScanLocked:     return "Locked";
    case Event::UnknownCard:    return "Unknown card";
    default:                    return "";
  }
}

void draw_centered(const char* text, int16_t y, uint8_t size) {
  g_oled.setTextSize(size);
  int16_t x1, y1; uint16_t w, h;
  g_oled.getTextBounds(text, 0, y, &x1, &y1, &w, &h);
  int16_t x = (kWidth - static_cast<int16_t>(w)) / 2;
  if (x < 0) x = 0;
  g_oled.setCursor(x, y);
  g_oled.print(text);
}

void truncate_inplace(char* buf, size_t max_chars) {
  size_t n = std::strlen(buf);
  if (n <= max_chars) return;
  if (max_chars < 3) { buf[max_chars] = '\0'; return; }
  buf[max_chars - 1] = '.';
  buf[max_chars - 2] = '.';
  buf[max_chars - 3] = '.';
  buf[max_chars] = '\0';
}

void format_clock(char* buf, size_t bufsz) {
  std::tm t = time_sync::now_local();
  std::snprintf(buf, bufsz, "%02d:%02d", t.tm_hour, t.tm_min);
}

void format_date(char* buf, size_t bufsz) {
  static const char* days[] = {"Sun","Mon","Tue","Wed","Thu","Fri","Sat"};
  static const char* months[] = {"Jan","Feb","Mar","Apr","May","Jun",
                                 "Jul","Aug","Sep","Oct","Nov","Dec"};
  std::tm t = time_sync::now_local();
  int wday = (t.tm_wday >= 0 && t.tm_wday < 7) ? t.tm_wday : 0;
  int mon = (t.tm_mon >= 0 && t.tm_mon < 12) ? t.tm_mon : 0;
  std::snprintf(buf, bufsz, "%s %s %d", days[wday], months[mon], t.tm_mday);
}

// Tiny WiFi-with-X glyph: three arcs + base dot + diagonal X over them.
void draw_wifi_error(int16_t x, int16_t y) {
  g_oled.drawPixel(x + 4, y + 8, SSD1306_WHITE);
  g_oled.drawLine(x + 2, y + 6, x + 6, y + 6, SSD1306_WHITE);
  g_oled.drawLine(x + 1, y + 4, x + 7, y + 4, SSD1306_WHITE);
  g_oled.drawLine(x + 0, y + 2, x + 8, y + 2, SSD1306_WHITE);
  g_oled.drawLine(x + 0, y + 0, x + 8, y + 8, SSD1306_WHITE);
  g_oled.drawLine(x + 8, y + 0, x + 0, y + 8, SSD1306_WHITE);
}

// Four vertical bars at increasing heights; fill the first N based on RSSI
// strength (0..4). Drawn 9 px tall, 10 px wide overall.
void draw_wifi_bars(int16_t x, int16_t y, int strength) {
  for (int i = 0; i < 4; ++i) {
    int bar_h = 2 + i * 2;        // 2, 4, 6, 8 px tall
    int bar_x = x + i * 2;
    int bar_y = y + (8 - bar_h);
    if (i < strength) {
      g_oled.fillRect(bar_x, bar_y, 2, bar_h, SSD1306_WHITE);
    } else {
      g_oled.drawRect(bar_x, bar_y, 2, bar_h, SSD1306_WHITE);
    }
  }
}

int wifi_strength_from_rssi(int rssi) {
  if (rssi >= -55) return 4;
  if (rssi >= -65) return 3;
  if (rssi >= -75) return 2;
  if (rssi >= -85) return 1;
  return 0;
}

void render_overlay() {
  if (g_st.network_error) {
    if ((millis() / 500) & 1) draw_wifi_error(kWidth - 10, 0);
    return;
  }
  // Connected — show signal strength bars on idle/action screens.
  if (g_st.mode == Mode::Idle || g_st.mode == Mode::Action) {
    int s = wifi_strength_from_rssi(WiFi.RSSI());
    draw_wifi_bars(kWidth - 10, 0, s);
  }
}

void render_boot() {
  g_oled.clearDisplay();
  g_oled.setTextColor(SSD1306_WHITE);
  draw_centered("LearnLife", 12, 2);
  draw_centered(g_st.name[0] ? g_st.name : "Booting...", 44, 1);
  render_overlay();
  g_oled.display();
}

void render_idle() {
  g_oled.clearDisplay();
  g_oled.setTextColor(SSD1306_WHITE);

  draw_centered("LearnLife", 0, 1);

  char clk[8];
  format_clock(clk, sizeof(clk));
  draw_centered(clk, 18, 3);

  char date[24];
  format_date(date, sizeof(date));
  draw_centered(date, 52, 1);

  render_overlay();
  g_oled.display();
}

void render_action() {
  g_oled.clearDisplay();
  g_oled.setTextColor(SSD1306_WHITE);

  char name[24];
  std::strncpy(name, g_st.name, sizeof(name) - 1);
  name[sizeof(name) - 1] = '\0';
  truncate_inplace(name, 21);
  draw_centered(name, 0, 1);

  g_oled.drawLine(0, 10, kWidth - 1, 10, SSD1306_WHITE);

  const char* verdict = verdict_for(g_st.last_action);
  // At size 2, each character is 12 px wide; 10 chars * 12 = 120 px fits in
  // the 128-wide display. 11 chars overflow (was clipping "Not allowed").
  if (std::strlen(verdict) <= 10) {
    draw_centered(verdict, 20, 2);
  } else {
    draw_centered(verdict, 24, 1);
  }

  if (g_st.queued_offline) {
    draw_centered("(offline)", 44, 1);
  }

  char clk[8];
  format_clock(clk, sizeof(clk));
  g_oled.setTextSize(1);
  int16_t x1, y1; uint16_t w, h;
  g_oled.getTextBounds(clk, 0, 56, &x1, &y1, &w, &h);
  g_oled.setCursor(kWidth - static_cast<int16_t>(w) - 2, 56);
  g_oled.print(clk);

  render_overlay();
  g_oled.display();
}

void render_unknown() {
  g_oled.clearDisplay();
  g_oled.setTextColor(SSD1306_WHITE);
  draw_centered("?", 0, 4);
  draw_centered("Unknown card", 44, 1);
  draw_centered("Card not in roster", 56, 1);
  render_overlay();
  g_oled.display();
}

void redraw() {
  if (!g_have_oled) return;
  switch (g_st.mode) {
    case Mode::Boot:    render_boot();    break;
    case Mode::Idle:    render_idle();    break;
    case Mode::Action:  render_action();  break;
    case Mode::Unknown: render_unknown(); break;
  }
  g_st.dirty = false;
  g_last_redraw_ms = millis();
}

}  // namespace

bool init() {
  Wire.begin();  // safe to call again from nfc::init()
  if (!g_oled.begin(SSD1306_SWITCHCAPVCC, kOledAddr)) {
    Serial.println("[ui] SSD1306 not found at 0x3C — running headless");
    g_have_oled = false;
    return false;
  }
  g_have_oled = true;
  g_oled.setTextWrap(false);
  Serial.println("[ui] SSD1306 init ok");

  g_st.mode = Mode::Boot;
  g_st.mode_until_ms = millis() + kSplashMs;
  g_st.name[0] = '\0';
  g_st.dirty = true;
  redraw();
  return true;
}

void show(Event ev, const char* learner_name) {
  Serial.printf("[ui] event=%d name=%s\n", static_cast<int>(ev),
                learner_name ? learner_name : "");

  switch (ev) {
    case Event::Boot:
      g_st.mode = Mode::Boot;
      g_st.mode_until_ms = 0;
      std::strncpy(g_st.name, learner_name ? learner_name : "",
                   sizeof(g_st.name) - 1);
      g_st.name[sizeof(g_st.name) - 1] = '\0';
      break;

    case Event::Idle:
      g_st.mode = Mode::Idle;
      g_st.mode_until_ms = 0;
      g_st.queued_offline = false;
      break;

    case Event::UnknownCard:
      g_st.mode = Mode::Unknown;
      g_st.mode_until_ms = millis() + kFeedbackMs;
      g_st.queued_offline = false;
      break;

    case Event::Queued:
      g_st.queued_offline = true;
      break;

    case Event::NetworkError:
      // Routed through set_network_error(); ignored here.
      return;

    default:  // CheckIn{Present,Late} / Lunch{Out,In,InLate} / CheckOut / AlreadyDone
      g_st.mode = Mode::Action;
      g_st.last_action = ev;
      g_st.mode_until_ms = millis() + kFeedbackMs;
      g_st.queued_offline = false;
      std::strncpy(g_st.name, learner_name ? learner_name : "",
                   sizeof(g_st.name) - 1);
      g_st.name[sizeof(g_st.name) - 1] = '\0';
      break;
  }
  g_st.dirty = true;
  redraw();
}

void set_network_error(bool on) {
  Serial.printf("[ui] network_error=%d\n", on ? 1 : 0);
  if (g_st.network_error == on) return;
  g_st.network_error = on;
  g_st.dirty = true;
}

void tick() {
  if (!g_have_oled) return;
  uint32_t now = millis();

  if (g_st.mode_until_ms != 0 && now >= g_st.mode_until_ms) {
    g_st.mode = Mode::Idle;
    g_st.mode_until_ms = 0;
    g_st.queued_offline = false;
    g_st.dirty = true;
  }

  bool periodic_due = false;
  if (g_st.mode == Mode::Idle && (now - g_last_redraw_ms) >= 1000) {
    periodic_due = true;
  } else if (g_st.network_error && (now - g_last_redraw_ms) >= 500) {
    periodic_due = true;
  }

  if (g_st.dirty || periodic_due) {
    redraw();
  }
}

}  // namespace llattender::ui

#endif  // LLATTENDER_NATIVE_BUILD
