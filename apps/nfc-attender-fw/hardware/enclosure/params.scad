// LearnLife NFC Attender — enclosure parameters
// =============================================
//
// EVERY tunable dimension in the enclosure lives in this file. No geometry,
// no functions, no computed values — only `name = value;` lines.
//
// That restriction is deliberate and load-bearing:
//
//   1. You tune the design by editing numbers here, never by editing geometry.
//      Printed a part and the PN532 pocket is tight? Change `fit_pcb` and
//      re-render. Nothing else moves.
//
//   2. It keeps the escape hatch to Fusion 360 / CadQuery cheap. A flat list
//      of name=value pairs can be machine-translated to a params.json, or
//      retyped into Fusion's parameter table in ten minutes. The moment this
//      file contains logic, that stops being true.
//
// UNITS: millimetres and degrees throughout.
//
// ── HOW TO USE THIS FILE ─────────────────────────────────────────────────
//
// Values marked `[MEASURE]` are placeholders taken from typical vendor
// listings. Clone modules vary by 2-5 mm between sellers, which is the #1
// cause of a first print that doesn't fit. Measure YOUR modules with calipers
// and replace these before rendering anything you intend to keep.
// Worksheet: docs/measurements.md
//
// Values marked `[COUPON]` are set empirically from the printed test coupon
// (coupon.scad). Print it, measure it, come back, edit these five numbers.
// Everything else inherits the correction.
//
// Values marked `[TILE]` come from the antenna tile test (antenna_tiles.scad),
// which you can print before this design even exists.


// ══ PRINTER / PROCESS ════════════════════════════════════════════════════
// Set once from the coupon, then left alone.

nozzle_d = 0.4;             // nozzle diameter — drives minimum feature sizes
layer_h  = 0.2;             // layer height — lid_t should be a multiple of this

xy_comp  = 0.00;            // [COUPON] global XY size correction.
                            // Print the 20 mm calibration square, measure it.
                            // If it comes out 20.15, set this to 0.15.
                            // Positive = printer prints oversize.

// Apply xy_comp to a CUT dimension — a bore diameter, a slot width, an
// aperture. A printer that prints 0.15 mm oversize leaves every hole 0.15 mm
// UNDERSIZE, because the surplus material encroaches from both sides, so a cut
// is modelled xy_comp larger than nominal and comes out on size.
//
// WHERE THIS IS USED: cuts whose printed size has to match a physical part or
// a functional aperture — screw bores into plastic, panel-mount hardware
// holes, rubber-foot recesses, the piezo seat, vents, sound holes, zip-tie
// slots, the OLED window, the screw-head counterbore.
//
// WHERE IT IS DELIBERATELY NOT USED, and must not be added:
//   * Outer walls and overall size. The box would grow by the same amount.
//   * Anything sized from fit_pcb / fit_lip / fit_usb / screw_pilot_d. Those
//     five numbers are chosen by test-fitting a REAL part into an
//     UNCOMPENSATED printed coupon, so they already contain the printer's
//     offset. Adding xy_comp on top would loosen every one of those fits by
//     exactly xy_comp — a snug drop-in becomes a rattle.
function cut(d) = d + xy_comp;

fit_pcb  = 0.35;            // [COUPON] per-side clearance around any PCB in a pocket
fit_lip  = 0.25;            // [COUPON] lid lip <-> base groove clearance
fit_usb  = 0.60;            // [COUPON] clearance around the USB-C connector opening
fit_post = 0.20;            // [COUPON] clearance on screw-post outer diameters.
                            // Declared for a future press-fit post variant;
                            // nothing consumes it yet.

screw_pilot_d = 2.5;        // [COUPON] pilot hole for an M3 self-tapping screw.
                            // Too big = strips, too small = splits the boss.
                            // The coupon prints 2.3 / 2.5 / 2.7 — pick the one
                            // that bites firmly without cracking.


