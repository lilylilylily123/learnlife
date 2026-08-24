# Print settings

Every part is designed to print **support-free**. If your slicer wants to add
supports, something is wrong with the orientation — check the table below
before letting it.

## Material

**PETG if the makerspace has it.** A closed box on a Spanish desk in June can
exceed PLA's ~55 °C glass transition, and a warped lid over the antenna is a
reprint. PLA is fine indoors away from a window.

⚠️ **Never print the lid in carbon-fibre or metal-filled filament.** Conductive
loading detunes the antenna and kills read range. Plain PLA or PETG only — the
same material you validated with `antenna_tiles.stl`.

## Per-part

| Part | Orientation | Supports | Notes |
|---|---|---|---|
| `base` | open side **up** | none | Bosses and posts build upward; the OLED window bridges ~26 mm |
| `lid` | outer face **on the bed** | none | Gives a perfectly flat panel at exactly `lid_t` over the antenna |
| `stand` | large flat triangle face down | none | |
| `retainer`, `clamp` | flat | none | |
| `coupon`, `antenna_tiles` | flat | none | |

The lid orientation matters most: printing it outer-face-down means the surface
a card touches is the smooth bed face, and its thickness is exact rather than
subject to top-layer variation.

**Flip the lid 180° in the slicer.** It is modelled in assembly orientation so
its features line up with the base, which means the OLED retaining ribs hang
*below* z=0 in the exported STL. That is expected, not a bug — every slicer
drops the part onto the bed on import.

## Settings

| Setting | Value | Why |
|---|---|---|
| Layer height | 0.2 mm | `lid_t` should be a multiple of this |
| Perimeters | 3 | Matches `wall_t = 2.4` at a 0.4 nozzle |
| Top/bottom layers | 4–5 | |
| Infill | 20–25% gyroid | Nothing here is structural |
| First layer | slower, no brim needed | |

## Bed size drives the footprint

External size is `box_ix + 2*wall_t` × `box_iy + 2*wall_t` — **124.8 × 92.8 mm**
at the defaults.

Two bases side by side is ~250 mm, which does **not** fit a 250 × 210 bed.
Rotated 90°, it's ~186 × 128 mm, which does. Keeping the external footprint at
or below **~125 × 95 mm** buys two parts per plate and halves the number of
makerspace visits.

Four parts (2 bases + 2 lids) will not fit a 250 × 210 bed in any orientation.

**Confirm the real bed size before treating `box_ix`/`box_iy` as final.**

## Suggested plates

| Visit | Plate | Time |
|---|---|---|
| 1 | `antenna_tiles` + `coupon` | ~45 min |
| 2 | A: 2 × `base` · B: 2 × `lid` + 2 × `stand` + retainers | ~10–14 h |
| 3 (reserve) | Reprints — most likely just lids | |

If the makerspace is genuinely one-shot, print **one complete device** at visit
2 and the second only after the first assembles and works. Losing one enclosure
to a fit error is annoying; losing two is a schedule problem.

## After printing

1. **Test-fit before assembling anything.** Drop each module into its pocket dry.
2. If a pocket is tight, change `fit_pcb` in `params.scad` and reprint that
   part — **don't file it.** Filing loses the measurement for the second unit.
3. Drive each self-tapper in slowly the first time; printed threads cut best
   under steady pressure.
