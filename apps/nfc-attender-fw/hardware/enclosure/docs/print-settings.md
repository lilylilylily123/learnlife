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

External size is `box_ix + 2*wall_t` × `box_iy + 2*wall_t` — **76.8 × 118.8 mm**.

Narrow-and-deep plates well. On a 250 × 210 bed:

| Plate | Size | |
|---|---|---|
| 2 bases side by side | 159 × 119 mm | fits easily |
| 3 bases side by side | 240 × 119 mm | still fits |
| **2 bases + 2 lids** | 243 × 159 mm | fits, rotated |
| 2 stands | 173 × 119 mm | fits |

So **both devices' bases and lids go on one plate**, and the stands on a second
— one print run, not two. The earlier wide layout couldn't manage four parts on
a plate in any orientation.

**Confirm the real bed size before treating this as settled.**

## Suggested plates

| Run | Parts | Rough time | Filament |
|---|---|---|---|
| 1 | `coupon` (+ `antenna_tiles` if wanted) | ~40–55 min | ~15 g |
| 2 | 2 × `base` + 2 × `lid` — both devices, one plate | ~20 h | ~236 g |
| 3 | 2 × `stand` | ~10 h | ~118 g |

Run 1 must come first — it sets the five tolerance parameters everything else
inherits, and it costs under an hour.

If committing ~20 h to run 2 on unverified dimensions feels rash, print **one
base + one lid**, assemble, and print the second set once it fits. Losing one
enclosure to a fit error is annoying; losing two is a schedule problem.

The stands are last on purpose: the device works flat, so they are the part you
can defer or skip if the printer is busy.

## After printing

1. **Test-fit before assembling anything.** Drop each module into its pocket dry.
2. If a pocket is tight, change `fit_pcb` in `params.scad` and reprint that
   part — **don't file it.** Filing loses the measurement for the second unit.
3. Drive each self-tapper in slowly the first time; printed threads cut best
   under steady pressure.
