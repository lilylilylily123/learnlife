// Shared geometry helpers.
//
// Plain CSG only — cube, cylinder, union, difference. No minkowski(), no
// hull(). Both are slower, and neither has a clean B-rep equivalent, which
// would make a later port to CadQuery/Fusion (for editable STEP output) much
// more painful than it needs to be. Everything here maps one-to-one onto any
// CAD kernel. See the note at the top of params.scad.

// A slab with vertical rounded corners: four corner cylinders plus two
// crossing cubes filling the middle.
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

// A screw boss: a cylinder with a pilot hole down its axis.
//
// `pilot_inset` leaves a short solid plug at the bottom so the screw tip
// cannot punch through the floor and stand proud underneath, which would rock
// the box on the desk.
module screw_boss(h, od, pilot_d, pilot_inset = 1.5) {
  difference() {
    cylinder(h = h, d = od);
    translate([0, 0, pilot_inset])
      cylinder(h = h - pilot_inset + 0.1, d = pilot_d);
  }
}

// A post that a PCB screws down onto. Same idea as screw_boss but sized for
// the small self-tappers that hold modules rather than the lid.
module pcb_post(h, od, pilot_d) {
  screw_boss(h, od, pilot_d, 1.0);
}

// A row of vertical ventilation slots, centred on the origin in X, extruded
// along +Y far enough to cut through a wall.
//
// Slots rather than round holes: at a 0.4 mm nozzle a 2 mm slot prints with
// clean vertical walls, while small circles come out ragged and undersized.
module vent_slots(n, slot_w, slot_l, gap, cut_depth) {
  total_w = n * slot_w + (n - 1) * gap;
  for (i = [0 : n - 1])
    translate([-total_w / 2 + i * (slot_w + gap), -0.5, 0])
      cube([slot_w, cut_depth + 1, slot_l]);
}

// A grid of round sound holes for the buzzer, centred on the origin, cutting
// along +Y.
//
// 2.0 mm holes, not 1.5: below about 2 mm a 0.4 mm nozzle renders circles
// ragged and undersized, and a blocked-sounding buzzer is a support call.
module sound_holes(n, hole_d, pitch, cut_depth) {
  span = (n - 1) * pitch;
  for (i = [0 : n - 1])
    for (j = [0 : n - 1])
      translate([-span / 2 + i * pitch, 0, -span / 2 + j * pitch])
        rotate([-90, 0, 0])
          cylinder(h = cut_depth + 1, d = hole_d);
}

// Two small holes for threading a zip tie, so a tug on the USB cable loads
// the box rather than the ESP32's connector.
module ziptie_holes(spacing, hole_w, hole_h, cut_depth) {
  for (x = [-spacing / 2, spacing / 2])
    translate([x - hole_w / 2, -0.5, 0])
      cube([hole_w, cut_depth + 1, hole_h]);
}
