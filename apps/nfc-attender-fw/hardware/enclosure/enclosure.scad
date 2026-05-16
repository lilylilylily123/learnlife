// LearnLife NFC Attender — production enclosure v1
// =================================================
// Two-piece rectangular project box for the front-desk NFC reader.
// Bottom tray holds the perfboard on standoffs; flat top lid carries the
// OLED window, NFC tap label (PN532 reads through), and buzzer grille.
//
// Rectangular (not wedged) for v1: keeps every component on a single
// horizontal perfboard with a consistent short distance to the top lid, so
// PN532 antenna-to-card-surface stays inside its reliable read range.
// A wedged/angled v2 would require splitting components between the
// perfboard and the lid.
//
// Render parts individually:
//   openscad -D 'part="bottom"' -o stl/bottom_tray.stl enclosure.scad
//   openscad -D 'part="top"'    -o stl/top_lid.stl    enclosure.scad
//
// Or open in the OpenSCAD GUI — default `part = "preview"` shows both
// halves assembled with a phantom perfboard for visual fit-check.

// ==== PARAMETERS (tweak these) ============================================

// --- footprint & height ---
width        = 100;    // X — left-right
depth        = 85;     // Y — front-back
tray_height  = 30;     // Z — bottom tray internal height (floor → top rim)
lid_height   = 6;      // Z — top lid thickness (wall + recessed cavity for components)

// --- material ---
wall         = 2.4;    // general wall thickness
nfc_window   = 1.6;    // wall directly above PN532 antenna (thinned region)
floor_thk    = 2.4;

// --- perfboard (70x90mm, 0.1" pitch, 4 corner holes) ---
// Mounted with the long axis (90mm) along the X (left-right) of the tray.
// This leaves room around it on all sides.
pb_long      = 90;     // along X
pb_short     = 70;     // along Y
pb_thk       = 1.6;
pb_hole_d    = 2.8;    // M2.5 self-tap pilot
pb_hole_inset= 3;      // distance from board edge to mounting-hole center
pb_clear     = 4;      // standoff height (gap under board for solder tails)

// --- component positions in PERFBOARD coordinates ---
// Origin = perfboard front-left corner (in tray frame: pb_origin_x, pb_origin_y)
// PN532 module footprint ~43x41mm; antenna coil centered.
// OLED module footprint ~27x27mm; active display 22x11mm centered (vertically).
pn532_pos    = [pb_long - 24, pb_short / 2];   // right side of board
oled_pos     = [22,            pb_short / 2 + 6];  // left side, slightly back
oled_active  = [22, 11];        // visible display rectangle

// --- top-lid features ---
buzzer_grid_pos    = [pb_long / 2 + 8, 12];  // perfboard-local XY
buzzer_grid_cols   = 3;
buzzer_grid_rows   = 5;
buzzer_hole_d      = 1.6;
buzzer_hole_p      = 3.2;

// NFC tap pad on lid is centered above PN532 antenna; lid surface there is
// thinned to `nfc_window` from the inside to keep antenna-to-card gap small.
nfc_pocket_size    = 45;        // square pocket on lid underside (mm)

// Engraved tap-label text on lid top surface
label_text         = "TAP CARD";
label_size         = 5;
label_deboss_depth = 0.6;

// --- side cutouts ---
// USB-C is on the ESP32, sticking out the right edge of the perfboard ~3mm.
// We cut a generous slot in the back wall so the ESP32 USB-C port lines up.
// (Final positioning is empirical — adjust during phase B fit-check.)
usb_cutout_w       = 12;
usb_cutout_h       = 7;
usb_cutout_x_off   = (100 - 12) / 2;   // centered along back wall — expects
                                        // the ESP32 to sit centered on the
                                        // perfboard with USB-C facing back.
                                        // Adjust if your ESP32 lands offset.

// SPDT toggle switch — right side wall
switch_hole_d      = 6.5;
switch_z           = 12;     // height above tray floor
switch_y_offset    = 22;     // distance from back wall to switch center

// 12mm tactile button — right side wall, forward of the switch
button_hole_d      = 12.5;
button_z           = 12;
button_y_offset    = 58;

// --- fasteners ---
insert_d           = 4.2;    // M3 brass heat-set insert (4.0mm + 0.2mm fit)
insert_depth       = 5;
insert_boss_d      = 7.5;
lid_screw_d        = 3.4;    // M3 clearance
lid_screw_head_d   = 6.0;    // socket-cap head + countersink
lid_screw_head_h   = 3.2;

