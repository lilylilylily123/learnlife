# NFC Attender — enclosure

Parametric OpenSCAD enclosure for the standalone NFC attendance terminal.
Two units, solderless assembly, printed at a school/makerspace printer.

## Looking at the model

```bash
cd apps/nfc-attender-fw/hardware/enclosure
./view.sh              # assembly preview — then press F5
./view.sh base         # or a single part
```

Two things that make it look broken when it isn't:

- **The OpenSCAD window opens empty.** It does not render on open — press
  **F5**. (F6 is the slow exact render; you only need it before exporting.)
- **It must be run from this directory.** Every part does
  `include <params.scad>`, which resolves against the working directory, so
  `openscad apps/.../assembly.scad` from the repo root opens a blank new
  document instead. `view.sh` cds for you.

The `qt.qpa.fonts` and `FALLBACK` lines OpenSCAD prints on macOS are harmless.

## Start here

Nothing in this directory needs to be designed before you can start printing.
The first two parts exist specifically so that a printer booking is never
blocked on a measurement.

```bash
brew uninstall --cask openscad          # deprecated cask, disabled 2026-09-01
brew install --cask openscad@snapshot   # installs the app + an `openscad` CLI

./export.sh                             # renders everything into stl/
```

**Almost none of this waits on the screw-terminal breakout.** That board only
sets the box's footprint (`box_ix`/`box_iy`). Everything below can happen now,
and `lib/layout_checks.scad` will tell you if the real dimensions break the
layout when you finally plug them in.

Then, in order:

1. **Run the coil-over-ESP32 test** (`docs/measurements.md` §0). Nothing to
   print. Validates the stacked layout — the biggest assumption in the design.

2. **Print `stl/coupon.stl`** — one 120 × 90 mm test plate, ~40 min. Converts
   one print into the five tolerance numbers at the top of `params.scad`.

3. **Measure your modules** with calipers into `docs/measurements.md`, and copy
   the results into `params.scad`. Everything except the breakout is already in
   your hands.

4. When the breakout arrives, measure it, re-render, and only then print the
   enclosure itself.

`antenna_tiles.stl` also exists but is **optional** — the card ends up 3.8 mm
from the coil, so lid thickness isn't the lever it looks like. Reasoning is in
the worksheet.

Steps 1–3 are independent of each other and of the breakout.

## Files

| File | What it is |
|---|---|
| `params.scad` | **Every** tunable dimension. Flat `name = value;` lines only. |
| `antenna_tiles.scad` | Thickness ladder for the read-through-plastic test. Standalone. |
| `coupon.scad` | Tolerance test plate: calibration square, screw bosses, PCB pockets, lip grooves, USB slots, bridge test. |
| `base.scad` | The tray. Holds every module; has the OLED window, USB cutout, vents. |
| `lid.scad` | Featureless plate. Thin over the antenna, TAP CARD label, screws down. |
| `assembly.scad` | **Not printable.** Preview of base + lid + mock modules — look at this before booking a printer. |
| `lib/layout_checks.scad` | Clearance asserts that run on every render. See below. |
| `export.sh` | Renders every part to `stl/`. `--check` parses without writing. |
| `view.sh` | Opens a part in the GUI from the correct directory. |
| `stl/` | Generated STLs, committed so a makerspace never needs the toolchain. |
| `docs/measurements.md` | Caliper worksheet — fill in, then copy into `params.scad`. |

Parts still to be written: `stand.scad` (the 15° wedge), `retainer.scad` (dupont
hold-down bar), `clamp.scad` (external cable clamp). `export.sh` skips them
until they exist.

## The layout is checked, not eyeballed

`lib/layout_checks.scad` asserts every clearance at render time — module
footprints inside the box, the antenna keepout, nothing overlapping a corner
boss, the OLED ribs actually reaching the display, the countersink not breaking
through the lid.

