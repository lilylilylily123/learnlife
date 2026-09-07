# `@learnlife/design-tokens`

The LearnLife visual vocabulary as plain TypeScript constants: colour, type,
spacing, radius, shadow. No CSS, no styled-components, no React Native
`StyleSheet` — just frozen objects, so the same numbers can be handed to a
Tailwind theme, a React Native `StyleSheet`, or an inline style without a build
step or a runtime.

The palette is "Paper": warm cream paper, deep warm ink, muted sage accent,
rust for warnings, and a calmed-down lime kept as a nod to the earlier
identity. The type system is editorial — a high-contrast serif for display, a
humanist sans for body, a mono for labels.

> [!IMPORTANT]
> **This package is currently a partial single source of truth.** One of the two
> apps imports it; the other re-declares the same palette independently. Two of
> the five token modules are imported by nothing. Read
> [Who actually consumes this](#who-actually-consumes-this) before assuming a
> change here reaches the product.

| Field | Value |
|---|---|
| Package name | `@learnlife/design-tokens` |
| Entry point | `src/index.ts` (source — consumers bundle the TS directly) |
| Runtime deps | none |
| Own test script | **none**; no tests exist and none are warranted — see [How this package is checked](#how-this-package-is-checked) |

## Layout

| File | Exports |
|---|---|
| `src/colors.ts` | `colorsLight`, `colorsDark`, `colors`, types `ColorTokens`, `ColorKey` |
| `src/typography.ts` | `fontFamilies`, `fontWeights`, `typeScale`, types `TypeScaleEntry`, `TypeScaleKey` |
| `src/spacing.ts` | `spacing`, type `SpacingKey` |
| `src/radius.ts` | `radius`, type `RadiusKey` |
| `src/shadow.ts` | `shadow`, type `ShadowKey` |
| `src/index.ts` | all of the above, plus the aggregate `tokens` and type `Tokens` |

## Install / run

Nothing to build. Consumers reference the workspace package:

```jsonc
// apps/*/package.json
"@learnlife/design-tokens": "workspace:*"
```

The only command this package has, run from the repo root:

```bash
pnpm --filter @learnlife/design-tokens typecheck   # tsc --noEmit
```

Import either the individual modules or the aggregate:

```ts
import { colorsLight, spacing, radius } from "@learnlife/design-tokens";
import { tokens } from "@learnlife/design-tokens"; // { colors, fontFamilies, fontWeights, typeScale, spacing, radius, shadow }
```

Every object is `as const`, so keys are literal-typed and the `*Key` types are
usable as prop types (`radius: RadiusKey`).

---

## `colors.ts`

Two complete palettes with identical key sets — `colorsLight` and `colorsDark`
— plus `colors = { light, dark }` for theme switching. `ColorTokens` is
`typeof colorsLight`, so **the dark palette is only type-checked against the
light one indirectly**: a key added to light but missing from dark is a
`ColorTokens` mismatch wherever `colors.dark` is used as `ColorTokens`, but
nothing in this package asserts the two are structurally identical.

| Token | Light | Dark | Role |
|---|---|---|---|
| `bg` | `#F3EEE5` | `#16130E` | Page background — warm cream |
| `surface` | `#FBF8F2` | `#201C15` | Cards, lighter paper |
| `surface2` | `#EAE3D3` | `#2A2519` | Panels, selected rows, input backgrounds |
| `ink` | `#1F1B16` | `#F0E9D8` | Primary text — warm near-black, never pure `#000` |
| `ink2` | `#3A342A` | `#CBC2AC` | Secondary text |
| `muted` | `#807663` | `#8A8170` | Tertiary text, captions |
| `divider` | `#D9D1BF` | `#3A3426` | 1px rules |
| `accent` | `#4F6B4A` | `#A8C09E` | Primary action — muted sage |
| `accentInk` | `#F3EEE5` | `#16130E` | Text/icon on `accent` |
| `lime` | `#C4D98B` | `#DCEC9C` | Heritage highlight |
| `limeInk` | `#1F1B16` | `#16130E` | Text on `lime` |
| `warm` | `#C26B3C` | `#E08652` | Alerts, urgent, rust |
| `warmInk` | `#FBF8F2` | `#16130E` | Text on `warm` |
| `lavender` | `#4F6B4A` | `#A8C09E` | **Alias for `accent`** — see below |
| `lavenderInk` | `#F3EEE5` | `#16130E` | **Alias for `accentInk`** |

The `*Ink` pairing is the useful convention here: every background token that
can carry text ships with its own foreground, so contrast is decided once in
this file rather than re-guessed at each call site.

**`lavender` / `lavenderInk` are legacy aliases, not colours.** The palette
used to be lavender-accented; the swap to sage would have been a
find-and-replace across both apps, so the old names were pointed at the new
values instead. They resolve to exactly `accent` / `accentInk` in both themes.
Use `accent` in new code. They cannot be removed without auditing every
consumer, and they are load-bearing only in the sense that deleting them breaks
whatever still references them.

## `typography.ts`

`fontFamilies` — full CSS font stacks, ordered fallback-first-after-primary:

| Token | Stack |
|---|---|
| `display` | `'Fraunces', 'DM Serif Display', Georgia, 'Times New Roman', serif` |
| `body` | `'Inter Tight', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` |
| `mono` | `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` |

The file's own comment states the intent: on mobile these names map to
expo-font aliases, on web they are passed to `font-family` directly via the
Google Fonts stack. **Not verifiable from the repo — no consumer imports
`fontFamilies`, so neither half of that claim is currently exercised anywhere.**
See [Who actually consumes this](#who-actually-consumes-this).

`fontWeights`: `regular: 400`, `medium: 500`, `semibold: 600`, `bold: 700`.

`typeScale` — eight named steps. `size` is in px/dp, `tracking` is an em
multiplier (negative = tighter), `lineHeight` is a unitless multiple of size:

| Step | Family | Size | Weight | Tracking | Line height | Notes |
|---|---|---|---|---|---|---|
| `display` | display | 56 | 600 | −0.02 | 1.0 | Hero only |
| `h1` | display | 34 | 600 | −0.02 | 1.05 | |
| `h2` | display | 26 | 600 | −0.015 | 1.1 | |
| `h3` | display | 20 | 600 | −0.01 | 1.15 | |
| `body` | body | 16 | 400 | 0 | 1.5 | |
| `bodySmall` | body | 14 | 500 | 0 | 1.5 | Weight steps **up** as size drops — 14px at 400 reads thin on the cream background |
| `caption` | body | 12 | 500 | 0 | 1.4 | |
| `kicker` | mono | 11 | 700 | +0.05 | 1.2 | `uppercase: true` — the only step that sets it |

Two patterns run through the scale, and they are what makes it look designed
rather than generated: **negative tracking tightens as size grows** (display
sizes need it, body does not), and **weight increases as size decreases** so
small text keeps its presence.

`typeScale` is declared `as const satisfies Record<string, TypeScaleEntry>`.
The `satisfies` is doing real work: it validates every entry against
`TypeScaleEntry` — including that `family` is one of the three and `weight` is
one of the four — while `as const` preserves the literal types, so
`typeScale.h1.size` is `34`, not `number`. A plain type annotation would have
widened all of it.

## `spacing.ts`

A single scale, in px/dp. Not a geometric progression — it is 4-based at the
bottom where fine control matters and opens up at the top:

| Token | `none` | `xs` | `sm` | `md` | `lg` | `xl` | `2xl` | `3xl` | `4xl` | `5xl` | `6xl` |
|---|---|---|---|---|---|---|---|---|---|---|---|
| px | 0 | 4 | 8 | 12 | 16 | 20 | 24 | 32 | 40 | 48 | 60 |

`none: 0` exists so a conditional style can pick a token rather than falling
back to a bare `0` and losing the type.

## `radius.ts`

| Token | `sm` | `md` | `lg` | `pill` |
|---|---|---|---|---|
| px | 10 | 16 | 24 | 9999 |

`pill: 9999` is the standard "fully rounded regardless of height" idiom — it
works in both CSS `border-radius` and React Native `borderRadius`, where a
percentage-based approach does not behave the same across platforms.

## `shadow.ts`

Two elevations, each shipping **both** a CSS string and a React Native style
object, because the two platforms express shadows in incompatible ways and a
single value cannot serve both:

| Token | `css` | React Native (`rn`) |
|---|---|---|
| `card` | `0 2px 10px rgba(45, 27, 78, 0.06)` | `shadowColor: "#2D1B4E"`, offset `(0, 2)`, opacity `0.06`, radius `10`, `elevation: 2` |
| `pop` | `0 4px 20px rgba(45, 27, 78, 0.12)` | `shadowColor: "#2D1B4E"`, offset `(0, 4)`, opacity `0.12`, radius `20`, `elevation: 6` |

`elevation` is Android-only and is the one value with no CSS analogue, which is
the specific reason the two representations are stored rather than derived.

The design intent, from the file's own comment: **subtle only — prefer a 1px
`divider` over a heavy drop shadow.** Both opacities are under 0.13.

`#2D1B4E` is a desaturated purple, a leftover from the pre-Paper palette. It is
not a colour token and does not appear in `colors.ts`. At 6–12% opacity over
cream it reads as a neutral warm-cool shadow rather than as purple, so it was
left alone — but it is the one hard-coded colour in the package.

---

## Who actually consumes this

Verified by searching `apps/` for `@learnlife/design-tokens` and for the
palette hex values.

### `apps/ll-calendar` — imports it

Declared in `apps/ll-calendar/package.json` (`workspace:*`) and mapped for jest
(`moduleNameMapper` → `packages/design-tokens/src/index.ts`). Exactly one file
imports it: **`apps/ll-calendar/constants/theme.ts`**, which is an adapter, not
a pass-through.

| Imported | Used for |
|---|---|
| `colorsLight` | Every entry in the legacy flat `Colors` map, and `T.colors.light` |
| `colorsDark` | `T.colors.dark` only |
| `radius`, `spacing`, `shadow` | Re-exported verbatim as `T.radius` / `T.spacing` / `T.shadow` |

`theme.ts` exists because the app already had a flat `Colors` + `Fonts` API
across many screens. Rather than rewrite them, it maps token names onto the old
semantic names (`Colors.purple` → `colorsLight.ink`, `Colors.lavender` →
`colorsLight.accent`) and adds a richer `T` object for new work. Three values
in `Colors` are **hard-coded and not tokens at all**: `limeDark: "#A8BE6E"`,
`limeSubtle: "#E2ECC5"`, and `mutedLight: "rgba(128,118,99,0.25)"` — the last
being `muted` at 25% alpha, written out because the package has no alpha
helper.

`theme.ts` does **not** import `fontFamilies` or `typeScale`. It builds its own
`Fonts` via `Platform.select`, using system serifs on iOS/Android (`ui-serif`,
`serif`) to get an editorial feel with zero font loading, and a full
Fraunces/Inter Tight/JetBrains Mono stack only on web. Those web strings are
near-duplicates of `fontFamilies` but not identical.

Only light mode is live: `Colors` is entirely `colorsLight`, and
`export const c = T.colors.light`. `T.colors.dark` is exposed but nothing
selects it.

### `apps/nfc-attender` — does not import it

The dashboard **does not depend on this package**. It is not in
`apps/nfc-attender/package.json`, and no file under `apps/nfc-attender/`
references `@learnlife/design-tokens`.

It instead re-declares the same palette as CSS custom properties in
`apps/nfc-attender/src/app/globals.css`, then exposes them to Tailwind v4 via
`@theme inline` as `--color-ll-*` utilities:

```css
:root {
  --ll-bg: #f3eee5;
  --ll-accent: #4f6b4a;
  /* … 13 in total */
}
```

**All 13 light-mode values are byte-identical to `colorsLight`** (modulo hex
case), which is what makes this dangerous rather than merely redundant: the two
files agree today, so nothing looks wrong, and a colour changed in one will
silently not change in the other. The CSS omits the `lavender` aliases and has
no dark palette. Fonts come from `next/font/google` in
`apps/nfc-attender/src/app/layout.tsx` (Fraunces → `--font-heading`, Inter
Tight → `--font-body`, JetBrains Mono → `--font-mono`), which matches
`fontFamilies`' primary faces without importing them.

**Not verifiable from the repo:** whether the dashboard was deliberately kept
independent — a Tailwind v4 `@theme` block wants CSS variables, and there is no
generator here that emits CSS from these TS constants — or whether the token
package simply postdates it. Either way, a palette change today requires
editing both files.

### Nothing consumes

| Export | Status |
|---|---|
| `colors` (the `{ light, dark }` aggregate) | unused — `ll-calendar` imports `colorsLight` / `colorsDark` directly |
| `fontFamilies` | **unused by any app** |
| `fontWeights` | **unused by any app** |
| `typeScale` | **unused by any app** |
| `tokens` / `Tokens` | **unused by any app** |
| `ColorTokens`, `ColorKey`, `TypeScaleEntry`, `TypeScaleKey`, `SpacingKey`, `RadiusKey`, `ShadowKey` | unused as annotations anywhere in `apps/` |

The whole of `typography.ts` is therefore aspirational: it is a well-specified
type scale that no screen renders. `apps/nfc-attender-fw` has an OLED display
and no relationship to any of this.

## How to add a token

1. Add it to the relevant `src/*.ts` module. Colours **must** be added to
   **both** `colorsLight` and `colorsDark`; `ColorTokens` is derived from the
   light palette, so a light-only addition typechecks here and then fails at
   whichever consumer reads `colors.dark` as `ColorTokens`.
2. If it is a background that can carry text, add its `*Ink` foreground in the
   same commit. That pairing is the convention the palette relies on.
3. If it is a shadow, supply both `css` and `rn` — including Android
   `elevation`, which has no CSS equivalent and cannot be derived.
4. No barrel edit is needed for a new key inside an existing object. A new
   *module* must be added to `src/index.ts` twice: once in the `export { … }`
   block and once in the `tokens` aggregate object.
5. `pnpm --filter @learnlife/design-tokens typecheck` from the repo root.
6. **Then propagate by hand.** A new colour does not reach `apps/ll-calendar`
   until `constants/theme.ts` maps it, and does not reach `apps/nfc-attender`
   at all until it is added to `src/app/globals.css` and its `@theme inline`
   block. There is no generator and no check that the two palettes agree.

Do not add a token for a one-off value. Three such values already live inline
in `apps/ll-calendar/constants/theme.ts`, and that is the right place for them
until a second screen needs the same thing.

## How this package is checked

> [!WARNING]
> **This package defines no `test` script.** `pnpm test` at the repo root runs
> `pnpm -r test`, which finds test scripts in `apps/nfc-attender` and
> `apps/ll-calendar` only. `packages/design-tokens` is never invoked by it.

| Check | Command (from repo root) | Covers |
|---|---|---|
| Types | `pnpm typecheck` → `pnpm -r --filter "./packages/*" typecheck` | The only check that targets this package. Runs in CI in both `.github/workflows/calendar-test.yml` and `.github/workflows/nfc-test-build.yml`. |

There are no behavioural tests and none are warranted — the package contains no
logic, only frozen literals. The `as const satisfies Record<string,
TypeScaleEntry>` on `typeScale` is the only correctness constraint in the
package, and `tsc` enforces it.

What is **not** checked, and would be worth checking if this drifts again:
`colorsLight` and `colorsDark` having identical key sets, and the palette in
`apps/nfc-attender/src/app/globals.css` matching `colorsLight`. Both are
currently maintained by hand.

## Related

- [`apps/ll-calendar/README.md`](../../apps/ll-calendar/README.md) — the only consumer
- [`apps/nfc-attender/README.md`](../../apps/nfc-attender/README.md) — the app that re-declares the palette in CSS
- [`docs/MONOREPO_ARCHITECTURE.md`](../../docs/MONOREPO_ARCHITECTURE.md)
- [`docs/GLOSSARY.md`](../../docs/GLOSSARY.md)
