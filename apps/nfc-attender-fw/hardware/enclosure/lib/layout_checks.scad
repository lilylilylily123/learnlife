// Layout sanity checks, run at render time.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
//
// The first draft of base.scad rendered as a perfectly valid manifold solid
// with THREE collisions in it: the breakout overlapped a corner boss, the
// buzzer overlapped the OLED pocket, and the antenna keepout was violated by
// 0.65 mm. None of that is visible in a render — OpenSCAD happily fuses
// overlapping solids into one clean-looking part, and the mistakes would have
// surfaced as a module that physically would not seat, six hours into a print.
//
// So the clearances are asserted instead of eyeballed. Change a module
// dimension, and the render FAILS with a message naming the constraint that
// broke, rather than silently producing a part that can't be assembled.
//
// This matters most for the values that are still placeholders: when the real
// screw-terminal breakout arrives and its dimensions go into params.scad, these
// checks are what say whether the layout still works or the box needs resizing.
//
// Included by base.scad. Every value comes from params.scad.

// Rectangles are [x, y, w, h]. Overlap is strict — touching is allowed,
// because two parts sharing an edge is a design decision, while two parts
// sharing area is always a mistake.
function _overlaps(a, b) =
  (a[0] < b[0] + b[2]) && (b[0] < a[0] + a[2]) &&
  (a[1] < b[1] + b[3]) && (b[1] < a[1] + a[3]);

// A circle's bounding box, for checking against the rectangles above. Using
// the bounding box is deliberately conservative: it can report a collision for
// a corner that would actually clear, which errs toward a part that assembles.
function _circle_box(cx, cy, r) = [cx - r, cy - r, 2 * r, 2 * r];

module layout_checks() {
  // ── Footprints, in INTERNAL coordinates ────────────────────────────────
  stb_fx = (stb_rotate == 90) ? stb_w : stb_l;
  stb_fy = (stb_rotate == 90) ? stb_l : stb_w;

  stb_rect = [stb_pos_x, stb_pos_y, stb_fx, stb_fy];
  pn_rect  = [pn_pos_x, pn_pos_y, pn_l, pn_w];

  buz_r    = buz_d / 2 + 2;          // disc plus its retaining ring
  buz_rect = _circle_box(buz_pos_x, buz_pos_y, buz_r);

  oled_rect = [oled_pos_x - (oled_pcb_l + 2 * fit_pcb) / 2, 0,
               oled_pcb_l + 2 * fit_pcb,
               oled_pcb_t + fit_pcb + 0.6];

  boss_r = boss_od / 2;
  boss_rects = [
    _circle_box(boss_inset,          boss_inset,          boss_r),
    _circle_box(box_ix - boss_inset, boss_inset,          boss_r),
    _circle_box(boss_inset,          box_iy - boss_inset, boss_r),
    _circle_box(box_ix - boss_inset, box_iy - boss_inset, boss_r),
  ];

  // ── Everything fits inside the box ─────────────────────────────────────
  assert(stb_pos_x >= 0 && stb_pos_x + stb_fx <= box_ix &&
         stb_pos_y >= 0 && stb_pos_y + stb_fy <= box_iy,
         str("Breakout board doesn't fit: needs x ", stb_pos_x, "..",
             stb_pos_x + stb_fx, ", y ", stb_pos_y, "..", stb_pos_y + stb_fy,
             " inside ", box_ix, "x", box_iy,
             ". Increase box_ix/box_iy, move stb_pos_*, or try stb_rotate=",
             (stb_rotate == 90) ? 0 : 90, "."));

  assert(pn_pos_x >= 0 && pn_pos_x + pn_l <= box_ix &&
         pn_pos_y >= 0 && pn_pos_y + pn_w <= box_iy,
         str("PN532 doesn't fit: needs x ", pn_pos_x, "..", pn_pos_x + pn_l,
             ", y ", pn_pos_y, "..", pn_pos_y + pn_w,
             " inside ", box_ix, "x", box_iy, "."));

