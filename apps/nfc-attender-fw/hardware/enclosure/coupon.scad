// LearnLife NFC Attender — tolerance test coupon
// ==============================================
//
// PRINT THIS SECOND (after antenna_tiles.scad, before any enclosure part).
// One plate, 120 x 90 mm, 30-45 minutes.
//
// ── WHY ──────────────────────────────────────────────────────────────────
//
// Every printer, filament and slicer combination has its own dimensional
// personality. A pocket modelled at exactly 27.3 mm will not fit a 27.3 mm
// PCB, and by how much it misses is a property of YOUR setup, not of the
// design. Guessing costs a 6-hour reprint; measuring costs 40 minutes.
//
// This coupon converts one print into the five numbers at the top of
// params.scad. Print it, test it, write those numbers down, and the real
// enclosure has a genuine chance of fitting first time — which matters when
// printer access is a booking rather than a button.
//
// ── WHAT TO DO WITH IT ───────────────────────────────────────────────────
//
//  1. CALIBRATION BLOCK — measure the raised 20 mm square with calipers in
//     both X and Y. If it measures 20.15, your printer runs 0.15 oversize:
//     set `xy_comp = 0.15`. If it measures dead on, leave it at 0.
//     Do this FIRST — it is the master correction the rest inherit.
//
//  2. SCREW BOSSES — drive an M3 self-tapping screw into each of the three
//     pilot holes (2.3 / 2.5 / 2.7 mm). You want the one that cuts its own
//     thread and holds firmly WITHOUT splitting the boss. Too small and the
//     boss cracks; too large and the screw spins free. Set `screw_pilot_d`.
//
//  3. PCB POCKETS — drop your actual OLED module into each of the three
//     pockets (+0.20 / +0.35 / +0.50 mm per side). You want the tightest one
//     it drops into without force and without rattling. Set `fit_pcb`.
//
//  4. LIP GROOVES — try the loose test tab (printed alongside, to the right)
//     in each of the three grooves (+0.15 / +0.25 / +0.35 mm). You want a
//     positive sliding fit — snug enough to locate the lid, loose enough to
//     close by hand. Set `fit_lip`.
//
//  5. USB SLOTS — push YOUR actual USB-C cable through each of the three
//     slots in the standing wall (+0.30 / +0.60 / +1.00 mm). The connector
//     boot must pass without forcing. Set `fit_usb`.
//     They are cut through a VERTICAL wall on purpose: that is the
//     orientation they print in on the real base, and a hole in a standing
//     wall has to be bridged across its top edge, which a hole lying flat
//     does not. Testing it flat would give a misleadingly good result.
//
//  6. BRIDGE WINDOW — inspect the top edge of the 26 mm window in the same
//     wall. If the first layer over the opening sags, your printer doesn't
//     bridge that span cleanly and the real OLED window will want a chamfer
//     on its top edge. Note it; no parameter to set.
//
// Record everything in docs/measurements.md as you go.
//
// ── LAYOUT ───────────────────────────────────────────────────────────────
//
//   y=84  ┌───────────────────────────────────────────────┐  standing wall:
//         │  [usb] [usb] [usb]        [ bridge window ]   │  3 slots + window
//   y=58  │  ┌────────┐   (o) (o) (o)                     │  cal block + bosses
//         │  │ 20 CAL │    pilot ladder                   │
//   y=40  │  └────────┘  [==] [==] [==]                   │  lip grooves
//   y=6   │  ┌──────┐  ┌──────┐  ┌──────┐                 │  PCB pockets
//         └──┴──────┴──┴──────┴──┴──────┴─────────────────┘
//         x=0                                        x=120
//
// Every label sits in clear space beside the feature it names — the wall
// features are labelled on the wall's own front face.
//
// ── RENDER ───────────────────────────────────────────────────────────────
//
//   openscad -o stl/coupon.stl coupon.scad

include <params.scad>