// --- rubber-feet recesses on bottom face ---
foot_d             = 12;
foot_recess_h      = 1.0;
foot_inset         = 9;

// --- derived ---
pb_origin_x = (width - pb_long) / 2;
pb_origin_y = (depth - pb_short) / 2;
pb_top_z    = floor_thk + pb_clear + pb_thk;
inner_corner_inset = insert_boss_d/2 + 1.0;  // distance of insert boss center from corner
tray_outer_top_z   = floor_thk + tray_height;

$fn = $preview ? 32 : 64;

// ==== ENTRY POINT =========================================================
part = "preview"; // "preview" | "bottom" | "top"

if      (part == "bottom") bottom_tray();
else if (part == "top")    top_lid();
else                       preview();

// ==== PREVIEW =============================================================
module preview() {
  color("Tan", 0.9) bottom_tray();
  color("DimGray", 0.55)
    translate([0, 0, tray_outer_top_z]) top_lid();
  // Phantom perfboard
  color("ForestGreen", 0.4)
    translate([pb_origin_x, pb_origin_y, floor_thk + pb_clear])
      cube([pb_long, pb_short, pb_thk]);
}

// ==== BOTTOM TRAY =========================================================
module bottom_tray() {
  difference() {
    union() {
      // Outer rectangular solid (full height)
      cube([width, depth, tray_outer_top_z]);
      // (insert bosses live INSIDE the hollow; see below)
    }

    // Hollow interior — leaves walls and floor
    translate([wall, wall, floor_thk])
      cube([width - 2*wall, depth - 2*wall, tray_height + 0.1]);

    // Side / back cutouts
    usb_cutout_3d();
    switch_cutout_3d();
    button_cutout_3d();

    // Rubber-feet recesses on the bottom face
    feet_recesses();
  }

  // Perfboard standoffs (after the difference so they aren't hollowed away)
  pb_standoffs();

  // Insert bosses in 4 inside corners, with bores
  insert_bosses_inside();
}

// ==== TOP LID =============================================================
// Flat plate that bolts onto the tray rim with 4 corner M3 screws.
// Kept flat (no alignment cavity) so the screw holes and inserts can sit
// on the same XY corners without geometry conflicts. The screws + the
// snug match of tray and lid outer footprints provide alignment.
module top_lid() {
  difference() {
    cube([width, depth, lid_height]);

    // OLED window — cut all the way through
    oled_window_cut();

    // Buzzer grille
    buzzer_grille_cut();

    // 4 screw holes through lid into tray inserts (countersunk on top)
    lid_screw_holes();

    // NFC tap label engraved on top surface
    nfc_label_deboss();

    // PN532 antenna window — thin the lid locally (pocket on bottom)
    nfc_thin_pocket();
  }
}

// ==== HELPERS ============================================================

module pb_standoffs() {
  pos = [
    [pb_origin_x + pb_hole_inset,           pb_origin_y + pb_hole_inset],
    [pb_origin_x + pb_long - pb_hole_inset, pb_origin_y + pb_hole_inset],
    [pb_origin_x + pb_hole_inset,           pb_origin_y + pb_short - pb_hole_inset],
    [pb_origin_x + pb_long - pb_hole_inset, pb_origin_y + pb_short - pb_hole_inset],
  ];
  for (p = pos) {
    translate([p[0], p[1], floor_thk - 0.01])
      difference() {
        cylinder(h = pb_clear + 0.01, d = 5.5);
        translate([0, 0, 1])
          cylinder(h = pb_clear + 2, d = pb_hole_d);
      }
  }
}

// Insert bosses live inside the tray, in the 4 corners, against the walls.
// They reach from the floor up to the top rim, with a bore for the M3
// heat-set insert from the TOP.
module insert_bosses_inside() {
  pos = corner_positions();
  for (p = pos)
    translate([p[0], p[1], floor_thk - 0.01])
      difference() {
        cylinder(h = tray_height + 0.02, d = insert_boss_d);
        // Bore from the top for the heat-set insert
        translate([0, 0, tray_height - insert_depth + 0.01])
          cylinder(h = insert_depth + 0.5, d = insert_d);
      }
}

function corner_positions() = [
  [wall + inner_corner_inset,         wall + inner_corner_inset],
  [width - wall - inner_corner_inset, wall + inner_corner_inset],
  [wall + inner_corner_inset,         depth - wall - inner_corner_inset],
  [width - wall - inner_corner_inset, depth - wall - inner_corner_inset],
];

