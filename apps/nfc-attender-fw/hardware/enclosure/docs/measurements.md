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

## 0. Bench tests

None of these needs a measurement first, so they can happen whenever.

**Priority order**, highest value first:

1. **Coil-over-ESP32** (below) — nothing to print, and it validates the stacked
   layout, which is the biggest assumption in the design.
2. **Tolerance coupon** — sets five parameters that are currently guesses and
   WILL be wrong for your printer.
3. **Antenna tiles** — optional; see the note under that heading.

### Antenna tile ladder → sets `lid_t`  *(OPTIONAL)*

**You can probably skip this.** In the stacked layout the PN532 sits directly
under the lid, so the card ends up **3.8 mm from the coil**. Even deleting the
antenna pocket entirely and using a uniform 4 mm lid only takes that to 5.8 mm.
A rig that reads at 30-50 mm will not notice either.

The physics agrees: 13.56 MHz NFC is near-field MAGNETIC coupling at a ~22 m
wavelength, and PLA/PETG are non-conductive. The plastic doesn't attenuate the
field — it only contributes its own thickness as distance. 2 mm of lid is 2 mm
of air. This ladder measures a variable the geometry already made irrelevant.

Still worth 15 minutes and 10 g if: read range disappoints once assembled and
you want to rule thickness in or out, your PN532 clone seems weak, or the
school's cards are unusually thick. Diagnostic, not a prerequisite.

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
on it. Thicker means a stiffer lid. If they all read about the same — the likely
outcome — leave `lid_t` at 2.0 and move on.

**Bonus test, worth more than the ladder itself:** put a laptop or steel ruler
flat underneath the PN532 and repeat. The drop you see is why the enclosure
keeps the ESP32's ground plane and shield can out from under the coil. Note
what you observe — it is good capstone material.

Metal interference observed: ______________________________________________

### Coil-over-ESP32 test → validates the whole stacked layout

**RUN THIS EARLY.** It needs no new parts — just the bench rig you already have
— and it tests the single biggest assumption in the enclosure design.

The PN532 now sits **directly above** the ESP32, on 32 mm posts. That is what
makes the box 77 × 119 instead of 130 × 100. If a board that close detunes the
coil, the whole layout has to go back to side-by-side and the box gets wide
again.

The board that matters is the **DevKit, not the breakout**. The breakout is a
passive PCB with traces; the DevKit has a metal shield can and a large ground
pour, and in the stacked layout it is the nearer of the two. So this test works
perfectly well before the breakout arrives.

Set up: PN532 held face-up at a measured height above a powered ESP32 DevKit
lying flat. A stack of the antenna tiles, or a ruler and a steady hand, is
enough. Put your chosen `lid_t` tile on top of the PN532 so the test includes
the plastic.

| PN532 height above the DevKit | Max reliable read height | Notes |
|---|---|---|
| Free air, nothing underneath | | baseline |
| 8 mm | | |
| 12 mm | | = `antenna_keepout` |
| **16 mm** | | **= the design value** |
| 24 mm | | |

Result: at 16 mm, read range is ____% of the free-air baseline.

**How to read it:**

- **Close to baseline at 16 mm** → stacking is fine, design confirmed, nothing
  to change.
- **Noticeably down at 16 mm but recovered by 24 mm** → raise `pn_post_h` to
  40 and `box_iz` to 43. The box gets taller but keeps its footprint.
- **Still down at 24 mm** → stacking doesn't work with this hardware. Go back to
  side-by-side: set `pn_pos_x`/`pn_pos_y` clear of the breakout in plan and
  widen `box_ix`. `lib/layout_checks.scad` accepts either arrangement and will
  tell you if the numbers don't fit.

Also worth noting while the rig is out: does powering the ESP32 on vs off change
anything? A running WiFi radio is a different electromagnetic environment from
an unpowered board.

Powered vs unpowered difference: ______________________________________

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

## 1. ESP32-WROOM-32 DevKit V1 (30-pin, USB-C, ELEGOO)