// ══ PLATE ════════════════════════════════════════════════════════════════

coupon_l = 120;
coupon_w = 90;
coupon_t = 2.4;           // matches wall_t so pockets sit on realistic material
coupon_r = 3;

txt_size = 3.5;
txt_h = 0.6;
txt_font = "Helvetica";

// The ladders under test. Change these only to explore a different band;
// the defaults bracket normal FDM behaviour.
pcb_fits = [0.20, 0.35, 0.50];
lip_fits = [0.15, 0.25, 0.35];
usb_fits = [0.30, 0.60, 1.00];
pilot_ds = [2.3, 2.5, 2.7];

// ══ ENTRY POINT ══════════════════════════════════════════════════════════

coupon();
translate([coupon_l + 6, 4, 0]) lip_test_tab();

module coupon() {
  difference() {
    union() {
      rounded_slab(coupon_l, coupon_w, coupon_t, coupon_r);
      calibration_block();
      screw_boss_ladder();
      lip_groove_ribs();
      test_wall();
      plate_labels();
      wall_labels();
    }
    pcb_pocket_cuts();
    screw_pilot_cuts();
    lip_groove_cuts();
    test_wall_cuts();
  }
}

// ── ROW 1 (y 6..34): PCB pockets ────────────────────────────────────────
// Sized from the real OLED footprint in params.scad, so once you have
// measured your module these pockets test the true target size.
// Deliberately blind (1.4 mm deep in a 2.4 mm plate) so the board sits proud
// and lifts straight back out.

pocket_x0 = 6;
pocket_y = 6;
pocket_pitch = 36;
pocket_depth = 1.4;

module pcb_pocket_cuts() {
  for (i = [0 : len(pcb_fits) - 1]) {
    f = pcb_fits[i];
    translate([pocket_x0 + i * pocket_pitch, pocket_y, coupon_t - pocket_depth])
      cube([oled_pcb_l + 2 * f, oled_pcb_w + 2 * f, pocket_depth + 0.1]);
  }
}

// ── ROW 2 (y 40..48): lip grooves ───────────────────────────────────────
// A groove of the lid-lip cross-section at three clearances, cut into a
// raised rib so the groove has full-height walls on both sides, exactly as
// the real base rim does.

groove_x0 = 6;
groove_y = 40;
groove_pitch = 24;
rib_l = 16;
rib_w = 8;
rib_h = 4;

module lip_groove_ribs() {
  for (i = [0 : len(lip_fits) - 1])
    translate([groove_x0 + i * groove_pitch, groove_y, coupon_t])
      cube([rib_l, rib_w, rib_h]);
}

module lip_groove_cuts() {
  for (i = [0 : len(lip_fits) - 1]) {
    f = lip_fits[i];
    translate([groove_x0 + i * groove_pitch - 0.5,
               groove_y + (rib_w - (lip_t + 2 * f)) / 2,
               coupon_t + rib_h - lip_h])
      cube([rib_l + 1, lip_t + 2 * f, lip_h + 0.1]);
  }
}

// The mating tab, printed loose to the right of the plate. Nominal lip
// thickness with NO clearance — the clearance under test lives in the
// grooves, not here.
module lip_test_tab() {
  union() {
    cube([rib_l, lip_t, lip_h + 2]);
    translate([0, -3, 0]) cube([rib_l, 3, 2]);   // finger grip
  }
}

// ── ROW 3 (y 54..78): calibration block + screw boss ladder ─────────────

cal_x = 6;
cal_y = 56;
cal_size = 20;
cal_h = 3;

boss_x0 = 40;
boss_y = 68;
boss_pitch = 14;

// Local, not from params.scad: the real enclosure bosses run the full internal
// height of the box (see the note on boss_od there), which would make this
// coupon 40mm tall for no benefit. 12mm is deep enough to test whether a pilot
// size bites without splitting, which is the only question being asked here.
coupon_boss_h = 12;

