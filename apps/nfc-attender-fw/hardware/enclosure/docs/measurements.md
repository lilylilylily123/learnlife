# Measurement worksheet

Fill this in with calipers, then copy the numbers into `../params.scad`.

**Do this before dismantling the working breadboard rig.** Photograph the
wiring from three angles and fill in the wiring table at the bottom first —
you will not remember which pin the buzzer lead was in.

Clone modules vary by 2–5 mm between vendors. Every `[MEASURE]` value in
`params.scad` is a placeholder taken from a typical vendor listing, and
trusting them is the single most likely reason a first print doesn't fit.

**How to measure a PCB:** measure the bare board edge-to-edge, ignoring any
component overhang. Take each dimension twice, at both ends — clone boards are
often not quite rectangular. Record the larger value.

---

## 0. Test print results

Run these two prints before designing anything. Neither needs measurements.

### Antenna tile ladder → sets `lid_t`

Print `antenna_tiles.scad`. Lay each tile on the bench PN532, hold a real
school card flat on it, lift slowly, and record the height at which reads stop
being reliable. "Reliable" is 5 taps out of 5, not 3 out of 5.

| Tile | Max reliable read height | Notes |
|------|--------------------------|-------|
| 1.2 mm | | |
| 1.6 mm | | |
| 2.0 mm | | |
| 2.4 mm | | |
| 3.0 mm | | |

Chosen `lid_t` = ________ mm

Pick the **thickest** tile that still reads comfortably with the card resting
on it. Thicker means a stiffer lid; you are buying the most rigidity you can
without hurting reads.

**Bonus test, worth more than the ladder itself:** put a laptop or steel ruler
flat underneath the PN532 and repeat. The drop you see is why the enclosure
keeps the ESP32's ground plane and shield can out from under the coil. Note
what you observe — it is good capstone material.

Metal interference observed: ______________________________________________

### Tolerance coupon → sets five parameters

Print `coupon.scad`. Instructions are in the header of that file.

| Test | Result | Parameter | Value |
|------|--------|-----------|-------|
| 20 mm calibration square, measured X | | `xy_comp` | |
| 20 mm calibration square, measured Y | | (use the average) | |
| Pilot hole that bit without splitting | | `screw_pilot_d` | |
| Tightest PCB pocket that dropped in cleanly | | `fit_pcb` | |
| Groove that gave a positive sliding fit | | `fit_lip` | |
| USB slot your cable passed without forcing | | `fit_usb` | |
| Bridge window top edge sagged? | yes / no | (chamfer needed) | |

---

## 1. ESP32-WROOM-32 DevKitC (38-pin, USB-C)

| Measurement | Value | `params.scad` |
|---|---|---|
| PCB length | | `esp_l` |
| PCB width | | `esp_w` |
| PCB thickness | | `esp_t` |
| **Has mounting holes at all?** yes / no | | `esp_has_mount_holes` |
| Hole diameter (if any) | | `esp_hole_d` |
| Hole spacing, long axis | | `esp_hole_dx` |
| Hole spacing, short axis | | `esp_hole_dy` |
| USB-C connector body width | | `esp_usb_w` |
| USB-C body height above PCB | | `esp_usb_h` |
| USB-C overhang past the PCB edge | | `esp_usb_overhang` |
| USB-C centre offset from PCB centreline | | `esp_usb_center_off` |

⚠ **The mounting-hole question is a fork in the design.** Many 38-pin DevKitC
clones have no mounting holes at all. If yours doesn't, the board is retained
by printed L-clips over its long edges instead of screws — answer this before
any base geometry gets drawn.

⚠ **Measure the USB-C centre offset, don't assume zero.** It is off-centre on
plenty of clones, and the back-wall cutout has to line up with the real port.

---

## 2. PN532 V3 NFC module

DIP switches must be set to I²C: **1 = ON, 2 = OFF** (address `0x24`).

| Measurement | Value | `params.scad` |
|---|---|---|
| Board length | | `pn_l` |
| Board width | | `pn_w` |
| Board thickness | | `pn_t` |
| Mounting hole diameter | | `pn_hole_d` |
| Hole spacing, X | | `pn_hole_dx` |
| Hole spacing, Y | | `pn_hole_dy` |
| DIP switch height above the back face | | `pn_dip_h` |
| Coil centre X offset from board centre | | `pn_coil_cx` |
| Coil centre Y offset from board centre | | `pn_coil_cy` |
| Coil outer size (largest dimension) | | `pn_coil_d` |