// ══ SHELL ════════════════════════════════════════════════════════════════

wall_t   = 2.4;             // side wall thickness (3 perimeters at 0.4 nozzle)
floor_t  = 2.4;             // base floor thickness

lid_plate_t = 4.0;          // general lid thickness. A 125 x 95 mm plate at
                            // 2 mm flexes enough to feel cheap and to bow away
                            // from the OLED it is meant to hold down, so the
                            // lid is thicker EXCEPT directly over the antenna.
                            //
                            // 4.0 rather than 3.0 because the screw heads
                            // countersink 3 mm into it: at 3.0 the counterbore
                            // went straight through the top face. lid.scad
                            // asserts that at least 1 mm of plate remains
                            // under each head to bear on.

lid_t    = 2.0;             // [TILE] plastic over the ANTENNA ONLY — a pocket
                            // milled into the lid's underside thins it to this
                            // over the coil. THE most important number in this
                            // file for read reliability. Validate with
                            // antenna_tiles.scad before printing a real lid.
                            // Tested band: 1.2 - 3.0. Must be < lid_plate_t.

// Internal envelope.
//
// Driven by the layout, not chosen. The PN532 sits DIRECTLY ABOVE the breakout,
// separated vertically rather than laterally — antenna_keepout cares about
// distance from the coil, not which direction that distance runs. So the
// footprint only has to fit the breakout plus corner bosses (~10 mm per edge),
// plus a bay at the back for the buzzer.
//
// An earlier version put the boards side by side, forcing a 130 x 100 box with
// a 27 mm display marooned on a 130 mm face. Stacking makes it 77 x 119 —
// narrower than it is deep, like a card terminal, with the display filling a
// third of the face it sits on. THE SHORT EDGE FACES THE USER.
//
// base.scad asserts all of this at render time. If you change a module
// dimension and the layout stops fitting, the render fails with a message
// naming the clearance that broke rather than producing a quietly wrong part.
//
// Expect this to SHRINK once the real breakout is measured — the placeholder
// (75 x 50) is a guess at the large end. At 60 x 45 the box would be ~104 deep.
box_ix = 72;                // internal X — left-right, THE FACE YOU LOOK AT
box_iy = 114;               // internal Y — front-back, the depth on the desk
box_iz = 35;                // internal Z (floor to lid underside)

corner_r = 4;               // external corner radius
lip_h    = 2.5;             // height of the alignment lip on the lid
lip_t    = 1.6;             // thickness of the alignment lip

vent_slot_w = 2.0;          // ventilation slot width in the back wall
vent_slot_l = 14;           // ventilation slot length
vent_slot_n = 6;            // number of slots
vent_slot_gap = 3.0;        // spacing between slots


// ══ FASTENERS ════════════════════════════════════════════════════════════
// M3 self-tapping screws driven from BELOW into bosses rising from the floor.
// No nuts, no captive hardware, no soldering iron.
//
// Heat-set brass inserts are the better long-term joint (they survive far more
// open/close cycles than threads tapped into plastic) but they require a
// soldering iron plus an insert tip. Self-tappers are good for dozens of
// cycles, which comfortably exceeds this device's service life.
// If you end up buying an iron anyway, `use_heatset_inserts` switches over.

use_heatset_inserts = false;
insert_d      = 4.2;        // M3 heat-set insert bore (4.0 insert + 0.2 fit)
insert_depth  = 5.0;

boss_od       = 7.0;        // screw boss outer diameter
                            // Bosses run the FULL internal height (box_iz) so
                            // the lid screws down into them from above. There
                            // is no separate boss height parameter — a boss
                            // shorter than the box could not reach the lid.
screw_head_d  = 6.0;        // screw head diameter (for the countersink)
screw_head_h  = 3.0;
screw_len     = 12;         // M3 x 12 self-tapping
boss_inset    = 6.0;        // boss centre distance from the internal corner