**Confirmed 30-pin** (15 per side), not the 38-pin DevKitC. Functionally this
changes nothing — the 30-pin variant drops GPIO 0 and the unusable flash pins
but keeps GPIO 21/22 for I²C and GPIO 25 for the buzzer, which the bench rig
already proves.

The DevKit no longer bolts to the case — it plugs into the screw terminal
breakout board (§5), which is what mounts to the floor. These dimensions still
matter for clearance and for locating the USB-C cutout.

| Measurement | Value | `params.scad` |
|---|---|---|
| PCB length | | `esp_l` |
| PCB width | | `esp_w` |
| PCB thickness | | `esp_t` |
| Pin-row spacing, outer edge to outer edge | | `esp_row_pitch` |
| USB-C connector body width | | `esp_usb_w` |
| USB-C body height above PCB | | `esp_usb_h` |
| USB-C overhang past the PCB edge | | `esp_usb_overhang` |
| USB-C centre offset from PCB centreline | | `esp_usb_center_off` |

⚠ **Measure the pin-row spacing BEFORE ordering the breakout board.** 0.9"
(22.86 mm) is typical for 30-pin, but confirm it against the listing — this is
the dimension that decides whether the DevKit physically seats.

⚠ **Measure the USB-C centre offset, don't assume zero.** It is off-centre on
plenty of clones, and the back-wall cutout has to line up with the real port.
Note the breakout board raises the DevKit by `stb_h`, so the cutout height is
measured from the breakout's top face, not from the enclosure floor.

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
| Header pin tail length below the breakout PCB | | sets `stb_standoff_h` |
| Breakout + plugged DevKit, total height | | sets `stb_h` |
| PN532 + plugged dupont, total height | | |
| OLED + plugged dupont, total height | | |
| Tallest point in the whole assembly | | sets `box_iz` |

---

## 5. Screw terminal breakout board

**Cannot be measured until it arrives** — and the base/lid geometry can't be
finalised without it, so this is the long pole on the enclosure. Order early.
The two test prints (§0) are *not* blocked by it.

Must be the **30-pin DevKit V1** variant — a 38-pin breakout will not seat a
30-pin board.

Buy the **"1 into 2"** variant if available: it duplicates each GPIO to two
terminals, which is exactly what 3V3, SDA and SCL need to reach two peripherals.

Prefer a listing that mentions **onboard RESET and BOOT buttons**. The DevKit's
own buttons are unreachable inside a closed case, and a breakout that has them
saves adding a panel-mount button.

| Measurement | Value | `params.scad` |
|---|---|---|
| Breakout PCB length | | `stb_l` |
| Breakout PCB width | | `stb_w` |
| Total height (screw terminals, or plugged-in DevKit — whichever is taller) | | `stb_h` |
| Mounting hole diameter | | `stb_hole_d` |
| Hole spacing, long axis | | `stb_hole_dx` |
| Hole spacing, short axis | | `stb_hole_dy` |
| Does it accept two 24 AWG wires per terminal? | yes / no | (affects fan-out) |
| Has onboard RESET / BOOT buttons? | yes / no | (else `include_reset_button`) |

The placeholder values in `params.scad` are a guess at a typical board and will
almost certainly be wrong for yours. Replace all six before rendering a base.

---

## 6. Buzzer, cable, cards

| Measurement | Value | `params.scad` |
|---|---|---|
| Buzzer disc diameter | | `buz_d` |
| Buzzer body height | | `buz_h` |
| USB cable outer diameter | | `cable_od` |
| USB cable connector boot L × W × H | | (back-wall cutout) |
| School NFC card thickness | | (range test) |

---

## 7. Makerspace constraints

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

## 8. Bench wiring, recorded before dismantling

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

Both peripherals share one I²C bus. The screw terminal breakout exists to fan
3V3, GND, SDA and SCL out to both, because the DevKit exposes only one 3V3 pin
and each header pin accepts exactly one dupont housing.

In the built device each of these wires becomes a female-to-female dupont jumper
cut in half: the stripped end goes into a screw terminal, the surviving female
end pushes onto the module's header pin.
