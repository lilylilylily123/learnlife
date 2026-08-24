// LearnLife NFC Attender — enclosure base
// =======================================
//
// The tray that holds everything. All four modules mount here; the lid is a
// featureless plate (see lid.scad). That split is deliberate: no wires cross
// the parting line, so opening the box doesn't strain a single connector, and
// a disappointing read range costs a 20-minute lid reprint rather than a
// 6-hour base.
//
// ⚠ DO NOT PRINT THIS YET unless the [MEASURE] values in params.scad have been
//   replaced with real caliper readings — especially the screw-terminal
//   breakout, which cannot be measured until it arrives. The geometry below is
//   correct; the numbers driving it are placeholders. Print antenna_tiles.stl
//   and coupon.stl first, fill in docs/measurements.md, then come back.
//
// ── COORDINATE SYSTEM ────────────────────────────────────────────────────
//
//   (0,0,0) = outer front-left-bottom corner
//   +X right, +Y towards the back, +Z up
//
//   Front wall  y = 0 .. wall_t          <- OLED window, buzzer holes
//   Back wall   y = ext_y-wall_t .. ext_y <- USB-C, vents, strain relief
//   Floor       z = 0 .. floor_t
//   Interior    starts at (wall_t, wall_t, floor_t)
//
// Module positions are given in INTERNAL coordinates (origin at the front-left
// inner corner) and offset by wall_t here, so params.scad never has to think
// about wall thickness.
//
// ── PRINT ────────────────────────────────────────────────────────────────
//
//   Open side UP. No supports. The OLED window bridges ~26 mm across its top
//   edge — if the coupon's BRIDGE test sagged, expect the same here.
//
//   openscad -o stl/base.stl base.scad

include <params.scad>
use <lib/shapes.scad>
include <lib/layout_checks.scad>

// ══ DERIVED ══════════════════════════════════════════════════════════════
// Computed here, never in params.scad — that file stays a flat list of
// name = value so it can be machine-translated for a CadQuery/Fusion port.

ext_x = box_ix + 2 * wall_t;      // 124.8 at defaults
ext_y = box_iy + 2 * wall_t;      //  92.8
ext_z = floor_t + box_iz;         //  42.4

// Internal -> world. Module positions in params are internal coordinates.
function ix(x) = wall_t + x;
function iy(y) = wall_t + y;

// Bosses run the full internal height so the lid can screw down into them.
boss_h_full = box_iz;

// Corner boss centres, in world coordinates.
function boss_positions() = [
  [ix(boss_inset),          iy(boss_inset)],
  [ix(box_ix - boss_inset), iy(boss_inset)],
  [ix(boss_inset),          iy(box_iy - boss_inset)],
  [ix(box_ix - boss_inset), iy(box_iy - boss_inset)],
];

// PN532 post centres. pn_pos_* is the board's front-left corner; the holes sit
// symmetrically inside it at pn_hole_dx/dy spacing.
function pn_post_positions() =
  let (cx = ix(pn_pos_x) + pn_l / 2,
       cy = iy(pn_pos_y) + pn_w / 2)
  [[cx - pn_hole_dx / 2, cy - pn_hole_dy / 2],
   [cx + pn_hole_dx / 2, cy - pn_hole_dy / 2],
   [cx - pn_hole_dx / 2, cy + pn_hole_dy / 2],
   [cx + pn_hole_dx / 2, cy + pn_hole_dy / 2]];

// Breakout board footprint, accounting for rotation.
stb_fx = (stb_rotate == 90) ? stb_w : stb_l;   // footprint along X
stb_fy = (stb_rotate == 90) ? stb_l : stb_w;   // footprint along Y
stb_hx = (stb_rotate == 90) ? stb_hole_dy : stb_hole_dx;
stb_hy = (stb_rotate == 90) ? stb_hole_dx : stb_hole_dy;

function stb_post_positions() =
  let (cx = ix(stb_pos_x) + stb_fx / 2,
       cy = iy(stb_pos_y) + stb_fy / 2)
  [[cx - stb_hx / 2, cy - stb_hy / 2],
   [cx + stb_hx / 2, cy - stb_hy / 2],
   [cx - stb_hx / 2, cy + stb_hy / 2],
   [cx + stb_hx / 2, cy + stb_hy / 2]];