// ══ INTERNAL LAYOUT ══════════════════════════════════════════════════════
// WHERE each module sits on the floor, in internal coordinates: (0,0) is the
// front-left INNER corner, +X right, +Y back.
//
// ⚠ These are the values most likely to need adjusting once the breakout
// board is in hand, because they depend on its real size and on which way its
// plugged-in DevKit faces. Render assembly.scad and look before printing.
//
// Layout intent, front to back:
//
//   front   OLED in the short end wall, facing the user
//           PN532 tap zone on tall posts, so the card target sits at the near
//           end of the lid where a hand naturally lands
//   middle  breakout + DevKit on the floor, UNDERNEATH the PN532
//   back    buzzer, firing up through a lid grille well clear of the antenna

stb_rotate = 90;            // 90 = breakout long axis front-back
stb_pos_x = 11;             // breakout front-left corner, internal coords
stb_pos_y = 11;

pn_pos_x = 15;              // PN532 front-left corner, internal coords.
pn_pos_y = 14;              // Toward the FRONT: the tap target belongs at the
                            // near edge of the lid, not the far one.

// Buzzer lies FLAT on the floor at the back, firing UP through a lid grille.
// It cannot go in the front wall — at 72 mm internal there is only ~13 mm
// beside the OLED and the collar needs 16 — and the rest of the floor is under
// the boards. The back also keeps its grille far from the tap zone.
buz_pos_x = 36;             // centred left-right
buz_pos_y = 94;             // behind both boards

oled_pos_x = 36;            // centred: this is the face people look at
oled_z = 18;                // OLED window centre height above the floor


// ══ MODULES ══════════════════════════════════════════════════════════════
// ALL of the following are [MEASURE]. The values here are typical vendor
// figures and WILL be wrong for some clones. See docs/measurements.md.

// ── ESP32-WROOM-32 DevKit V1, 30-pin, USB-C (ELEGOO) ──
//
// CONFIRMED 30-PIN (15 per side), not the 38-pin DevKitC. This matters for
// buying the breakout board — the two are not interchangeable.
//
// Functionally it changes nothing for this project: the 30-pin variant omits
// GPIO 0 and the flash pins (6-11, unusable anyway), but keeps GPIO 21/22 for
// I2C and GPIO 25 for the buzzer. The bench rig already proves this — it runs
// on exactly these pins today.
//
// The DevKit no longer mounts to the case directly — it plugs into the screw
// terminal breakout below, which is what bolts to the floor. These dimensions
// still matter for clearance and for locating the USB-C port.
esp_l  = 52.0;              // [MEASURE] PCB length (30-pin is ~52, shorter
                            // than the 38-pin's ~55.5)
esp_w  = 28.0;              // [MEASURE] PCB width including the pin headers
esp_t  = 1.6;               // [MEASURE] PCB thickness
esp_row_pitch = 22.86;      // [MEASURE] spacing between the two pin ROWS,
                            // outer edge to outer edge. 0.9" = 22.86 is
                            // typical for 30-pin. Confirm before ordering the
                            // breakout — this is the dimension that decides
                            // whether the DevKit physically seats in it.

esp_usb_w        = 9.2;     // [MEASURE] USB-C connector body width
esp_usb_h        = 3.4;     // [MEASURE] USB-C connector body height above PCB
esp_usb_overhang = 1.2;     // [MEASURE] how far the connector overhangs the PCB edge
esp_usb_center_off = 0.0;   // [MEASURE] USB-C centre offset from the PCB centreline.
                            // Non-zero on plenty of clones — measure, don't assume.
                            // Note the breakout board raises the DevKit by
                            // stb_h, so the USB-C cutout height is measured
                            // from the breakout's top face, not the floor.

