# NFC Attender — hardware

Build guide for the desk unit. **Two devices**, solderless assembly, printed
enclosure.

- [`partitions.csv`](partitions.csv) — flash layout. Read the warnings before reflashing a deployed unit.
- [`enclosure/`](enclosure/) — parametric OpenSCAD case, test prints, caliper worksheet.

---

## Bill of materials

Per device, unless noted.

### Core

| Part | Qty | Notes |
|---|---|---|
| ESP32-WROOM-32 DevKit V1, **30-pin**, USB-C | 1 | ELEGOO. **30-pin, not 38** — count 15 pins per side |
| **30-pin** screw-terminal breakout | 1 | e.g. MRD068A. Must match 30-pin *and* your board's row pitch |
| PN532 V3 NFC module | 1 | DIP switches to I²C: 1=ON, 2=OFF |
| SSD1306 0.96" OLED, I²C | 1 | 128×64, address `0x3C` |
| Piezo buzzer | 1 | Passive, driven by `tone()` |
| 5 V ≥1 A USB supply + quality USB-C cable | 1 | A weak supply shows up as `brownout` in the boot log |

**Order a spare PN532.** Some vendors ship the pin header loose in the bag
rather than soldered. Check the moment it arrives — if it's unsoldered, ask the
makerspace to run the four joints. **Do not press-fit it.** An intermittent I²C
line produces bugs you will chase for days.

### Wiring and fixings

| Part | Qty | Notes |
|---|---|---|
| Female-to-female dupont jumpers | ~10 | Cut in half and strip; see below |
| M3 self-tapping screws, 12 mm | 4 | Lid |
| M2.5/M3 self-tappers, 6 mm | 4 | PN532 posts |
| Stick-on rubber feet, 8 mm | 4 | Under the stand |
| Zip ties | 2 | Strain relief |
| PETG filament | ~150 g | PLA is fine indoors away from a window |

### Tools

Calipers · wire strippers · small screwdrivers · **no soldering iron required**

---

## Why a screw-terminal breakout

The DevKit exposes one 3V3 pin, and each header pin accepts exactly one dupont
housing — so two peripherals cannot share power and I²C off it directly.
Something has to fan those nets out.

A mini breadboard was the first answer and it was the wrong one. Breadboard
contacts are spring clips built for temporary prototyping: not rated for
permanent installation, prone to going intermittent under vibration, and
higher-resistance than a clamped joint. An intermittent I²C line in a device
tapped a few hundred times a day is the worst available failure mode — it
doesn't fail cleanly, it works for a week and then returns one garbage read.

The breakout fixes that with no soldering. The DevKit plugs into its headers,
every GPIO comes out on a screw clamp that cannot vibrate loose, and the board
has mounting holes — which conveniently removes the "does this DevKit clone
even have mounting holes?" problem.

**Honest limit:** this secures the ESP32 end of every wire, not both. The
peripheral end is still a dupont housing on a header pin, which is what the
printed retainer bar addresses. A soldered perfboard remains strictly more
robust; `hardware/production-enclosure-v1` has that design if it ever becomes
worth the iron and the hours.

---

## Wiring

Cut female-to-female dupont jumpers in half and strip the cut end. Bare wire
into the screw terminal, surviving female end onto the module's header pin.

| From | Terminal | Side |
|---|---|---|
| PN532 VCC **+** OLED VCC | `3V3` | right, bottom |
| PN532 SDA **+** OLED SDA | `D21` | right, 5th down |
| PN532 SCL **+** OLED SCL | `D22` | right, 2nd down |
| PN532 GND **+** OLED GND | `GND` | right, 2nd from bottom |
| Buzzer − | `GND` | left, 2nd from bottom |
| Buzzer + | `D25` | left, 8th down |

**Three terminals take two wires each** (3V3, D21, D22). Two 24 AWG conductors
is ~0.4 mm² into a terminal rated near 1.5 mm² — unremarkable, and standard for
signal wiring. **Twist the stripped ends together before inserting** so the
screw clamps both evenly.

GND is the easy one: the board has a terminal on *each* side, so the buzzer
gets its own and the two I²C modules share the other. Nothing triples up.

> **Why not one pin each?** I²C is a shared bus — devices are distinguished by
> address (PN532 `0x24`, SSD1306 `0x3C`), not by pin. They're *supposed* to sit
> on the same two wires. If a third device ever joins (a DS3231), three wires
> per terminal gets tight; that's when Wago 221-415 lever nuts earn their place
> (`include_wago_bay` in `enclosure/params.scad`).

No level shifters needed — both modules are 3.3 V native with onboard I²C
pull-ups.

**Power budget at 5 V:** ESP32 ~120 mA average / ~500 mA TX peak, PN532
~50–150 mA, OLED ~20 mA, buzzer ~30 mA. Comfortably inside 1 A.

---

## Assembly runbook

Do these in order. Steps 1–2 come **before** dismantling anything.

### 1. Record the working bench rig

Photograph the wiring from three angles and fill in the table in
[`enclosure/docs/measurements.md §8`](enclosure/docs/measurements.md). You will
not remember which pin the buzzer lead was in.

Verify against the firmware, which hardcodes these: `src/nfc.cpp` (SDA 21 /
SCL 22) and `src/buzzer.cpp` (GPIO 25).

### 2. Measure every module