// Antenna coil centre in world coordinates — the point the lid's TAP CARD
// label must sit above. Derived from the board position plus the measured
// coil offset, because the coil is usually NOT at the board's centre.
antenna_cx = ix(pn_pos_x) + pn_l / 2 + pn_coil_cx;
antenna_cy = iy(pn_pos_y) + pn_w / 2 + pn_coil_cy;

// USB-C sits at the height of the DevKit, which the breakout raises by stb_h.
usb_z = floor_t + stb_standoff_h + stb_h + esp_usb_h / 2;

// ══ ENTRY POINT ══════════════════════════════════════════════════════════

// Fails the render with a specific message if any clearance is violated.
// See lib/layout_checks.scad — the first draft of this file had three real
// collisions that rendered as a perfectly valid-looking solid.
layout_checks();

base();

module base() {
  difference() {
    union() {
      shell();
      corner_bosses();
      pn532_posts();
      breakout_posts();
      buzzer_ring();
      ziptie_bridge();
      if (include_wago_bay) wago_bay();
    }
    // Cuts, applied to everything above so a cutout passes cleanly through a
    // boss or post that happens to be in the way.
    front_wall_cuts();
    back_wall_cuts();
    oled_pocket();
    foot_recesses();
    if (include_reset_button) reset_button_hole();
    if (include_power_switch) power_switch_hole();
    if (include_rgb_led) led_hole();
  }
}

// ══ SHELL ════════════════════════════════════════════════════════════════

module shell() {
  difference() {
    rounded_slab(ext_x, ext_y, ext_z, corner_r);
    // Hollow the interior, leaving floor and walls.
    translate([wall_t, wall_t, floor_t])
      rounded_slab(box_ix, box_iy, box_iz + 1, max(corner_r - wall_t, 0.1));
  }
}

// NOTE: there is deliberately no groove cut into the wall for the lid's lip.
//
// The first version machined one, and it left only 0.55 mm of plastic outside
// it (wall_t 2.4 - lip_t 1.6 - fit_lip 0.25) — barely one extrusion, weak and
// visibly wavy at the top edge. Instead the interior itself is the socket: the
// lid's lip is a rim slightly smaller than the opening that drops straight in,
// and the lid plate lands flat on the full-thickness wall rim.
//
// Simpler, stronger, and one less mating dimension to get wrong.

// ══ MOUNTING ═════════════════════════════════════════════════════════════

module corner_bosses() {
  for (p = boss_positions())
    translate([p[0], p[1], floor_t - 0.01])
      screw_boss(boss_h_full + 0.01, boss_od, screw_pilot_d);
}

// Tall posts lifting the PN532 close to the lid. Post height sets the
// antenna-to-card distance, which together with lid_t is what the tile test
// measured.
module pn532_posts() {
  for (p = pn_post_positions())
    translate([p[0], p[1], floor_t - 0.01])
      pcb_post(pn_post_h + 0.01, pn_hole_d + 3.0, pn_hole_d - 0.6);
}

module breakout_posts() {
  for (p = stb_post_positions())
    translate([p[0], p[1], floor_t - 0.01])
      pcb_post(stb_standoff_h + 0.01, stb_hole_d + 3.0, stb_hole_d - 0.6);
}

// A collar on the INNER face of the front wall that grips the piezo disc
// edge-on, facing its sound holes.
//
// The disc stands VERTICALLY, not flat on the floor. A piezo radiates from its
// face, so one lying flat fires at the lid and the sound has to turn a corner
// to reach holes in the wall — audibly quieter. Standing it against the wall
// points it straight at the user.
module buzzer_ring() {
  collar_d = buz_d + 2 * 2.0;
  translate([ix(buz_pos_x), wall_t, floor_t + buz_d / 2 + 2])
    rotate([-90, 0, 0])
      difference() {
        cylinder(h = buz_h * 0.7, d = collar_d);
        translate([0, 0, -0.5])
          cylinder(h = buz_h, d = buz_d + 2 * 0.3);
        // Slot the collar so the disc can be pressed in and its leads exit.
        translate([-1.5, -collar_d, -0.5])
          cube([3, collar_d, buz_h + 1]);
      }
}

// A bar across the inside of the back wall. A zip tie through the two slots
// (cut in back_wall_cuts) traps the USB cable against it, so a yank on the
// cable loads the enclosure instead of the ESP32's surface-mount connector.
module ziptie_bridge() {
  bw = 16;
  translate([ext_x / 2 - bw / 2, ext_y - wall_t - 4, floor_t])
    cube([bw, 4, 10]);
}