// ── PN532 V3 NFC module (I2C mode, DIP 1=ON 2=OFF, addr 0x24) ──
pn_l = 42.7;                // [MEASURE] board length
pn_w = 40.4;                // [MEASURE] board width
pn_t = 1.2;                 // [MEASURE] board thickness
pn_hole_d  = 3.2;           // [MEASURE] mounting hole diameter
pn_hole_dx = 36.5;          // [MEASURE] hole centre-to-centre, X
pn_hole_dy = 34.5;          // [MEASURE] hole centre-to-centre, Y
pn_dip_h   = 4.0;           // [MEASURE] DIP switch height on the back face —
                            // this sets how much clearance the posts need

// Antenna coil geometry. The coil is the visible rectangular copper spiral.
// Its CENTRE is what the TAP CARD label must sit above, and it is usually
// NOT the centre of the board.
pn_coil_cx = 0;             // [MEASURE] coil centre X offset from board centre
pn_coil_cy = 0;             // [MEASURE] coil centre Y offset from board centre
pn_coil_d  = 36;            // [MEASURE] coil outer size (largest dimension)

pn_post_h  = 32.0;          // height of the posts the PN532 sits on. With
                            // antenna_air_gap this sets how close the antenna
                            // is to the card. Prior bench work found reliable
                            // reads at ~30 mm and targeted 10-15 mm.
                            //
                            // 32 rather than 26 because the PN532 now sits
                            // ABOVE the breakout: it buys 16 mm of vertical
                            // clearance over the DevKit, comfortably more than
                            // antenna_keepout demands. Directly above is a
                            // harsher position than beside at equal distance —
                            // more of the coil's flux passes through a board
                            // underneath than past one off to the side — so
                            // the extra margin is deliberate.
antenna_air_gap = 0.5;      // PN532 top face -> lid inner face
antenna_keepout = 12.0;     // minimum clearance from the coil edge to ANY other
                            // PCB. A large copper plane parallel and close to
                            // the coil acts as a shorted turn and detunes it —
                            // this is what actually kills read range, far more
                            // than plastic thickness does.
                            //
                            // This got stricter when the mini breadboard became
                            // a screw terminal breakout. A breadboard is small
                            // discontinuous strips and the PN532 could sit
                            // straight above it. The breakout is a double-layer
                            // PCB with real copper, so the coil now has to be
                            // LATERALLY clear of it — which is what makes the
                            // box wider rather than taller.
                            //
                            // How much clearance is genuinely needed is a
                            // measurement, not a guess: hold the PN532 over the
                            // breakout on the bench and compare read range
                            // against holding it in free air. See
                            // docs/measurements.md §0. If it turns out not to
                            // matter, this can shrink and so can the box.

// ── SSD1306 0.96" OLED, I2C addr 0x3C ──
oled_pcb_l = 27.3;          // [MEASURE] module PCB length
oled_pcb_w = 27.8;          // [MEASURE] module PCB width
oled_pcb_t = 1.2;           // [MEASURE]
oled_glass_l = 26.7;        // [MEASURE] glass panel outer length
oled_glass_w = 19.3;        // [MEASURE] glass panel outer width
oled_glass_off_x = 0;       // [MEASURE] glass offset from PCB centre, X
oled_glass_off_y = 0;       // [MEASURE] glass offset from PCB centre, Y.
                            // THE GLASS IS NOT CENTRED ON THE PCB. This is the
                            // single most commonly botched measurement on this
                            // module — measure both offsets or your window
                            // will frame the wrong part of the display.
oled_active_l = 21.74;      // active display area (datasheet, 128x64 @ 0.96")
oled_active_w = 10.86;
oled_win_l = 23.0;          // cut window size — active area plus a small margin
oled_win_w = 13.0;

