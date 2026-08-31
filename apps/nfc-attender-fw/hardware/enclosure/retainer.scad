// LearnLife NFC Attender — dupont housing retainer collars
// ========================================================
//
//   openscad -o stl/retainer.stl retainer.scad
//
// ── WHAT IT IS ───────────────────────────────────────────────────────────
//
// A collar that pushes over a row of individual dupont housings and gangs
// them into one block, so no single wire can walk off its header pin. One per
// peripheral: the PN532 and the OLED each take four (VCC, GND, SDA, SCL).
// Two are rendered side by side on one plate.
//
// The ESP32 end of every wire is already secure — it lands in a screw
// terminal on the breakout, which cannot vibrate loose (see the breakout
// rationale in params.scad). The peripheral end is a loose moulded shell on a
// header pin, held by nothing but friction, and it is the reason for
// "Cards read intermittently" in the troubleshooting table. Four separate
// housings each backing off a little is the failure; one four-wide block that
// has to lift as a unit is the fix.
//
//        ┌──────────────┐
//        │ ┌──┬──┬──┬──┐│   <- collar, printed as one piece
//        │ │  │  │  │  ││
//        │ └──┴──┴──┴──┘│   <- four dupont housings pushed through it
//        └──────────────┘
//
// ── WHY IT IS STANDALONE ─────────────────────────────────────────────────
//
// It does not touch the enclosure and takes no dimension from it: it clips to
// the connector stack, not to the box. That is deliberate. A bar that pressed
// the housings against something would need to know which way each module's
// header faces and how the wires were dressed, and neither is knowable until
// the bench rig is recorded (docs/measurements.md §8). A collar needs only
// the connector's own dimensions, which are a standard.
//
// ── PRINT ────────────────────────────────────────────────────────────────
//
// Flat on the bed, collar axis vertical. Support-free — the opening is a
// straight rectangular through-hole. ~8 minutes, ~2 g for both.
//
// It has to push on by hand and stay on. If it will not go, raise
// `retainer_grip` in params.scad toward 0; if it falls off, make it more
// negative. Changing it by 0.05 is a noticeable difference.

include <params.scad>

$fa = 1;
$fs = 0.4;

// ══ DERIVED ══════════════════════════════════════════════════════════════

// The housings butt against each other at their moulded width, so the row
// spans n * housing_w — NOT n * pitch, which is the pin spacing and is
// slightly smaller.
row_x = dupont_n * dupont_housing_w;
row_y = dupont_housing_d;

// cut(): the opening has to match a physical part, so it inherits xy_comp.
// retainer_grip is the interference on top of that and is negative.
open_x = cut(row_x + 2 * retainer_grip);
open_y = cut(row_y + 2 * retainer_grip);

outer_x = open_x + 2 * retainer_wall_t;
outer_y = open_y + 2 * retainer_wall_t;

// A one-layer step at the bottom, slightly wider than the opening, so the
// collar finds the housings instead of catching on their corners. A tapered
// lead-in would need a scaled extrude; a step is plain CSG and prints the
// same by hand feel.
lead_in_h = 0.6;
lead_in   = 0.35;

plate_gap = 6;

// ══ CHECKS ═══════════════════════════════════════════════════════════════

assert(retainer_grip <= 0,
       str("retainer_grip is ", retainer_grip,
           " — a positive value makes the collar LOOSER than the housings, ",
           "so it falls off and does nothing. It is an interference fit: use ",
           "0 or a negative number."));

assert(open_x > 0 && open_y > 0,
       str("Collar opening collapsed to ", open_x, " x ", open_y,
           ". retainer_grip is too negative for this housing size."));

assert(retainer_wall_t >= 2 * nozzle_d,
       str("retainer_wall_t (", retainer_wall_t, ") is under two extrusions (",
           2 * nozzle_d, "). The collar would split the first time it is ",
           "pushed on."));

// The collar has to grip a useful fraction of the housing, not perch on its
// lip. Anything under ~3 mm rotates on the row instead of holding it.
assert(retainer_grip_h >= 3.0,
       str("retainer_grip_h (", retainer_grip_h,
           ") is too short to hold the row square. Use 3 mm or more."));

assert(retainer_grip_h >= 4 * layer_h,
       str("retainer_grip_h (", retainer_grip_h, ") is under four layers at ",
           layer_h, "mm — too thin to print with any strength."));

// The lead-in step must not eat the whole wall.
assert(lead_in < retainer_wall_t,
       str("Lead-in step (", lead_in, ") is wider than the wall (",
           retainer_wall_t, "), so the collar has no material at its mouth."));

echo(str("[retainer] collar ", outer_x, " x ", outer_y, " x ",
         retainer_grip_h, "mm, opening ", open_x, " x ", open_y,
         "mm for ", dupont_n, " housings"));

// ══ ENTRY POINT ══════════════════════════════════════════════════════════

plate();

module plate() {
  // Two collars: one for the PN532's header, one for the OLED's.
  for (i = [0, 1])
    translate([0, i * (outer_y + plate_gap), 0])
      collar();
}

module collar() {
  difference() {
    cube([outer_x, outer_y, retainer_grip_h]);

    // Main opening, straight through.
    translate([retainer_wall_t, retainer_wall_t, -0.5])
      cube([open_x, open_y, retainer_grip_h + 1]);

    // Lead-in step at the mouth.
    translate([retainer_wall_t - lead_in, retainer_wall_t - lead_in, -0.01])
      cube([open_x + 2 * lead_in, open_y + 2 * lead_in, lead_in_h + 0.01]);
  }
}
