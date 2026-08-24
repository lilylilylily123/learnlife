// LearnLife NFC Attender — enclosure lid
// ======================================
//
// A featureless plate. Deliberately: no electronics live here, so no wires
// cross the parting line and opening the box strains nothing.
//
// Its one real job is to be THIN over the antenna. That is also why it is a
// separate, cheap part — if read range through the plastic disappoints, you
// reprint a 20-minute lid rather than a 6-hour base.
//
// ── THE ANTENNA POCKET ───────────────────────────────────────────────────
//
// The plate is `lid_plate_t` thick (4 mm) so a 125 x 95 mm panel doesn't flex,
// with a pocket milled into its UNDERSIDE over the coil that thins it locally
// to `lid_t` (from the tile test). Thin where the physics needs it, stiff
// everywhere else.
//
// No screw, insert or rib may intrude into that pocket footprint — see
// antenna_keepout in params.scad for why metal near the coil matters.
//
// ── COORDINATE SYSTEM ────────────────────────────────────────────────────
//
// Modelled in ASSEMBLY orientation, sharing the base's XY frame so features
// line up by construction:
//
//   z = 0 .. lip_h                     the alignment lip, descending into the box
//   z = lip_h .. lip_h + lid_plate_t   the plate
//
// ── PRINT ────────────────────────────────────────────────────────────────
//
//   OUTER FACE ON THE BED — flip it 180 degrees in the slicer.
//
//   That matters twice over: the face a card touches comes out as the smooth
//   bed surface, and the thickness over the antenna is exact rather than at the
//   mercy of top-layer variation. No supports; the lip prints as a small
//   overhang the slicer handles as a bridge.
//
//   openscad -o stl/lid.stl lid.scad
//
//   The exported STL extends BELOW z=0 — the OLED ribs hang down from the
//   plate. That is expected, not a bug; every slicer drops the part onto the
//   bed on import.
//
// ⚠ DO NOT PRINT until params.scad holds real caliper readings — the geometry
//   is correct, the numbers driving it are still placeholders.

include <params.scad>
use <lib/shapes.scad>
include <lib/layout_checks.scad>

// ══ DERIVED ══════════════════════════════════════════════════════════════
// Mirrors base.scad so the two parts stay in the same coordinate frame.

ext_x = box_ix + 2 * wall_t;
ext_y = box_iy + 2 * wall_t;
lid_h = lip_h + lid_plate_t;          // total height of this part

function ix(x) = wall_t + x;
function iy(y) = wall_t + y;

// The coil centre, in the same world coordinates the base uses. Everything on
// the top face — the label, the glyph, the tap target — is positioned from
// here rather than from the middle of the lid, because the coil is usually not
// centred on its board and the board is not centred in the box.
antenna_cx = ix(pn_pos_x) + pn_l / 2 + pn_coil_cx;
antenna_cy = iy(pn_pos_y) + pn_w / 2 + pn_coil_cy;

// How far the OLED ribs hang below the plate. Sized so they overlap the
// display by a few millimetres — asserted in lid_checks().
rib_len = 8;

// Pocket footprint: the coil plus a margin. Square because a rectangular
// pocket is far easier to inspect for stray screws than a circle.
antenna_pocket = pn_coil_d + 8;

function boss_positions() = [
  [ix(boss_inset),          iy(boss_inset)],
  [ix(box_ix - boss_inset), iy(boss_inset)],
  [ix(boss_inset),          iy(box_iy - boss_inset)],
  [ix(box_ix - boss_inset), iy(box_iy - boss_inset)],
];

// ══ ENTRY POINT ══════════════════════════════════════════════════════════

layout_checks();
lid_checks();

lid();

module lid() {
  difference() {
    union() {
      plate();
      lip();
      oled_ribs();
    }
    antenna_pocket_cut();
    buzzer_grille();
    screw_holes();
    label_deboss();
    if (nfc_glyph) nfc_glyph_deboss();
    if (device_label != "") device_label_deboss();
  }
}

// ══ CHECKS SPECIFIC TO THIS PART ═════════════════════════════════════════

module lid_checks() {
  // A screw inside the antenna pocket would put steel right next to the coil
  // AND thin the plate where a fastener needs material.
  half = antenna_pocket / 2;
  for (i = [0 : 3]) {
    p = boss_positions()[i];
    inside = abs(p[0] - antenna_cx) < half + screw_head_d / 2 &&
             abs(p[1] - antenna_cy) < half + screw_head_d / 2;
    assert(!inside,
           str("Lid screw ", i, " falls inside the antenna pocket. ",
               "Move the PN532 (pn_pos_*) or the boss (boss_inset) — a steel ",
               "screw next to the coil detunes it, and the pocket leaves too ",
               "little material to hold a thread."));
  }

  assert(lid_t + 0.4 <= lid_plate_t,
         str("Antenna pocket leaves too little plate: lid_t (", lid_t,
             ") vs lid_plate_t (", lid_plate_t, ")."));

  // At least 1 mm of plate must remain under each screw head for it to bear
  // on. This caught a real bug: at lid_plate_t = 3 the 3 mm counterbore went
  // clean through the top face.
  // The lip must clear the corner bosses, which start boss_inset - boss_od/2
  // in from the interior edge.
  assert(lip_t + fit_lip < boss_inset - boss_od / 2,
         str("Lid lip (", lip_t + fit_lip,
             "mm from the wall) collides with the corner bosses, which start ",
             boss_inset - boss_od / 2, "mm in. Reduce lip_t or raise boss_inset."));