// ── Screw terminal breakout board (the solderless I2C bus hub) ──
//
// The DevKit exposes ONE 3V3 pin, and each header pin accepts exactly one
// dupont housing, so two peripherals cannot share power and I2C off it
// directly. Something has to fan those nets out.
//
// A mini breadboard was the first answer and it was the wrong one. Breadboard
// contacts are spring clips built for temporary prototyping — they are
// explicitly not rated for permanent installation, they go intermittent under
// vibration, and an intermittent I2C line in a device that gets tapped a few
// hundred times a day is about the worst failure mode available. It doesn't
// fail cleanly; it works for a week and then returns one garbage read.
//
// A 30-pin ESP32 DevKit V1 screw terminal breakout board fixes that without
// soldering. The DevKit plugs into its headers and every GPIO comes out on a
// screw clamp, which cannot vibrate loose. Buy the "1 into 2" variant: it
// duplicates each GPIO to two terminals, which is exactly what 3V3, SDA and
// SCL need for two peripherals.
//
// Many of these boards also carry onboard RESET and BOOT buttons. That is
// worth having: the DevKit's own buttons end up unreachable inside a closed
// case, and it means include_reset_button below can stay off — the breakout
// provides it. Prefer a listing that mentions them.
//
// Wiring: cut female-to-female dupont jumpers in half and strip the cut end.
// Bare wire into the screw terminal, surviving female end onto the PN532 or
// OLED header pin. Wire strippers, no other tools.
//
// This board — not the DevKit — is what bolts to the enclosure floor, which
// conveniently removes the "does this clone even have mounting holes?"
// problem, because the breakout has them regardless.
stb_l = 75.0;               // [MEASURE] breakout PCB length — PLACEHOLDER,
stb_w = 50.0;               // [MEASURE] these vary a lot between vendors and
stb_h = 12.0;               // [MEASURE] cannot be trusted until yours arrives.
                            // stb_h = top of the screw terminals, or top of a
                            // plugged-in DevKit, whichever is taller.
stb_hole_d  = 3.2;          // [MEASURE] mounting hole diameter
stb_hole_dx = 68.0;         // [MEASURE] hole centre-to-centre, long axis
stb_hole_dy = 43.0;         // [MEASURE] hole centre-to-centre, short axis
stb_standoff_h = 4.0;       // gap under the board for solder tails

// ⚠ ORDERING: must be the 30-PIN DevKit V1 variant. A 38-pin breakout will not
// seat a 30-pin board. Confirm esp_row_pitch above matches the listing too.
// Search terms that work: "ESP32 30Pin GPIO Breakout Board 1 into 2 Terminal
// Adapter" or "ESP32 DevKit V1 expansion board screw terminal".


// ── Wago 221 lever nuts (OPTIONAL — not needed for this build) ──
//
// I2C is a SHARED BUS: SDA and SCL each reach every peripheral, and 3V3 and
// GND do too. A breadboard made that trivial (one column ties five holes
// together), and a screw terminal gives one wire per pin, so it looks like
// something has to replace the breadboard's fan-out.
//
// Counting the actual device says otherwise:
//
//   3V3   PN532 + OLED                 2 wires, 1 terminal
//   GND   PN532 + OLED + buzzer        3 wires, but the MRD068A has a GND
//                                      terminal on EACH side — 2 + 1
//   D21   PN532 + OLED (SDA)           2 wires, 1 terminal
//   D22   PN532 + OLED (SCL)           2 wires, 1 terminal
//   D25   buzzer                       1 wire
//
// Worst case is TWO wires in one terminal. Two 24 AWG conductors is about
// 0.4 mm2 into a terminal rated near 1.5 mm2 — unremarkable, and standard
// practice for signal wiring. Twist the stripped ends together before
// inserting so the clamp bears on both evenly.
//
// So: no Wagos for a two-peripheral build. They earn their place only if a
// third device joins the bus — the DS3231 (include_rtc) would make it three
// wires on 3V3, SDA and SCL, which is a genuine squeeze. Set this true then.
//
// If used: the 5-conductor 221-415, not the 3-conductor 221-413. The 3-way is
// exactly full at two peripherals and leaves no room to grow.
include_wago_bay = false;
wago_n = 4;                 // 3V3, GND, SDA, SCL
wago_l = 21.0;              // [MEASURE] 221-415 body length
wago_w = 12.5;              // [MEASURE] body width (5-conductor)
wago_h = 9.0;               // [MEASURE] body height
wago_gap = 2.0;             // spacing between adjacent nuts in the bay
                            // The bay is an open-topped printed pocket that
                            // stops them sliding around; the levers must stay
                            // reachable, so it is a corral, not a lid.