This is not decoration. The first draft of `base.scad` rendered as a perfectly
valid manifold solid with **three real collisions in it**: the breakout
overlapped a corner boss, the buzzer overlapped the OLED pocket, and the antenna
keepout was short by 0.65 mm. None of that is visible in a render — OpenSCAD
fuses overlapping solids into one clean-looking part, and you would find out six
hours into a print.

So when you replace the placeholder dimensions with real measurements, the
render either succeeds or fails with a message naming the constraint that broke
and what to change:

```
ERROR: Assertion failed: "Antenna keepout violated: only 5.35mm between the
breakout and the coil, need 12mm. Move pn_pos_x right, move the breakout left,
widen box_ix, or lower antenna_keepout if the coil-over-breakout test showed
the copper doesn't matter."
```

Expect the box to **shrink** once the real breakout is measured — the
placeholder (75 × 50 mm) is a guess at the large end, and `box_ix`/`box_iy` are
sized to fit it.

## How to change the design

**Edit numbers in `params.scad`. Don't edit geometry.** If a pocket is tight,
change `fit_pcb` and re-render; nothing else moves. That is the entire point of
the parametric setup, and it is what makes the print → measure → adjust loop
cheap when each print is a trip across town.

`params.scad` deliberately contains **only** `name = value;` lines — no
functions, no computed values. That keeps the escape hatch to Fusion 360 or
CadQuery cheap: a flat list of parameters can be machine-translated to JSON or
retyped into Fusion's parameter table in ten minutes. The moment that file
contains logic, that stops being true.

For the same reason the geometry uses plain CSG only — `cube`, `cylinder`,
`difference`, `union`, `translate`, `linear_extrude`. No `minkowski()`, and no
`hull()`: both are slower, and neither has a clean B-rep equivalent, so either
would make a later STEP port painful.

## Design rationale

**Two-part box plus a separate wedge stand. All modules mount to the base; the
lid is a featureless plate.** No electronics in the lid, because otherwise four
dupont wires cross the parting line and every service visit strains them. The
lid's only job is to be thin over the antenna — so if read range disappoints,
you reprint a 20-minute lid rather than the whole box.

**The PN532 sits on tall posts directly above the breakout board.**
13.56 MHz NFC is a near-field *magnetic* link. Plastic is nearly transparent to
it; what destroys range is a conductive surface close and parallel to the coil,
acting as a shorted turn and detuning it. The ESP32 has a large ground pour and
a metal shield can, and the breakout is a double-layer PCB with real copper.

What matters is **distance from the coil, not direction** — so 32 mm posts put
16 mm of air between the DevKit and the antenna, comfortably more than the
12 mm keepout, and the two boards stack.

An earlier version separated them sideways instead, which forced a
130 × 100 mm box with a 27 mm display marooned on a 130 mm face. Stacking makes
it **77 × 119 mm** — narrower than it is deep, like a card terminal.

Directly above is a slightly harsher position than beside at equal distance,
because more of the coil's flux passes through a board underneath it than past
one off to the side. Hence 16 mm rather than the bare minimum. The
coil-over-breakout test in `docs/measurements.md` §0 confirms it on the bench.

**The SHORT edge faces the user**, with the OLED in it. On the old 130 mm face
a 23 mm window occupied 18% of the width and looked lost; on a 77 mm face it is
30% and reads as a designed panel. Standing the display in a vertical wall also
puts its PCB edge-on to the coil's field rather than coplanar with it.

**The tap zone is at the front of the lid**, above the PN532, where a hand
naturally lands — not at the far end.

**The buzzer lies face-up on the floor at the back** and fires through a lid
grille. It cannot go in the front wall: at 72 mm internal there is only ~13 mm
beside the OLED and the collar needs 16. The back also keeps its holes well
away from the tap surface.

**The wedge is a separate cradle, not an angled box top.** The earlier
`hardware/production-enclosure-v1` design rejected a wedged box for a real
measured reason: an angled top surface put the antenna ~40 mm from the tap
face, past a ~30 mm reliable read range. A flat box sitting in a tilted cradle
keeps the antenna-to-card distance unchanged and makes the tilt a
one-parameter reprint.

