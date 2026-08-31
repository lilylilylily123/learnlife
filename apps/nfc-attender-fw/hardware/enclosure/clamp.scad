// LearnLife NFC Attender — external cable strain-relief clamp
// ===========================================================
//
//   openscad -o stl/clamp.stl clamp.scad
//
// ── WHAT IT IS ───────────────────────────────────────────────────────────
//
// A saddle that sits on the OUTSIDE face of the back wall, centred between
// the two zip-tie slots. The USB cable leaves the port, bends down the
// outside of the wall, and drops into the saddle's vertical groove. The same
// tie that runs through the two slots crosses the groove and pins the cable.
//
// The tie alone would work but would cut into the jacket and let the cable
// slide sideways. The saddle spreads that load over ~20 mm and locates the
// cable, so a yank loads the enclosure rather than the ESP32's surface-mount
// USB socket — the single most likely mechanical failure on this device.
//
// Belt-and-braces over the moulded internal ziptie_bridge in base.scad:
// that one traps the cable inside, this one takes the pull outside, and
// neither is load-bearing on its own.
//
// ── HOW IT MOUNTS ────────────────────────────────────────────────────────
//
// It does not screw on and it has no fasteners of its own. It is held by the
// tie, which is why its width has to stay clear of both tie runs:
//
//        ziptie_spacing (22)
//     |<------------------->|
//     [slot]             [slot]      <- back wall, seen from outside
//        \                 /
//         \___[ saddle ]__/           <- tie crosses the saddle's face
//              |  ||  |
//              |  ||  |               <- cable in the vertical groove
//
// ── PRINT ────────────────────────────────────────────────────────────────
//
// Flat face on the bed, groove facing up. Support-free: the groove is a
// half-cylinder opening upward and the tie channel is a shallow slot.
// ~10 minutes, ~3 g. Print two, one per unit.

include <params.scad>

$fa = 1;
$fs = 0.4;

// ══ DERIVED ══════════════════════════════════════════════════════════════

groove_d = cut(cable_od);                  // cut: must clear a real cable
clamp_x  = groove_d + 2 * clamp_ear;       // overall width across the wall
clamp_y  = groove_d / 2 + clamp_back_t;    // depth away from the wall

// The tie crosses the saddle's outer face, so it needs a channel or it would
// stand the cable off. Placed at mid height, where the slots put it.
tie_channel_w = cut(ziptie_slot_w) + 0.4;
tie_channel_z = clamp_h / 2;
tie_channel_d = 1.2;

// ══ CHECKS ═══════════════════════════════════════════════════════════════

// Both runs of the tie pass either side of the saddle. If the saddle is as
// wide as the slot spacing the tie cannot get past it and the part is
// unusable — which a render would not show.
assert(clamp_x + 2 < ziptie_spacing - ziptie_slot_w,
       str("Cable clamp is too wide to fit between the zip-tie slots: ",
           clamp_x, "mm across vs ", ziptie_spacing - ziptie_slot_w,
           "mm of gap. Reduce clamp_ear, or widen ziptie_spacing in ",
           "params.scad (which also moves the slots in base.scad)."));

// The groove must not break through the back of the saddle, or the tie
// would bear on the cable directly and there would be nothing to clamp to.
assert(clamp_back_t >= 2 * nozzle_d,
       str("clamp_back_t (", clamp_back_t, ") is thinner than two extrusions ",
           "(", 2 * nozzle_d, "). The cable groove would break through."));

// The tie channel must not cut the saddle in half.
assert(tie_channel_d < clamp_back_t,
       str("Tie channel (", tie_channel_d, ") is deeper than the material ",
           "behind the groove (", clamp_back_t, ")."));

assert(clamp_h > tie_channel_w + 4,
       str("clamp_h (", clamp_h, ") leaves no cable supported either side of ",
           "the tie channel."));

// ══ ENTRY POINT ══════════════════════════════════════════════════════════

clamp();

module clamp() {
  difference() {
    // Body: flat against the wall, corners rounded so it cannot dig into a
    // hand reaching behind the unit.
    rounded_slab(clamp_x, clamp_h, clamp_y, 2.0);

    cable_groove();
    tie_channel();
  }
}

// A vertical half-round trough down the outer face. Runs the full height so
// the cable is captured along its whole length rather than pinched at a point.
module cable_groove() {
  translate([clamp_x / 2, -0.5, clamp_y])
    rotate([-90, 0, 0])
      cylinder(h = clamp_h + 1, d = groove_d);
}

// A shallow slot across the outer face at tie height, so the tie sits flush
// instead of standing the cable off the saddle.
module tie_channel() {
  translate([-0.5, tie_channel_z - tie_channel_w / 2,
             clamp_y - tie_channel_d])
    cube([clamp_x + 1, tie_channel_w, tie_channel_d + 0.1]);
}

// ══ SHAPES (local copy) ══════════════════════════════════════════════════
// This part uses exactly one helper. `use <lib/shapes.scad>` would work, but
// duplicating four lines keeps the part renderable on its own — the same
// reason antenna_tiles.scad depends on nothing.

module rounded_slab(l, w, h, r) {
  union() {
    for (x = [r, l - r])
      for (y = [r, w - r])
        translate([x, y, 0])
          cylinder(h = h, r = r);
    translate([r, 0, 0]) cube([l - 2 * r, w, h]);
    translate([0, r, 0]) cube([l, w - 2 * r, h]);
  }
}
