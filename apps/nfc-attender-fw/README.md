# nfc-attender-fw

Standalone ESP32 firmware for LearnLife NFC attendance — replaces the Mac/Tauri kiosk in `apps/nfc-attender` with a self-contained device that talks straight to PocketBase.

See `/Users/lily/.claude/plans/goofy-spinning-leaf.md` for the full design rationale.

## Hardware

- ESP32-WROOM-32 DevKitC (38-pin, USB-C)
- PN532 V3 NFC module on I2C (DIP switches set to I2C)
- SSD1306 0.96" OLED on I2C
- DS3231 RTC on I2C
- RGB LED + piezo buzzer

Pin map (default I2C build): see plan.

## Build & test

```bash
# Native unit tests (no hardware)
pio test -e native

# Build firmware
pio run -e esp32dev

# Flash + monitor
pio run -e esp32dev -t upload
pio device monitor

# Build LittleFS image (config + splash bitmap) and flash it
pio run -e esp32dev -t buildfs -t uploadfs
```

## Layout

```
src/
  main.cpp               bootstrap + FreeRTOS task setup
  state_machine.{h,cpp}  port of computeCheckInAction (testable on native)
  nfc.{h,cpp}            PN532 wrapper + UID dedupe
  ui.{h,cpp}             OLED + LED + buzzer feedback
  pb_client.{h,cpp}      HTTPS calls to PocketBase
  roster.{h,cpp}         learner cache
  queue.{h,cpp}          offline scan queue
  config.{h,cpp}         NVS-backed settings + captive portal
  time_sync.{h,cpp}      NTP + DS3231
test/
  test_state_machine/    Unity tests mirroring apps/nfc-attender's TS suite
data/                    LittleFS image
```