**A screw terminal breakout board busses I²C, not a breadboard.** The DevKit
exposes one 3V3 pin, and each header pin accepts exactly one dupont housing, so
two peripherals cannot share power and I²C off it directly. Something has to fan
those nets out.

A mini breadboard was the first answer here and it was the wrong one. Breadboard
contacts are spring clips built for temporary prototyping — [not rated for
permanent installation](https://en.wikipedia.org/wiki/Breadboard), prone to
going intermittent under vibration, and higher-resistance than a clamped joint.
An intermittent I²C line in a device tapped a few hundred times a day is the
worst available failure mode: it doesn't fail cleanly, it works for a week and
then returns one garbage read.

A 30-pin ESP32 DevKit V1 screw terminal breakout fixes that with no soldering.
The DevKit plugs into its headers; every GPIO comes out on a screw clamp that
cannot vibrate loose. Buy the **"1 into 2"** variant — it duplicates each GPIO
to two terminals, exactly what 3V3, SDA and SCL need for two peripherals.

Prefer a listing with **onboard RESET and BOOT buttons**: the DevKit's own
buttons are unreachable inside a closed case.

Wiring is deliberately tool-light: cut female-to-female dupont jumpers in half
and strip the cut end. Bare wire into the screw terminal, surviving female end
onto the module's header pin. Wire strippers, nothing else.

This board — not the DevKit — is what bolts to the floor, which also removes
the "does this clone even have mounting holes?" problem, since the breakout has
them regardless of what the bare board does.

**Known limit:** this secures the ESP32 end of every wire, not both ends. The
peripheral end is still a dupont housing on a header pin, which is what the
printed retainer bar addresses. A soldered perfboard remains strictly more
robust — `hardware/production-enclosure-v1` has that design if it's ever worth
the iron and the hours.

**Fastening is M3 self-tapping screws into printed bosses.** Heat-set brass
inserts are the better long-term joint, but they need a soldering iron and an
insert tip. Self-tappers survive dozens of open/close cycles, comfortably more
than this device's service life. `use_heatset_inserts` in `params.scad` switches
over if you end up buying an iron anyway.

## Materials

**PETG over PLA** where the makerspace has it. A closed box on a Spanish desk
in June can exceed PLA's ~55 °C glass transition. Both are RF-transparent.

**Never** print the lid in a carbon-fibre or metal-filled filament — conductive
loading will detune the antenna and kill read range.

## Print orientation

| Part | Orientation | Supports |
|---|---|---|
| `base` | open side up | none |
| `lid` | outer face on the bed | none |
| `stand` | large flat triangle face down | none |
| `coupon`, `antenna_tiles` | flat | none |

Everything is designed to print support-free. The lid prints outer-face-down so
the antenna panel comes out perfectly flat and at exactly `lid_t`.

## Bed size drives the footprint

External size is `box_ix + 2*wall_t` × `box_iy + 2*wall_t` — 124.8 × 92.8 mm at
the defaults.

Two bases side by side is ~250 mm, which does **not** fit a 250 × 210 bed.
Rotated 90°, it's ~186 × 128 mm, which does. Keeping the external footprint at
or below **~125 × 95 mm** buys two parts per plate, halving the number of
makerspace visits.

Four parts (2 bases + 2 lids) will not fit a 250 × 210 bed in any orientation.
Plan on plate A = 2 bases, plate B = 2 lids + 2 stands.

**Confirm the real bed size before treating `box_ix`/`box_iy` as final.**

## Print plan

- **Visit 1** — `antenna_tiles` + `coupon`. One small plate, ~45 min total.
- **Visit 2** — plate A: 2 × base. Plate B: 2 × lid + 2 × stand + retainers.
  Roughly 10–14 h.
- **Visit 3 (reserve)** — reprint whatever the first assembly proved wrong,
  most likely just lids.

If the makerspace is genuinely one-shot, print **one complete device** at visit
2 and the second only after the first assembles and works. Losing one enclosure
to a fit error is annoying; losing two is a schedule problem.