// An open-topped corral for Wago lever nuts, off by default. Open-topped
// because the levers have to stay reachable — it stops them sliding around,
// it is not a lid.
module wago_bay() {
  bay_x = wago_n * (wago_w + wago_gap) + 2;
  translate([ix(box_ix) - bay_x - 2, iy(box_iy) - wago_l - 4, floor_t - 0.01])
    difference() {
      cube([bay_x, wago_l + 2, wago_h * 0.5]);
      translate([1, 1, 1])
        cube([bay_x - 2, wago_l, wago_h]);
    }
}

// ══ FRONT WALL: OLED window + buzzer ═════════════════════════════════════

module front_wall_cuts() {
  // Display window. Sized from the measured ACTIVE area plus a margin, not
  // from the glass — framing the glass would show the inactive border.
  translate([ix(oled_pos_x) - oled_win_l / 2,
             -0.5,
             floor_t + oled_z - oled_win_w / 2])
    cube([oled_win_l, wall_t + 1, oled_win_w]);

  // Buzzer sound holes, firing forward at the user. Through the FRONT wall,
  // not the floor — holes in the floor point at the desk and sound muffled.
  translate([ix(buz_pos_x), 0, floor_t + buz_d / 2 + 2])
    sound_holes(sound_hole_n, sound_hole_d, sound_hole_pitch, wall_t);
}

// A recess on the INNER face of the front wall that the OLED module drops
// into. Ribs on the lid's underside press it against this frame when the lid
// closes, so it needs no screws.
module oled_pocket() {
  pocket_d = oled_pcb_t + fit_pcb + 0.6;   // depth into the interior
  translate([ix(oled_pos_x) - (oled_pcb_l + 2 * fit_pcb) / 2 - oled_glass_off_x,
             wall_t - 0.01,
             floor_t + oled_z - (oled_pcb_w + 2 * fit_pcb) / 2 - oled_glass_off_y])
    cube([oled_pcb_l + 2 * fit_pcb,
          pocket_d,
          oled_pcb_w + 2 * fit_pcb]);
}

// ══ BACK WALL: USB-C, vents, strain relief ═══════════════════════════════

module back_wall_cuts() {
  // USB-C opening. Generous on purpose — this is the cutout most likely to be
  // slightly out of position, because it depends on where the DevKit lands on
  // the breakout AND on the connector's offset from the board centreline.
  translate([ext_x / 2 + esp_usb_center_off - (esp_usb_w + 2 * fit_usb) / 2,
             ext_y - wall_t - 0.5,
             usb_z - (esp_usb_h + 2 * fit_usb) / 2])
    cube([esp_usb_w + 2 * fit_usb, wall_t + 1, esp_usb_h + 2 * fit_usb]);

  // Convection vents. The ESP32 runs warm in a sealed box; these sit high on
  // the back wall where warm air collects.
  translate([ext_x / 2, ext_y - wall_t, floor_t + box_iz - vent_slot_l - 4])
    vent_slots(vent_slot_n, vent_slot_w, vent_slot_l, vent_slot_gap, wall_t);

  // Zip-tie slots either side of the bridge.
  translate([ext_x / 2, ext_y - wall_t, floor_t + 2])
    ziptie_holes(22, 3.5, 6, wall_t);
}

// ══ OPTIONAL SIDE-WALL FEATURES ══════════════════════════════════════════
// All off by default. Geometry is maintained either way so turning one on is
// a re-render, not a redesign.

module reset_button_hole() {
  translate([ext_x - wall_t - 0.5, ext_y - button_y_offset, floor_t + button_z])
    rotate([0, 90, 0])
      cylinder(h = wall_t + 1, d = button_hole_d);
}

module power_switch_hole() {
  translate([ext_x - wall_t - 0.5, ext_y - switch_y_offset, floor_t + switch_z])
    rotate([0, 90, 0])
      cylinder(h = wall_t + 1, d = switch_hole_d);
}

module led_hole() {
  translate([ix(led_x_offset), -0.5, floor_t + led_z])
    rotate([-90, 0, 0])
      cylinder(h = wall_t + 1, d = led_hole_d);
}

// ══ UNDERSIDE ════════════════════════════════════════════════════════════

// Shallow recesses so stick-on rubber feet sit flush and can't peel off by
// catching on the desk.
module foot_recesses() {
  for (x = [foot_inset, ext_x - foot_inset])
    for (y = [foot_inset, ext_y - foot_inset])
      translate([x, y, -0.01])
        cylinder(h = foot_recess_h, d = foot_d);
}
