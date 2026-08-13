// LearnLife NFC Attender — antenna thickness test tiles
// =====================================================
//
// PRINT THIS FIRST. Before the enclosure exists, before you own calipers,
// before any measurement has been taken. It is deliberately standalone — it
// does not include params.scad and depends on nothing.
//
// ── WHAT IT ANSWERS ──────────────────────────────────────────────────────
//
// The lid has to be thin enough over the PN532 that cards still read through
// it, and thick enough not to be flimsy. Every source you'll find quotes a
// different number. Rather than guess, measure your own stack: your PN532
// clone, your filament, your cards.
//
// Five loose tiles at 1.2 / 1.6 / 2.0 / 2.4 / 3.0 mm, each with its thickness
// raised on the top face. ~15 minutes of print time, ~10 g of filament.
//
// ── HOW TO RUN THE TEST ──────────────────────────────────────────────────
//
//  1. Set up the bench rig as usual (ESP32 + PN532 on the breadboard) and
//     open the serial monitor at 115200 so you can see each read land.
//  2. Lay one tile flat on top of the PN532, covering the coil.
//  3. Hold a REAL school card flat on the tile, centred over the coil.
//     Lift it slowly and note the height at which reads stop being reliable.
//     "Reliable" = 5 taps out of 5, not 3 out of 5.
//  4. Repeat for each tile. Record in docs/measurements.md:
//
//        thickness | max reliable read height | notes
//        ----------|--------------------------|----------------------
//        1.2 mm    |                          |
//        1.6 mm    |                          |
//        2.0 mm    |                          |
//        2.4 mm    |                          |
//        3.0 mm    |                          |
//
//  5. Pick the THICKEST tile that still gives comfortable range with the card
//     resting directly on it, and put that number in params.scad as `lid_t`.
//     Thicker is better for stiffness; you are buying the most rigidity you
//     can afford without hurting reads.
//
// ── WHY THIS ISN'T JUST ABOUT THICKNESS ──────────────────────────────────
//
// 13.56 MHz NFC is a near-field MAGNETIC link. Non-conductive plastic is
// close to transparent to it — a couple of millimetres of PLA or PETG costs
// you far less range than most people expect. What actually destroys range is
// a conductive surface lying parallel and close to the coil, which acts as a
// shorted turn and detunes the antenna.
//
// So while you have the rig out, run one extra trial that is worth more than
// the whole thickness ladder: put a metal object (a laptop, a steel ruler)
// flat under the PN532 and re-test. That effect is what drives the enclosure
// layout, which keeps the ESP32's ground plane and RF shield out from under
// the coil.
//
// Do NOT print these in a metal-filled, carbon-fibre or conductive filament.
// Plain PLA or PETG only — the same material you intend to use for the lid.
//
// ── RENDER ───────────────────────────────────────────────────────────────
//
//   openscad -o stl/antenna_tiles.stl antenna_tiles.scad
//
// or just open it in the OpenSCAD GUI and press F6, then export.

// ══ PARAMETERS ═══════════════════════════════════════════════════════════

thicknesses = [1.2, 1.6, 2.0, 2.4, 3.0];   // the ladder, in mm

// Labels are spelled out rather than derived with str(): OpenSCAD renders
// str(2.0) as "2" and str(3.0) as "3", which is ambiguous sitting next to a
// tile marked "2.4". Keep this array the same length as `thicknesses`.
labels = ["1.2", "1.6", "2.0", "2.4", "3.0"];

tile_l = 50;              // tile length — comfortably larger than a PN532 coil
tile_w = 45;              // tile width
tile_gap = 4;             // spacing between tiles on the plate
tiles_per_row = 3;        // 3 across keeps the plate ~158 x 94 mm

corner_r = 3;             // rounded corners, purely so they're nicer to handle

text_h = 0.6;             // how far the label stands proud of the tile face
text_size = 7;
text_font = "Helvetica:style=Bold";
text_inset = 6;           // label distance from the tile's near edge

$fa = 1;
$fs = 0.4;

// ══ ENTRY POINT ══════════════════════════════════════════════════════════

antenna_tiles();

module antenna_tiles() {
  for (i = [0 : len(thicknesses) - 1]) {
    row = floor(i / tiles_per_row);
    col = i % tiles_per_row;
    translate([col * (tile_l + tile_gap),
               row * (tile_w + tile_gap),
               0])
      tile(thicknesses[i], labels[i]);
  }
}

// One tile: a rounded slab with its thickness raised on the top face.
//
// The label sits near the near edge so the CENTRE of the tile stays flat and
// unobstructed — that centre is the part that lies over the coil and under
// the card, and anything raised there would add an air gap and corrupt the
// very measurement this tile exists to take.
module tile(t, label) {
  union() {
    rounded_slab(tile_l, tile_w, t, corner_r);

    // Raised, not engraved: engraving would locally thin the tile, and on the
    // 1.2 mm rung there isn't enough material to spare.
    translate([tile_l / 2, text_inset + text_size / 2, t])
      linear_extrude(height = text_h)
        text(label, size = text_size,
             halign = "center", valign = "center",
             font = text_font);
  }
}

// A slab with vertical rounded corners: four corner cylinders plus two
// crossing cubes that fill the middle.
//
// Deliberately NOT minkowski(), and not hull() either. Both are slower, and
// more importantly neither has a clean B-rep equivalent — which would make a
// later port to CadQuery/Fusion (for editable STEP output) much more painful
// than it needs to be. This union-of-primitives form maps one-to-one onto
// every CAD kernel. See the note at the top of params.scad.
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