  // ── The antenna keepout ────────────────────────────────────────────────
  // The one constraint that is about physics rather than packaging: copper
  // parallel and close to the coil acts as a shorted turn and detunes it.
  // Measured from the COIL edge, not the board edge, because the coil is
  // usually not centred on its board.
  coil_x0 = pn_pos_x + pn_l / 2 + pn_coil_cx - pn_coil_d / 2;
  coil_x1 = pn_pos_x + pn_l / 2 + pn_coil_cx + pn_coil_d / 2;
  stb_x1  = stb_pos_x + stb_fx;

  assert(coil_x0 - stb_x1 >= antenna_keepout || stb_pos_x - coil_x1 >= antenna_keepout,
         str("Antenna keepout violated: only ", coil_x0 - stb_x1,
             "mm between the breakout and the coil, need ", antenna_keepout,
             "mm. Move pn_pos_x right, move the breakout left, widen box_ix, ",
             "or lower antenna_keepout if the coil-over-breakout test in ",
             "docs/measurements.md showed the copper doesn't matter."));

  // ── Nothing overlaps a corner boss ─────────────────────────────────────
  // The bosses run full height, so anything overlapping one simply cannot be
  // fitted — this was a real bug in the first draft.
  for (i = [0 : 3]) {
    assert(!_overlaps(stb_rect, boss_rects[i]),
           str("Breakout overlaps corner boss ", i,
               ". Bosses occupy ~", boss_inset + boss_r,
               "mm from each edge; move stb_pos_* clear of that."));
    assert(!_overlaps(pn_rect, boss_rects[i]),
           str("PN532 overlaps corner boss ", i, "."));
    assert(!_overlaps(buz_rect, boss_rects[i]),
           str("Buzzer overlaps corner boss ", i, "."));
  }

  // ── Front-wall features don't collide ──────────────────────────────────
  assert(!_overlaps(buz_rect, oled_rect),
         str("Buzzer ring overlaps the OLED pocket. Buzzer spans x ",
             buz_rect[0], "..", buz_rect[0] + buz_rect[2],
             ", OLED pocket spans x ", oled_rect[0], "..",
             oled_rect[0] + oled_rect[2],
             ". Move buz_pos_x or oled_pos_x."));

  assert(!_overlaps(buz_rect, stb_rect),
         "Buzzer overlaps the breakout board. Move buz_pos_x or buz_pos_y.");
  assert(!_overlaps(buz_rect, pn_rect),
         "Buzzer overlaps the PN532. Move buz_pos_x or buz_pos_y.");

  assert(oled_pos_x - oled_win_l / 2 > 0 &&
         oled_pos_x + oled_win_l / 2 < box_ix,
         "OLED window runs off the end of the front wall — check oled_pos_x.");

  // ── Vertical clearances ────────────────────────────────────────────────
  assert(pn_post_h + pn_t + antenna_air_gap <= box_iz,
         str("PN532 sits too high: posts (", pn_post_h, ") + board (", pn_t,
             ") + air gap (", antenna_air_gap, ") = ",
             pn_post_h + pn_t + antenna_air_gap,
             " exceeds the ", box_iz, "mm interior. Raise box_iz or lower ",
             "pn_post_h — but lowering it moves the antenna away from the card."));

  assert(lid_t < lid_plate_t,
         str("lid_t (", lid_t, ") must be less than lid_plate_t (", lid_plate_t,
             ") — the antenna pocket thins the lid from underneath, so it ",
             "cannot be thicker than the lid itself."));

  assert(oled_z + oled_win_w / 2 < box_iz,
         "OLED window runs above the top of the wall — lower oled_z.");

  // ── Print-plate sanity ─────────────────────────────────────────────────
  // Not an error, just worth knowing before a makerspace booking: two bases
  // per plate is what halves the number of visits.
  ext_x = box_ix + 2 * wall_t;
  ext_y = box_iy + 2 * wall_t;
  echo(str("[layout] external ", ext_x, " x ", ext_y,
           " mm — two per plate needs ", 2 * min(ext_x, ext_y), " x ",
           max(ext_x, ext_y), " mm of bed"));
}
