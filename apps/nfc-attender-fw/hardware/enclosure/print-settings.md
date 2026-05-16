# Print Settings

Tested defaults for an FDM printer with a 0.4mm nozzle (Bambu P1S /
Prusa MK4 / Ender 3 class). Adjust for your printer.

## Bottom tray (`bottom_tray.stl`)

| Setting | Value | Why |
|---|---|---|
| Material | PLA | Cheap, stiff, dimensionally accurate. Stays inside, never touched. |
| Layer height | 0.2 mm | Default quality. |
| Wall loops | 3 | Matches the 2.4mm wall thickness (3 × 0.4mm × 2 sides). |
| Top/bottom layers | 5 | Solid base, no light bleed. |
| Infill | 15% gyroid | Plenty for a non-load-bearing case. |
| Supports | None (orient as designed) | Print "bottom-down" — the open top is the only overhang and it's the top of the print. |
| Brim | 5mm | Wide flat base benefits from a brim for adhesion. |
| Print time | ~3h | |

**Orientation:** place the bottom face flat on the build plate (the floor of
the tray is the largest flat surface). Open top faces up. No supports needed.

## Top lid (`top_lid.stl`)

| Setting | Value | Why |
|---|---|---|
| Material | PETG | Tougher than PLA; gets touched constantly during taps. |
| Layer height | 0.2 mm | |
| Wall loops | 3 | |
| Top/bottom layers | 5 | Smooth tap surface. |
| Infill | 20% gyroid | Sturdier — lid carries the impact of card taps. |
| Supports | **Yes** — tree supports, "snug" overhang threshold 45° | The angled bottom face of the lid needs support where the slope hangs over. |
| Brim | 8mm | Lid contact patch with the bed is small; brim helps. |
| Print time | ~3.5h | |

**Orientation:** lay the lid on its long edge with the angled tap face
pointing UP and slightly toward the user. The top tap surface should be the
LAST face the nozzle prints — this gives the cleanest finish on the surface
that gets seen and touched. If your slicer reports a poor first-layer area,
fall back to printing flat-side-down (the underside) with full supports on
the angled face — the trade-off is more support marks on the tap surface,
which you can sand.

## Heat-set inserts

After printing the bottom tray:

1. Set soldering iron to **200°C** (just above PLA glass transition; below
   for PETG).
2. Use the iron tip to press an M3 brass insert (knurled side down) into
   one of the four corner bosses. Apply gentle pressure straight down.
3. The insert sinks in over 5–10 seconds; stop when the top of the insert
   is flush with the boss top.
4. Quickly remove the iron and let the plastic cool — don't rock the iron
   sideways or the insert will end up crooked.
5. Repeat for the other three corners.

If you don't have inserts, an alternative is to print the bosses with
`insert_d = 2.8` (already self-tap-pilot diameter) and use M3 self-tapping
screws straight into the plastic. Less durable across repeated open/close
cycles but viable for v1.

## Tolerance tweaks

If parts don't fit on first print:

- **Lid skirt won't drop into tray opening:** reduce `lid_rim_drop` to 1.0
  in `enclosure.scad`, or increase tray opening by adjusting `wall` down
  0.1mm.
- **USB-C cable won't reach the connector through the back-wall cutout:**
  enlarge `usb_cutout_w` to 13 and `usb_cutout_h` to 8.
- **Switch / button hole too tight:** increase by 0.2–0.3mm.
- **PN532 doesn't read through the lid:** lower `nfc_window` to 1.2mm
  (3 layers @ 0.4mm) — minimum before the wall becomes structurally weak.
- **Perfboard wobbles on standoffs:** check that `pb_hole_inset` matches
  your actual perfboard's corner-hole positions. Common alternatives are
  2.5mm or 3.5mm inset.