module usb_cutout_3d() {
  // Back wall (Y = depth). USB-C on the ESP32 is at perfboard top + ~3mm.
  z_center = pb_top_z + 4.5;
  translate([usb_cutout_x_off, depth - wall - 0.5,
             z_center - usb_cutout_h/2])
    cube([usb_cutout_w, wall + 1, usb_cutout_h]);
}

module switch_cutout_3d() {
  translate([width - wall - 0.5, depth - switch_y_offset, switch_z])
    rotate([0, 90, 0])
      cylinder(h = wall + 1, d = switch_hole_d);
}

module button_cutout_3d() {
  translate([width - wall - 0.5, depth - button_y_offset, button_z])
    rotate([0, 90, 0])
      cylinder(h = wall + 1, d = button_hole_d);
}

module feet_recesses() {
  pos = [
    [foot_inset,           foot_inset],
    [width - foot_inset,   foot_inset],
    [foot_inset,           depth - foot_inset],
    [width - foot_inset,   depth - foot_inset],
  ];
  for (p = pos)
    translate([p[0], p[1], -0.01])
      cylinder(h = foot_recess_h, d = foot_d);
}

// ---- lid features (lid-local coords; X,Y match tray) ----

// Convert perfboard-local (px, py) → lid-local (X, Y).
// The lid's local origin is (0,0) at front-left; the perfboard's front-left
// corner is at (pb_origin_x, pb_origin_y) in the tray frame, which is the
// same XY frame as the lid.
function lid_xy(px, py) = [pb_origin_x + px, pb_origin_y + py];

module oled_window_cut() {
  pos = lid_xy(oled_pos[0], oled_pos[1]);
  translate([pos[0] - oled_active[0]/2, pos[1] - oled_active[1]/2, -0.5])
    cube([oled_active[0], oled_active[1], lid_height + 1]);
}

module buzzer_grille_cut() {
  pos = lid_xy(buzzer_grid_pos[0], buzzer_grid_pos[1]);
  grid_w = (buzzer_grid_cols - 1) * buzzer_hole_p;
  grid_h = (buzzer_grid_rows - 1) * buzzer_hole_p;
  for (i = [0:buzzer_grid_cols-1])
    for (j = [0:buzzer_grid_rows-1])
      translate([pos[0] - grid_w/2 + i*buzzer_hole_p,
                 pos[1] - grid_h/2 + j*buzzer_hole_p,
                 -0.5])
        cylinder(h = lid_height + 1, d = buzzer_hole_d);
}

module lid_screw_holes() {
  pos = corner_positions();
  for (p = pos) {
    // Clearance hole through the lid
    translate([p[0], p[1], -0.1])
      cylinder(h = lid_height + 0.2, d = lid_screw_d);
    // Countersink for socket-cap head, recessed from top surface
    translate([p[0], p[1], lid_height - lid_screw_head_h + 0.01])
      cylinder(h = lid_screw_head_h + 0.1, d = lid_screw_head_d);
  }
}

module nfc_label_deboss() {
  pos = lid_xy(pn532_pos[0], pn532_pos[1]);
  // Text label
  translate([pos[0], pos[1] + 14, lid_height - label_deboss_depth])
    linear_extrude(height = label_deboss_depth + 0.05)
      text(label_text, size = label_size,
           halign = "center", valign = "center",
           font = "Helvetica:style=Bold");
  // Simple NFC wave glyph — 3 concentric upper-half arcs
  translate([pos[0], pos[1] - 4, lid_height - label_deboss_depth])
    linear_extrude(height = label_deboss_depth + 0.05)
      for (r = [6, 9, 12])
        difference() {
          circle(r = r);
          circle(r = r - 1);
          translate([-r - 2, -r - 2]) square([2*(r + 2), r + 2]);
        }
}

module nfc_thin_pocket() {
  // Pocket on the INSIDE (bottom face) of the lid above PN532.
  // The lid spans Z=0 (bottom) to Z=lid_height (top). The pocket removes
  // material from Z=0 up to Z=(lid_height - nfc_window), leaving a thin
  // window of `nfc_window` thickness on top.
  pocket_depth = lid_height - nfc_window;
  pos = lid_xy(pn532_pos[0], pn532_pos[1]);
  translate([pos[0] - nfc_pocket_size/2,
             pos[1] - nfc_pocket_size/2,
             -0.01])
    cube([nfc_pocket_size, nfc_pocket_size, pocket_depth + 0.01]);
}