module calibration_block() {
  translate([cal_x, cal_y, coupon_t])
    cube([cal_size, cal_size, cal_h]);
}

// Bosses at full design height so the screw engages a realistic depth of
// material — splitting usually starts near the top, so a short stub would
// flatter the result.
module screw_boss_ladder() {
  for (i = [0 : len(pilot_ds) - 1])
    translate([boss_x0 + i * boss_pitch, boss_y, coupon_t])
      cylinder(h = coupon_boss_h, d = boss_od);
}

module screw_pilot_cuts() {
  for (i = [0 : len(pilot_ds) - 1])
    translate([boss_x0 + i * boss_pitch, boss_y, coupon_t - 0.5])
      cylinder(h = coupon_boss_h + 1, d = pilot_ds[i]);
}

// ── BACK (y 84): standing test wall ─────────────────────────────────────

wall_x = 6;
wall_y = 84;
wall_l = 108;
wall_h = 22;

usb_x0 = 10;              // wall-local
usb_pitch = 20;
usb_z = 7;

win_x = 74;               // wall-local
win_l = 26;               // the OLED window's real span
win_w = 13;
win_z = 5;

module test_wall() {
  translate([wall_x, wall_y, coupon_t])
    cube([wall_l, wall_t, wall_h]);
}

module test_wall_cuts() {
  for (i = [0 : len(usb_fits) - 1]) {
    f = usb_fits[i];
    translate([wall_x + usb_x0 + i * usb_pitch,
               wall_y - 0.5,
               coupon_t + usb_z])
      cube([esp_usb_w + 2 * f, wall_t + 1, esp_usb_h + 2 * f]);
  }
  translate([wall_x + win_x, wall_y - 0.5, coupon_t + win_z])
    cube([win_l, wall_t + 1, win_w]);
}

// ── Labels ──────────────────────────────────────────────────────────────

module plate_labels() {
  // PCB pockets — in front, along the plate's front edge
  for (i = [0 : len(pcb_fits) - 1])
    flat_label(pocket_x0 + i * pocket_pitch, 1.5, str("+", pcb_fits[i]));

  // Lip grooves — just below each rib
  for (i = [0 : len(lip_fits) - 1])
    flat_label(groove_x0 + i * groove_pitch, groove_y - 4.5,
               str("+", lip_fits[i]));

  // Calibration block — below it
  flat_label(cal_x, cal_y - 4.5, "20.00 CAL");

  // Pilot ladder — in front of the bosses, clear of their footprint
  for (i = [0 : len(pilot_ds) - 1])
    flat_label(boss_x0 + i * boss_pitch - 3.5, boss_y - 9.5,
               str(pilot_ds[i]));
}

// Wall features are labelled on the wall's own front face, standing up.
// This is what keeps the plate in front of the wall completely clear — an
// earlier layout put these on the plate and they collided with the
// calibration block.
module wall_labels() {
  for (i = [0 : len(usb_fits) - 1])
    wall_label(wall_x + usb_x0 + i * usb_pitch, coupon_t + 2.0,
               str("+", usb_fits[i]));
  wall_label(wall_x + win_x, coupon_t + 1.0, "BRIDGE");
}

// Text raised on the top face of the plate.
module flat_label(x, y, s) {
  translate([x, y, coupon_t])
    linear_extrude(height = txt_h)
      text(s, size = txt_size, font = txt_font, valign = "baseline");
}

// Text raised on the wall's front face (the -Y face), standing vertically.
module wall_label(x, z, s) {
  translate([x, wall_y, z])
    rotate([90, 0, 0])
      linear_extrude(height = txt_h)
        text(s, size = txt_size, font = txt_font, valign = "baseline");
}

// ── Shared primitive ────────────────────────────────────────────────────
// Union-of-primitives rounded slab. Plain CSG, no hull()/minkowski() — see
// the note at the top of params.scad about keeping a CadQuery/Fusion port
// cheap.
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