// ── Piezo buzzer (GPIO 25) ──
buz_d = 12.0;               // [MEASURE] disc diameter
buz_h = 9.5;                // [MEASURE] body height
sound_hole_d = 2.0;         // sound hole diameter. NOT 1.5 — a 0.4 mm nozzle
                            // renders holes below ~2 mm ragged and undersized.
sound_hole_n = 4;           // grid is n x n, cut through the LID above
                            // the buzzer (see buz_pos_*)
sound_hole_pitch = 3.2;

// ── Cable / strain relief ──
cable_od = 4.0;             // [MEASURE] USB cable outer diameter, for the
                            // strain-relief clamp groove

// Back-wall zip-tie slots. Cut by base.scad, and clamp.scad has to sit
// between the two runs of the tie that passes through them, so both files
// read these rather than repeating literals.
ziptie_spacing = 22.0;      // centre-to-centre of the two slots
ziptie_slot_w  = 3.5;       // passes a standard 3.6 mm wide tie
ziptie_slot_h  = 6.0;

// External cable clamp (clamp.scad). A saddle that sits on the OUTSIDE of the
// back wall; the same tie that runs through the two slots crosses it and pins
// the cable into its groove, so a tug loads the box and not the USB socket.
clamp_back_t = 2.0;         // material behind the cable groove
clamp_h      = 20.0;        // cable length the saddle supports
clamp_ear    = 3.0;         // material each side of the cable groove

// Dupont retainer collars (retainer.scad). A collar that slides over a row of
// individual dupont housings and gangs them into one block, so no single one
// can walk off its header pin. Standalone — it does not touch the enclosure,
// which is why it needs nothing from the bench layout.
dupont_pitch     = 2.54;    // header pitch, fixed by the connector standard
dupont_n         = 4;       // pins per peripheral: VCC, GND, SDA, SCL
dupont_housing_w = 2.60;    // [MEASURE] one housing across the row. Standard
                            // moulding is ~2.54-2.6; clones vary.
dupont_housing_d = 2.60;    // [MEASURE] housing depth, normal to the row
retainer_grip_h  = 6.0;     // how much of the housing height the collar grips
retainer_wall_t  = 1.6;     // collar wall — 4 perimeters at a 0.4 nozzle
retainer_grip    = -0.10;   // per-side interference. NEGATIVE on purpose: the
                            // collar must grip, not drop off. Loosen toward 0
                            // if it will not push on by hand.

// ══ LID GRAPHICS ═════════════════════════════════════════════════════════
// Harvested from the production-enclosure-v1 branch, which had these right.

label_text = "TAP CARD";
label_size = 5;
label_deboss_depth = 0.6;
label_font = "Helvetica:style=Bold";
label_offset_y = 14;        // label distance above the coil centre

nfc_glyph = true;           // three concentric arcs, the universal NFC mark
nfc_glyph_radii = [6, 9, 12];
nfc_glyph_stroke = 1.0;
nfc_glyph_offset_y = -4;    // glyph offset from the coil centre

device_label = "";          // optional second line embossed on the base back
                            // wall, e.g. "FRONT DESK" / "STUDIO 2". Empty = off.


// ══ OPTIONAL FEATURES ════════════════════════════════════════════════════
// Each of these renders nothing when false. The geometry is written and
// maintained either way, so turning one on later is a re-render, not a
// redesign.

