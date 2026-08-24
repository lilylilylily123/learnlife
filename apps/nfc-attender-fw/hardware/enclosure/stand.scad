// LearnLife NFC Attender — desk stand
// ===================================
//
// A wedge cradle the assembled box drops into. Separate from the enclosure on
// purpose: the tilt becomes a one-parameter reprint of a cheap part, and if it
// turns out to be wrong the box still works sitting flat.
//
// ── WHICH WAY IT TILTS, AND WHY ──────────────────────────────────────────
//
// The FRONT is raised, so the box leans AWAY from the user.
//
// That looks backwards until you think about where the display is. The OLED is
// in the box's front wall — vertical when the box sits flat. Someone standing
// at a desk looks DOWN at the device, so a vertical face is seen at a glancing
// angle and reads poorly. Leaning the box back rotates that face toward the
// viewer's actual line of sight.
//
// The tap surface wants the opposite tilt, which is the real tension here — but
// tapping is done by feel and works at any angle, while reading does not. So
// the display wins.
//
// ── THE COST OF ANGLE ────────────────────────────────────────────────────
//
// Rise at the front is depth x sin(angle), and this box is deep:
//
//     8 deg  ->  17 mm rise,  58 mm total height
//    10 deg  ->  21 mm rise,  62 mm total height
//    12 deg  ->  25 mm rise,  66 mm total height
//    15 deg  ->  31 mm rise,  72 mm total height   <- stand_angle default
//    20 deg  ->  41 mm rise,  82 mm total height
//
// 15 degrees is assertive on a 119 mm deep box — it nearly doubles the height
// and the stand ends up using about as much filament as the enclosure. If it
// looks top-heavy in `./view.sh stand`, try 10: change stand_angle and
// re-render, nothing else moves.
//
// ── PRINT ────────────────────────────────────────────────────────────────
//
//   Flat on its base, as modelled. No supports — every overhang is either the
//   shallow underside relief or the incline itself.
//
//   openscad -o stl/stand.stl stand.scad

include <params.scad>
use <lib/shapes.scad>

// ══ DERIVED ══════════════════════════════════════════════════════════════

ext_x = box_ix + 2 * wall_t;
ext_y = box_iy + 2 * wall_t;
ext_z = floor_t + box_iz;

// Clearance so the box drops in rather than being pressed in — this is a
// cradle, not an interference fit.
cradle_fit = 0.6;

cradle_x = ext_x + 2 * cradle_fit;
cradle_y = ext_y + 2 * cradle_fit;

rise   = cradle_y * sin(stand_angle);   // how high the front sits
d_proj = cradle_y * cos(stand_angle);   // depth once tilted

W = cradle_x + 2 * stand_wall_t;
D = d_proj + stand_wall_t;              // + back stop

// Relief pocket under the wedge. Saves a lot of filament on what is otherwise
// a solid triangular block, and shortens the print considerably.
relief_inset = stand_wall_t + 4;
relief_h_margin = 5;

$fa = 1;
$fs = 0.4;

// ══ CHECKS ═══════════════════════════════════════════════════════════════

assert(stand_angle > 0 && stand_angle < 45,
       "stand_angle must be between 0 and 45 degrees.");

assert(stand_lip_h < ext_z * 0.5,
       str("stand_lip_h (", stand_lip_h, ") is more than half the box height — ",
           "the cradle would swallow the display."));

echo(str("[stand] ", stand_angle, " deg: front rises ", rise,
         "mm, assembled height ", rise + ext_z,
         "mm, footprint ", W, " x ", D, "mm"));

// ══ ENTRY POINT ══════════════════════════════════════════════════════════

stand();

module stand() {
  difference() {
    wedge();
    box_cradle();
    underside_relief();
    foot_recesses();
  }
}

// The body: a trapezoid in the YZ plane, extruded across the width.
//
// Its top edge runs from (front, rise + lip) down to (back, lip) — the incline
// the box rests on, offset upward by stand_lip_h so the leftover material at
// the sides and back becomes a retaining lip.
module wedge() {
  translate([0, 0, 0])
    rotate([90, 0, 90])
      linear_extrude(height = W)
        polygon([
          [0, 0],                        // front bottom
          [D, 0],                        // back bottom
          [D, stand_lip_h],              // back stop, top
          [d_proj, stand_lip_h],         // where the incline meets the stop
          [0, rise + stand_lip_h],       // front top
        ]);
}

// The box itself, tilted into position and oversized, carved out of the wedge.
// Everything it removes is the cradle; what survives beside and behind it is
// the lip.
module box_cradle() {
  translate([stand_wall_t, 0, cradle_y * sin(stand_angle)])
    rotate([-stand_angle, 0, 0])
      cube([cradle_x, cradle_y, ext_z + 20]);
}

// Hollow out the middle of the wedge from below. The walls that remain follow
// the same profile, so the part still looks solid from every visible angle.
module underside_relief() {
  translate([relief_inset, 0, -0.01])
    rotate([90, 0, 90])
      linear_extrude(height = W - 2 * relief_inset)
        polygon([
          [relief_inset, 0],
          [D - relief_inset, 0],
          [D - relief_inset, max(stand_lip_h - relief_h_margin, 0.5)],
          [relief_inset, max(rise + stand_lip_h - relief_h_margin, 0.5)],
        ]);
}

// Stick-on rubber feet, recessed so they can't peel off by catching the desk.
module foot_recesses() {
  for (x = [foot_inset, W - foot_inset])
    for (y = [foot_inset, D - foot_inset])
      translate([x, y, -0.01])
        cylinder(h = foot_recess_h, d = foot_d);
}
