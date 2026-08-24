// LearnLife NFC Attender — assembly preview
// =========================================
//
// Not a printable part. This is the "look at it before you book the printer"
// view: base, lid and mock modules in their real positions, so a layout
// mistake is obvious on screen rather than six hours into a print.
//
// lib/layout_checks.scad catches numeric collisions automatically. This
// catches the things a number can't: a connector pointing at a wall, a tap
// target somewhere awkward to reach, a display you'd have to crouch to read.
//
// ── VIEW IT ──────────────────────────────────────────────────────────────
//
//   openscad assembly.scad                 # GUI, orbit around it
//   openscad -o /tmp/a.png --viewall --autocenter \
//            --camera=0,0,0,60,0,25,0 --projection=p assembly.scad
//
// Toggle `show_lid = false` to look inside.

include <params.scad>
use <lib/shapes.scad>

show_lid   = true;
show_parts = true;
lid_lift   = 25;      // exploded gap, mm. 0 = closed.

// Mirrors the derived values in base.scad / lid.scad.
ext_x = box_ix + 2 * wall_t;
ext_y = box_iy + 2 * wall_t;
ext_z = floor_t + box_iz;

function ix(x) = wall_t + x;
function iy(y) = wall_t + y;

stb_fx = (stb_rotate == 90) ? stb_w : stb_l;
stb_fy = (stb_rotate == 90) ? stb_l : stb_w;

// ══ SCENE ════════════════════════════════════════════════════════════════

color("Gainsboro") import("stl/base.stl");

if (show_lid)
  color("SlateGray", 0.55)
    translate([0, 0, ext_z - lip_h + lid_lift])
      import("stl/lid.stl");

if (show_parts) mock_modules();

// ══ MOCK MODULES ═════════════════════════════════════════════════════════
// Simple slabs at measured sizes. Enough to see whether things fit and face
// the right way; not detailed models.

module mock_modules() {
  // Screw-terminal breakout, with the DevKit riding on top of it.
  color("DarkGreen", 0.85)
    translate([ix(stb_pos_x), iy(stb_pos_y), floor_t + stb_standoff_h])
      cube([stb_fx, stb_fy, 1.6]);

  color("DimGray", 0.9)
    translate([ix(stb_pos_x) + (stb_fx - esp_w) / 2,
               iy(stb_pos_y) + (stb_fy - esp_l) / 2,
               floor_t + stb_standoff_h + stb_h - esp_t])
      cube([esp_w, esp_l, esp_t]);

  // PN532 on its tall posts, with the coil footprint picked out so the
  // keepout to the breakout is visible rather than merely asserted.
  color("Crimson", 0.85)
    translate([ix(pn_pos_x), iy(pn_pos_y), floor_t + pn_post_h])
      cube([pn_l, pn_w, pn_t]);

  color("Orange", 0.6)
    translate([ix(pn_pos_x) + pn_l / 2 + pn_coil_cx,
               iy(pn_pos_y) + pn_w / 2 + pn_coil_cy,
               floor_t + pn_post_h + pn_t])
      linear_extrude(height = 0.4)
        square([pn_coil_d, pn_coil_d], center = true);

  // OLED, standing in its front-wall pocket.
  color("Navy", 0.9)
    translate([ix(oled_pos_x) - oled_pcb_l / 2 - oled_glass_off_x,
               wall_t,
               floor_t + oled_z - oled_pcb_w / 2 - oled_glass_off_y])
      cube([oled_pcb_l, oled_pcb_t, oled_pcb_w]);

  // Piezo, edge-on against the front wall facing its sound holes.
  color("Goldenrod", 0.9)
    translate([ix(buz_pos_x), wall_t + buz_h / 2, floor_t + buz_d / 2 + 2])
      rotate([90, 0, 0])
        cylinder(h = buz_h, d = buz_d, center = true);
}