// ── Reset button (panel-mount momentary, across ESP32 EN and GND) ──
// SOLDERLESS-COMPATIBLE: EN and GND are both screw terminals, so a pre-wired
// panel-mount button plugs straight in.
//
// Usually unnecessary: most 30-pin breakout boards carry their own RESET and
// BOOT buttons, which is the whole reason to prefer a listing that has them —
// the DevKit's own buttons are unreachable inside a closed case. Turn this on
// only if the board you receive lacks them.
include_reset_button = false;
button_hole_d = 12.5;       // [MEASURE] panel-mount thread diameter
button_z = 12;              // centre height above the floor
button_y_offset = 58;       // distance from the back wall

// ── Power switch (SPDT toggle interrupting 5V to VIN) ──
// NOT SOLDERLESS. Interrupting 5V between the USB-C connector and VIN cannot
// be done on a DevKit without cutting a trace or soldering, because the
// connector feeds VIN on-board. Practical solderless alternatives:
//   - an inline USB power switch dongle on the cable, or
//   - simply unplugging the device.
// Left here, off, with geometry ready, in case a v2 uses a soldered board.
include_power_switch = false;
switch_hole_d = 6.5;        // [MEASURE] panel-mount thread diameter
switch_z = 12;
switch_y_offset = 22;

// ── DS3231 RTC (declined for this build) ──
// Without a battery-backed clock the device learns the time from NTP at boot;
// a boot before WiFi means it does not know what time it is. The firmware
// handles that by refusing to record attendance until the clock is trusted
// (see src/clock_gate.h), rather than writing wrong timestamps. If that
// tradeoff ever becomes annoying, this turns the pocket on.
include_rtc = false;
rtc_l = 38.0;               // [MEASURE] DS3231 module
rtc_w = 22.0;
rtc_h = 5.0;

// ── RGB status LED (declined for this build) ──
// The OLED is one inch across; someone tapping and walking away cannot read it
// from a step back. A panel LED is legible across a room.
include_rgb_led = false;
led_hole_d = 5.2;           // 5 mm LED plus fit
led_z = 24;
led_x_offset = 20;

// ── Desk stand ──
// A SEPARATE 15-degree wedge the box drops into, not an angled box top.
// Keeping it separate matters: an angled TOP would move the antenna away from
// the tap surface (the v1 design rejected a wedged box for exactly that
// reason, measuring ~40 mm to the angled face against a ~30 mm reliable read
// range). A flat box in a tilted cradle keeps the antenna-to-card distance
// unchanged and makes the tilt a one-parameter reprint.
stand_angle = 15;
stand_lip_h = 8;            // front lip height that retains the box
stand_wall_t = 3.0;
foot_d = 8;                 // stick-on rubber feet (buy, don't print)
foot_recess_h = 1.0;
foot_inset = 9;


// ══ RENDER QUALITY ═══════════════════════════════════════════════════════
// $fa/$fs rather than a global $fn: curve resolution then scales with feature
// size instead of making tiny holes expensive and large arcs coarse.
$fa = 1;
$fs = 0.4;


// ══ EXTERNAL FOOTPRINT AND THE PRINT PLATE ══════════════════════════════
//
// External size is box_ix + 2*wall_t by box_iy + 2*wall_t — 76.8 x 118.8 mm at
// the current values.
//
// Narrow-and-deep turns out to plate very well. On a 250 x 210 bed:
//
//     2 bases side by side        159 x 119 mm    fits easily
//     3 bases side by side        240 x 119 mm    still fits
//     2 bases + 2 lids together   243 x 159 mm    fits (rotated)
//     2 stands                    173 x 119 mm    fits
//
// So BOTH devices' bases and lids go on a single plate, and the stands on a
// second. That is one print run rather than the two the old wide box needed.
//
// The earlier 130 x 100 layout could not manage four parts on a plate in any
// orientation, which is a small extra reason the stacked design is better.
//
// CONFIRM THE ACTUAL BED SIZE before treating any of this as settled.