  // The ribs must actually reach the OLED, or the display is retained by
  // nothing and can fall backwards into the box. Easy to break silently by
  // changing oled_z or box_iz, hence the check.
  oled_top   = floor_t + oled_z + oled_pcb_w / 2;
  rib_bottom = (floor_t + box_iz) - rib_len;
  assert(oled_top - rib_bottom >= 2.0,
         str("OLED retaining ribs barely reach the display: ",
             oled_top - rib_bottom, "mm of engagement. Lengthen rib_len, ",
             "raise oled_z, or lower box_iz."));

  assert(screw_head_h + 1.0 <= lid_plate_t,
         str("Countersink too deep: head (", screw_head_h,
             ") + 1mm bearing > plate (", lid_plate_t,
             "). Raise lid_plate_t or use a shallower screw head."));
}

// ══ GEOMETRY ═════════════════════════════════════════════════════════════

module plate() {
  translate([0, 0, lip_h])
    rounded_slab(ext_x, ext_y, lid_plate_t, corner_r);
}

// A rim that drops straight into the base's opening. It locates the lid and
// closes the seam against dust; the screws do the actual holding.
//
// It descends INTO the interior rather than sitting in a groove machined into
// the wall. A groove would leave only ~0.55mm of plastic outside it at the
// current wall thickness — about one extrusion, weak and visibly wavy. This
// way the wall stays full thickness and the plate lands flat on its rim.
module lip() {
  inner_r = max(corner_r - wall_t, 0.1);
  translate([wall_t + fit_lip, wall_t + fit_lip, 0])
    difference() {
      rounded_slab(box_ix - 2 * fit_lip, box_iy - 2 * fit_lip,
                   lip_h + 0.01, inner_r);
      translate([lip_t, lip_t, -0.5])
        rounded_slab(box_ix - 2 * fit_lip - 2 * lip_t,
                     box_iy - 2 * fit_lip - 2 * lip_t,
                     lip_h + 1, max(inner_r - lip_t, 0.1));
    }
}

// Two ribs that press the OLED against its window frame when the lid closes.
// This is what holds the display with no screws at all — the module simply
// drops into its pocket in the front wall and is trapped from above.
module oled_ribs() {
  rib_w = 4;
  // Sit just behind the front wall, straddling the display.
  for (dx = [-(oled_pcb_l / 2 - rib_w), (oled_pcb_l / 2 - rib_w)])
    translate([ix(oled_pos_x) + dx - rib_w / 2,
               wall_t + oled_pcb_t + fit_pcb,
               lip_h - rib_len])
      cube([rib_w, 2.5, rib_len + 0.01]);
}

// The pocket that thins the plate over the coil.
module antenna_pocket_cut() {
  depth = lid_plate_t - lid_t;
  translate([antenna_cx - antenna_pocket / 2,
             antenna_cy - antenna_pocket / 2,
             lip_h - 0.01])
    cube([antenna_pocket, antenna_pocket, depth + 0.01]);
}

// Clearance holes with a countersink from the top face, so screw heads sit
// flush and nothing catches a sleeve reaching across the desk.
module screw_holes() {
  for (p = boss_positions()) {
    translate([p[0], p[1], -0.5])
      cylinder(h = lid_h + 1, d = screw_pilot_d + 1.2);
    translate([p[0], p[1], lid_h - screw_head_h])
      cylinder(h = screw_head_h + 0.1, d = screw_head_d);
  }
}

// Sound holes above the buzzer, which lies face-up on the floor at the back.
// Deliberately far from the antenna pocket at the front: holes there would
// weaken the tap surface and sit directly over the coil.
module buzzer_grille() {
  span = (sound_hole_n - 1) * sound_hole_pitch;
  for (i = [0 : sound_hole_n - 1])
    for (j = [0 : sound_hole_n - 1])
      translate([ix(buz_pos_x) - span / 2 + i * sound_hole_pitch,
                 iy(buz_pos_y) - span / 2 + j * sound_hole_pitch,
                 -0.5])
        cylinder(h = lid_h + 1, d = sound_hole_d);
}

// ══ TOP-FACE GRAPHICS ════════════════════════════════════════════════════
// Debossed (cut in) rather than raised: a raised label under the tap zone
// would hold the card off the surface, and every millimetre of air gap costs
// read range.

module label_deboss() {
  translate([antenna_cx, antenna_cy + label_offset_y,
             lid_h - label_deboss_depth])
    linear_extrude(height = label_deboss_depth + 0.1)
      text(label_text, size = label_size, halign = "center", valign = "center",
           font = label_font);
}

// The universal NFC mark: three concentric arcs, centred on the coil so it
// doubles as the aiming point.
module nfc_glyph_deboss() {
  translate([antenna_cx, antenna_cy + nfc_glyph_offset_y,
             lid_h - label_deboss_depth])
    linear_extrude(height = label_deboss_depth + 0.1)
      for (r = nfc_glyph_radii)
        difference() {
          circle(r = r);
          circle(r = r - nfc_glyph_stroke);
          // Keep the upper half only, so it reads as a signal fanning out.
          translate([-r - 2, -r - 2]) square([2 * (r + 2), r + 2]);
        }
}

// Optional second line naming the unit ("FRONT DESK"), so two devices are
// distinguishable at a glance. Placed near the back edge, clear of the tap
// zone.
module device_label_deboss() {
  translate([ext_x / 2, ext_y - 10, lid_h - label_deboss_depth])
    linear_extrude(height = label_deboss_depth + 0.1)
      text(device_label, size = 4, halign = "center", valign = "center",
           font = label_font);
}