⚠ **The coil centre is usually NOT the board centre.** The coil is the visible
rectangular copper spiral. Its centre is what the TAP CARD label on the lid
must sit above — get this wrong and the label points at the wrong spot.

⚠ **Header check.** Does your module have its pin header already soldered on,
or is it loose in the bag? The bench unit works, so that one is fine; this
matters for the **second** module. If it arrives unsoldered, ask the makerspace
to run the four joints — do **not** press-fit it. An intermittent I²C line
produces bugs you will chase for days.

Second module header pre-soldered? yes / no ____________

---

## 3. SSD1306 0.96" OLED

| Measurement | Value | `params.scad` |
|---|---|---|
| Module PCB length | | `oled_pcb_l` |
| Module PCB width | | `oled_pcb_w` |
| Module PCB thickness | | `oled_pcb_t` |
| Glass panel outer length | | `oled_glass_l` |
| Glass panel outer width | | `oled_glass_w` |
| **Glass offset from PCB centre, X** | | `oled_glass_off_x` |
| **Glass offset from PCB centre, Y** | | `oled_glass_off_y` |
| Tallest component on the back face | | (clearance check) |

⚠ **The glass is not centred on the PCB.** This is the most commonly botched
measurement on this module. Measure the gap from each PCB edge to the glass
edge on all four sides and derive the offset — if you skip it, the window
frames the wrong part of the display and the fix is a reprint.

---

## 4. Assembled stack heights

These matter more than any single board dimension, because they set `pn_post_h`
and `box_iz` — how tall the box has to be.

| Measurement | Value | Notes |
|---|---|---|
| Dupont female housing height, pushed onto a header pin | | above the PCB |
| Header pin tail length below the PCB | | sets `esp_standoff_h` |
| PN532 + plugged dupont, total height | | |
| OLED + plugged dupont, total height | | |
| Tallest point in the whole assembly | | sets `box_iz` |

---

## 5. Mini breadboard, buzzer, cable, cards

| Measurement | Value | `params.scad` |
|---|---|---|
| Mini breadboard length (incl. adhesive backing) | | `bb_l` |
| Mini breadboard width | | `bb_w` |
| Mini breadboard height | | `bb_h` |
| Buzzer disc diameter | | `buz_d` |
| Buzzer body height | | `buz_h` |
| USB cable outer diameter | | `cable_od` |
| USB cable connector boot L × W × H | | (back-wall cutout) |
| School NFC card thickness | | (range test) |

---

## 6. Makerspace constraints

Ask before treating `box_ix` / `box_iy` as final — bed size decides whether two
parts fit on one plate, which decides how many visits this takes.

| Question | Answer |
|---|---|
| Printer model | |
| **Bed size (X × Y)** | |
| Filament available (PETG?) | |
| Slicer used | |
| How booking works / lead time | |
| Can they do 4 solder joints if needed? | |

---

## 7. Bench wiring, recorded before dismantling

Verify against the firmware, which hardcodes these:
`src/nfc.cpp:26` (I²C SDA 21 / SCL 22 — Arduino defaults, never explicitly
set, so moving them would need `Wire.begin(sda, scl)`) and
`src/buzzer.cpp:11` (buzzer GPIO 25).

| From (module + pin) | To (ESP32 pin) | Wire colour | Notes |
|---|---|---|---|
| PN532 VCC | 3V3 | | |
| PN532 GND | GND | | |
| PN532 SDA | GPIO 21 | | |
| PN532 SCL | GPIO 22 | | |
| OLED VCC | 3V3 | | |
| OLED GND | GND | | |
| OLED SDA | GPIO 21 | | |
| OLED SCL | GPIO 22 | | |
| Buzzer + | GPIO 25 | | |
| Buzzer − | GND | | |

Photos taken: ☐ top ☐ front ☐ connector detail

Both peripherals share one I²C bus; the mini breadboard exists to fan 3V3,
GND, SDA and SCL out to both, because the DevKitC exposes only one 3V3 pin and
each header pin accepts exactly one dupont housing.