Calipers, into the worksheet, then into `enclosure/params.scad`. Clone
dimensions vary by 2–5 mm between vendors and are the single most likely reason
a first print doesn't fit.

Three that get botched most often:
- **PN532 coil centre** — not the board centre. It's what the TAP CARD label
  must sit above.
- **OLED glass offset** — the glass is *not* centred on its PCB.
- **DevKit pin-row pitch** — decides whether the breakout physically seats.

### 3. Print the test pieces

`coupon.stl` — it sets five tolerance parameters and is the only test print
the enclosure actually depends on. `antenna_tiles.stl` is an **optional
diagnostic**: the stacked layout already puts the card 3.8 mm from the coil,
and deleting the lid pocket entirely only reaches 5.8 mm, so print it only if
read range disappoints once assembled. Both are described in
[`enclosure/README.md`](enclosure/README.md). Neither needs measurements.

### 4. Bench-test the new module set

Before anything goes near the enclosure. A DOA PN532 discovered after assembly
costs an hour of disassembly.

### 5. Flash over USB

```bash
pio run -e esp32dev -t upload
pio device monitor
```

**This is the only chance to apply the partition table without opening the box
again.** Confirm the boot log shows `[fs] LittleFS mounted`,
`[ui] SSD1306 init ok`, `[nfc] PN532 firmware …`, and a sane reset reason. A
`brownout` here means the supply or cable is inadequate.

### 6. Mount

Breakout board onto its floor posts → PN532 onto its four tall posts → OLED
into the front-wall pocket → buzzer into its chimney.

### 7. Wire and dress

Per the table above. **Keep wires clear of the antenna footprint** — a
conductive path close and parallel to the coil detunes it. Fit the dupont
retainer collars (`enclosure/stl/retainer.stl`) — push one over each
peripheral's four housings so they lift as a block, not one at a time.

### 8. Provision

Power on → join `LL-Attender-XXXX` using the password **shown on the OLED** →
fill in the form → **write down the OTA hostname and password on the
confirmation page.** That is the only time they are displayed.

### 9. Verify end-to-end

Tap a card → correct name and verdict → check the row in the dashboard.

Then the real test: **pull the WiFi, tap three cards, confirm "3 waiting to
send", pull the power, repower, confirm the queue survived, restore WiFi,
confirm all three land in PocketBase.**

### 10. Close up

Four screws → cable into the external clamp (`enclosure/stl/clamp.stl`), zip
tie through the two back-wall slots and over the clamp → seat in the stand →
feet → label the box.

### 11. Register the device

Record in your own notes: device id, PocketBase account, physical location,
firmware version, OTA password.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `brownout` in the boot log | Supply, cable or DevKit can't hold the 3V3 rail. Check where it dies: after `[wifi] radio up` means TX peaks, so suspect the supply and cable; *between* `[wifi] powering radio` and `[wifi] radio up` it failed on the RF front-end powering up — only ~100 mA, before any frame is sent — which a healthy board survives on any USB port. Strip to a bare DevKit; if it still trips there, swap the DevKit |
| Every card reads "Unknown card" | Roster never fetched — check `r` on the console |
| "Waiting for clock" persists | NTP blocked. Check UDP/123 isn't firewalled |
| Cards read intermittently | Loose dupont at the peripheral end, or metal near the coil |
| Read range poor through the lid | `lid_t` too thick, or a PCB too close to the antenna |
| `[nfc] PN532 not found on I2C bus` | Read the `[i2c]` scan printed just above it — it runs every boot, before the PN532 is probed. `0x24` missing while other addresses are listed → PN532 DIP switches not at 1=ON/2=OFF, or its own dupont pair / press-fit header. `no devices` → the shared SDA/SCL/3V3/GND run, but note it also reads `no devices` when nothing at all is plugged in |
| No `[nfc]` line at all in the boot log | Device is unprovisioned — `config::run_provisioning()` blocks in the captive portal and reboots before `nfc::init()` runs. The `[i2c]` scan and pullup probe still run first, so the bus is diagnosable without finishing setup |
| `[i2c] line pullups: ... ABSENT` + `open circuit` | Nothing powered on that line. A press-fit or unsoldered PN532 header kills all four connections at once and is the single most likely cause — see the warning above. Also check the VCC jumper is in `3V3` not `VIN`, and that cut-and-stripped dupont wires aren't broken inside the insulation |
| `[i2c] line pullups: ... HELD LOW` | Not an open circuit — something is dragging the line to ground. Reversed VCC/GND at the module, or a bent pin bridging a neighbour |
| `pullups: SDA=present SCL=present` **but** `[i2c] no devices` | The module is powered and both lines reach it — nothing is broken electrically, so it is answering on a different interface. The PN532 latches its DIP switches at **its own** power-up, not at ESP32 reset, so flipping them and pressing reset (or pulsing DTR/RTS from a serial tool) changes nothing: the chip is still in SPI or HSU mode. **Unplug the USB cable and plug it back in** so the module's 3V3 actually drops, then re-scan. If `0x24` still doesn't appear after a true power cycle, SDA and SCL are swapped |
| `[ui] SSD1306 not found` | I²C wiring, or the OLED is at `0x3D` not `0x3C` |
| OTA "no password provisioned" | Re-provision (type `RESET` at boot) to generate one |
| Queue climbing, never draining | Check `q` for dead letters; check the device account still has role `lg` |
