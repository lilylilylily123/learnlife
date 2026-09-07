# Continuous Integration

What GitHub Actions actually checks in this repo, what each check is defending
against, and — the part worth your time — the list of things it does **not**
check. The gaps are not accidents of neglect in every case; several are the
deliberate consequence of a path-filter design that keeps a C++ firmware change
out of a Node pipeline. But they are gaps, and knowing where they are is the
difference between trusting a green tick and over-trusting it.

Eight workflow files exist. Seven live in `.github/workflows/` and run in this
repository. The eighth, `apps/nfc-attender/.github/workflows/release.yml`, does
**not** run here — see [The app-local release workflow](#the-app-local-release-workflow).

For how to set up a machine and what to run before pushing, see
[`DEVELOPMENT.md`](DEVELOPMENT.md).

---

## Overview

| Workflow | Name | Trigger | Path filter | Jobs | What it proves |
|---|---|---|---|---|---|
| `calendar-test.yml` | Calendar: Test & Lint | push to `main`, PR to `main` | `apps/ll-calendar/**`, `packages/**`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package.json`, `tsconfig.base.json`, self | `test-and-lint` | Calendar app lints, the three shared packages typecheck, the calendar app typechecks, the attendance fixture is in sync, calendar jest suite passes |
| `nfc-test-build.yml` | NFC Attender: Test Build | push to `main`, push tag `v*`, PR to `main` | `apps/nfc-attender/**`, `packages/**`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package.json`, `tsconfig.base.json`, self | `test-and-lint`, `build` (macOS aarch64 + Windows) | Dashboard lints, packages typecheck, the attendance fixture is in sync, Vitest passes, and the Rust + Next bundle compiles on both shipped platforms |
| `nfc-fw.yml` | NFC Firmware: Test & Build | push to `main` or `hardware/**`, PR to `main` | `apps/nfc-attender-fw/**`, `packages/shared/fixtures/**`, self | `native-tests`, `firmware-build`, `enclosure` | Host-side unit tests pass — including the shared attendance fixture run against the C++ port — the ESP32 image links and fits its OTA slot, and every enclosure part still renders |
| `nfc-release.yml` | NFC Attender: Release | push tag `v*`, `workflow_dispatch` | none | `test`, `release` (macOS aarch64 + Windows) | A signed, bundled, published GitHub release for the desktop app, gated on lint + packages typecheck + fixture sync + Vitest |
| `pb-hooks-check.yml` | PocketBase Hooks: Syntax Check | push to `main`, PR to `main` | `pb_hooks/**`, self | `syntax` | Every `pb_hooks/*.pb.js` parses under `node --check`. A syntax error no longer reaches production undetected |
| `claude-code-review.yml` | Claude Code Review | PR `opened`, `synchronize`, `ready_for_review`, `reopened` | **none** | `claude-review` | An automated review comment on every PR — nothing about correctness |
| `claude.yml` | Claude Code | `issue_comment`, `pull_request_review_comment`, `issues` (opened/assigned), `pull_request_review` — each gated on the body containing `@claude` | none | `claude` | Nothing. On-demand assistant, not a check |
| `apps/nfc-attender/.github/workflows/release.yml` | Release Build | push tag `v*`, `workflow_dispatch` | none | `release` (macOS aarch64 + Windows) | Nothing in this repo — GitHub never reads it here |

Every workflow except `nfc-release.yml` and `claude*.yml` sets
`concurrency: cancel-in-progress: true` keyed on workflow + ref, so a force-push
kills the superseded run. `nfc-release.yml` sets `cancel-in-progress: false`
deliberately: cancelling half-way through publishing a release leaves a partial
set of assets attached to a tag, which is worse than a duplicate run.

---

## `nfc-fw.yml` — firmware and enclosure

The most interesting workflow in the repo, because each of its three jobs exists
to prevent a specific, expensive, already-experienced failure.

Job defaults set `working-directory: apps/nfc-attender-fw`, so every `run` step
is already inside the firmware project. Nothing here uses pnpm; that directory is
excluded from the workspace on purpose.

Its push trigger includes `hardware/**` branches as well as `main`, so hardware
work gets CI on every push without needing a PR open. The two TypeScript
workflows only push-trigger on `main`.

### `native-tests` — the pure-logic suite

```
actions/setup-python@v5 (3.12) -> cache ~/.platformio -> pip install platformio -> pio test -e native
```

**What it defends.** The attendance rules, the PocketBase request/response
codecs, the on-disk queue line format, JWT parsing and the roster format are all
decisions with edge cases — a midnight rollover, a truncated response, a
half-written queue line after a power cut. Those cases are hardest to provoke on
a device screwed shut on a wall. `platformio.ini`'s `native` environment
compiles the pure modules against the host stdlib with
`-DLLATTENDER_NATIVE_BUILD`, so they can be exercised in milliseconds on a
runner. 13 `test_*` directories, one of which now also drives the shared
attendance fixture against the C++ port — see
[The attendance fixture check](#the-attendance-fixture-check).

**What it cannot defend.** Everything excluded from `build_src_filter` —
anything that includes `Arduino.h`, touches WiFi, or writes LittleFS. Those files
are compiled by the `firmware-build` job and never executed anywhere in CI.

**The silent-failure trap.** `build_src_filter` and `test_filter` are explicit
allow-lists. A new pure module missing from both is not a failure; it simply does
not exist as far as CI is concerned — no compile, no run, green tick. The
`platformio.ini` comment says exactly this, and it is the single most likely way
for this job's coverage to quietly shrink.

The cache is keyed on `hashFiles('apps/nfc-attender-fw/platformio.ini')` and is
small, because the `native` env needs only a host compiler and ArduinoJson.

### `firmware-build` — the size gate

```
setup-python -> cache ~/.platformio -> pip install platformio -> pio run -e esp32dev -> size report -> upload artifact
```

**Why the size gate exists.** `hardware/partitions.csv` defines two app slots of
1536 KB (`0x180000`) each. Two, because OTA needs a slot to run from and a slot
to write into, and they must be equal. So the linker already fails on its own if
the image outgrows one slot — that is a hard wall, and hitting it at flash time
means you found out after you already decided to ship.

The size step is the early-warning trend line in front of that wall:

| Image size | Behaviour |
|---|---|
| < 85% of 1536 KB | Reports the percentage into `$GITHUB_STEP_SUMMARY` |
| ≥ 85% | `::warning::` annotation |
| ≥ 95% | `::error::` and the job fails |

Failing at 95% rather than 100% is the actual design decision: an OTA image is
usually slightly *larger* than the one it replaces, so a build that only just
fits leaves no room to update the fleet over the air. The margin is the OTA
budget.

`SLOT=1572864` is hardcoded in the workflow and must match `partitions.csv`. The
workflow says so in a comment, and the reason is sharp: a stale value here would
report a comfortable percentage while the real slot overflowed.

The artifact (`firmware.bin` + `firmware.elf`) is retained 14 days. Note there
is no firmware *release* channel — CI never publishes a firmware image to a
GitHub release, so an OTA image intended for a device in the field is built
locally.

`stat -c%s` is GNU coreutils syntax. It works on the Ubuntu runner and fails on
macOS, which matters only if you replay this step locally — see
[Reproducing CI locally](#reproducing-ci-locally).

### `enclosure` — headless OpenSCAD render

```
apt-get install openscad xvfb -> xvfb-run -a ./export.sh --check
```

Runs from `apps/nfc-attender-fw/hardware/enclosure` via a step-level
`working-directory` that overrides the job default.

**Why it exists.** A `.scad` file can stop parsing, reference a parameter that no
longer exists, or produce a non-manifold mesh. A non-manifold part slices into
garbage. Finding that out at the makerspace, with a booked printer and a drive
there, costs a booking; finding it out in a PR costs nothing. That is the whole
argument.

`--check` renders every part and writes nothing, which is what makes it CI-safe.

**The second gate inside `--check`.** It also fails when `stl/PARAMS.sha256`
disagrees with `params.scad` — i.e. when the committed STLs were exported from
different parameters than the ones now in the tree. Without it, a makerspace
handed `base.stl` could print a box sized for parameters nobody uses any more.

It is a *hash of the parameters*, not a mesh comparison, and `export.sh` explains
why: local machines run a 2026 OpenSCAD snapshot while this runner installs
Ubuntu's 2021.01 package, and binary STL output is not reproducible across them.
Hashing `params.scad` is version-independent and answers exactly the question
that matters — "were these STLs exported from these parameters?" The consequence
for a contributor is that **CI cannot regenerate `stl/` for you**: change
`params.scad`, run a full `./export.sh` locally, commit `stl/`.

`xvfb` is needed because OpenSCAD wants a display even when rendering headlessly.

---

## `nfc-test-build.yml` — desktop dashboard

Two jobs.

**`test-and-lint`** on `ubuntu-latest`: pnpm via `pnpm/action-setup@v4` with no
version input (so the root `packageManager: pnpm@10.33.0` decides), Node 22 with
pnpm cache, `pnpm install --frozen-lockfile`, then four checks:

| Step | Command | Covers |
|---|---|---|
| Lint | `pnpm --filter nfc-attender lint` | `apps/nfc-attender` only |
| Typecheck shared packages | `pnpm -r --filter "./packages/*" typecheck` | `pb-client`, `shared`, `design-tokens` |
| Check attendance fixture is in sync | `pnpm check:attendance-fixture` | That the committed fixture still matches the TypeScript spec |
| Test | `pnpm --filter nfc-attender test` | Vitest, jsdom, 13 test files under `src/__tests__/` (plus `setup.ts`) |

The typecheck step carries a comment explaining why it is here rather than
somewhere central: the shared packages define no `test` script, so their only
behavioural coverage is whatever the apps exercise transitively, and `tsc` is the
one check that reads all of them. It therefore runs in **both** TypeScript
workflows, and `packages/**` is in both of their path filters — coverage from
either side, whichever one a PR happens to trigger.

Note both workflows inline the raw command rather than calling the root
`pnpm typecheck` script. Identical expansion today; they can drift.

**`build`** on a matrix of `macos-latest` (`--target aarch64-apple-darwin`) and
`windows-latest`, `fail-fast: false`. Installs Rust stable via
`dtolnay/rust-toolchain@stable`, caches
`./apps/nfc-attender/src-tauri -> target` with `swatinem/rust-cache@v2`, then:

```bash
pnpm tauri build --no-bundle ${{ matrix.args }}   # working-directory: apps/nfc-attender
```

`--no-bundle` skips DMG/MSI packaging **and** the updater-artifact signing step,
which needs `TAURI_SIGNING_PRIVATE_KEY` — a secret set only for releases. So this
job proves the thing compiles on both shipped platforms without needing release
credentials on every PR. There is no Linux entry, matching the fact that the app
ships only for macOS and Windows.

Because `beforeBuildCommand` is `pnpm build`, this job also runs `next build`,
which is the only place in CI where the dashboard's own application TypeScript is
type-checked. Nothing in `next.config.ts` disables that.

---

## `calendar-test.yml` — calendar app

One job, `ubuntu-latest`, same pnpm/Node 22 setup, then:

| Step | Command |
|---|---|
| Lint | `pnpm --filter ll_calendar lint` (`expo lint`) |
| Typecheck shared packages | `pnpm -r --filter "./packages/*" typecheck` |
| Check attendance fixture is in sync | `pnpm check:attendance-fixture` |
| Typecheck calendar app | `pnpm --filter ll_calendar typecheck` (`tsc --noEmit`) |
| Test | `pnpm --filter ll_calendar test` (`TZ=UTC jest`) |

`TZ=UTC` comes from the app's own `test` script, not the workflow. It matters
because the calendar's date logic is boundary-sensitive and a runner in a
different zone would produce different results than a developer's laptop. The
fixture check sets `TZ=UTC` itself, in the root script.

There is no build job. The Expo app is never built for iOS, Android or web in
CI — no EAS step, no `expo export`, no native compile, even though the app now
defines a working `pnpm build`.

---

## `nfc-release.yml` — desktop release

Triggers on `push` of a `v*` tag, or manual `workflow_dispatch`. No path filter.

`test` job: pnpm, Node 22, `--frozen-lockfile`, then `pnpm --filter nfc-attender
lint`, the same `pnpm -r --filter "./packages/*" typecheck` step the two
TypeScript workflows run, and `pnpm --filter nfc-attender test`. The typecheck
step was added here after this document was first drafted, closing a gap where a
release could be cut while `packages/*` had type errors as long as the
dashboard's own lint and Vitest passed.

`release` job (`needs: test`, so a failing test blocks publication): matrix
macOS aarch64 + Windows, Rust stable, rust-cache, then `tauri-apps/tauri-action@v0`
with `projectPath: apps/nfc-attender`, `releaseDraft: false`,
`prerelease: false` — it publishes immediately, no manual gate. Environment:

| Secret | Purpose |
|---|---|
| `GITHUB_TOKEN` | Create the release and upload assets. Supplied by Actions |
| `TAURI_SIGNING_PRIVATE_KEY` | Sign the updater artifacts |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Unlock that key |

The matching public key is committed at
`apps/nfc-attender/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`, and the
updater endpoint is
`https://github.com/lilylilylily123/learnlife/releases/latest/download/latest.json`
— i.e. installed clients update from *this* repo's releases, which is what this
workflow produces.

`permissions: contents: write` on the release job only; the `test` job is
read-only.

**Tag overlap.** `nfc-test-build.yml` also lists `tags: - "v*"` under `push`,
alongside its `paths` filter. A `v*` tag therefore matches the trigger of both
workflows. **Not determinable from the repo:** whether `nfc-test-build.yml`'s
`paths` filter suppresses the tag run — GitHub evaluates ref and path filters
together, and a tag push has no obvious diff base. Check an actual tag's run list
if this matters to you.

---

## `pb-hooks-check.yml` — PocketBase hook syntax

```
actions/checkout@v5 -> setup-node@v5 (22) -> node --check pb_hooks/*.pb.js
```

One job, no `pnpm install`. `pb_hooks/` is outside the pnpm workspace and has no
`package.json`, so there are no dependencies to fetch and nothing for `pnpm -r`
to reach — which is exactly why the directory had no CI at all until this
workflow existed.

**What it proves.** That all three hook files parse as JavaScript. That is a
narrow claim, and it is deliberately the narrowest useful one: the files are
uploaded by hand through the PocketHost admin UI, PocketBase loads every
`.pb.js` in the directory into one JS VM, and **a syntax error in any one of
them takes hooks down for the whole instance** — including the `users` role-
escalation guard and the atomic invite-redemption route. Before this workflow
that was discoverable only in production, after a manual upload.

**What it does not prove.** Nothing about behaviour. `node --check` parses; it
does not execute, and it could not: the hooks call `$app`, `onRecordCreateRequest`
and `BadRequestError`, which exist only inside PocketBase's goja runtime. There
is no way to run them in CI without a PocketBase instance. So a hook that parses
but rejects every RSVP, or silently stops enforcing role constraints, still ships
green. The step also fails if the glob matches nothing, so renaming the directory
cannot turn the gate into a silent no-op.

Deployment remains manual and unverified — see
[`pb_hooks/README.md`](../pb_hooks/README.md#upload-procedure).

---

## The attendance fixture check

Not a workflow of its own — a step, `pnpm check:attendance-fixture`, that runs in
all three TypeScript workflows next to the `Typecheck shared packages` step.

`packages/shared/fixtures/attendance-state-machine.json` is committed and is the
source of truth for **two** test harnesses:

| Harness | Runs in |
|---|---|
| `apps/nfc-attender/src/__tests__/attendance-fixture.test.ts` (Vitest) | `nfc-test-build.yml`, `nfc-release.yml` |
| `apps/nfc-attender-fw/test/test_state_machine/` (PlatformIO `native`) | `nfc-fw.yml` |

Neither harness regenerates it. The check regenerates it in memory from the
TypeScript spec and exits 1 if the committed copy differs, naming the cases that
moved:

```
$ pnpm check:attendance-fixture
packages/shared/fixtures/attendance-state-machine.json is up to date (41 cases, 9 sweep cases).
```

**What it defends.** Changing `packages/shared/src/attendance.ts` and
re-baselining the fixture in the same commit would move the recorded C++
divergences silently — the fixture would still be internally consistent and both
suites would still be green, while the C++ port had drifted further from the
spec without anyone being told. The check makes the regeneration deliberate:
edit the spec and CI fails until you run `pnpm gen:attendance-fixture` and commit
the result.

**The chain this creates, which is the actual point.** Editing
`packages/shared/src/attendance.ts` matches `packages/**`, so a TypeScript
workflow runs and the fixture check fails as stale. Fixing that means
regenerating, which touches `packages/shared/fixtures/**` — now in `nfc-fw.yml`'s
path filter. So the firmware suite runs on the same commit, and the C++ port is
checked against the new spec. **A spec change can no longer land without the C++
side being exercised.** That closes the disjoint-filter gap described under
[the attendance implementations](#the-attendance-rule-is-now-partly-cross-checked).

**What it does not prove.** It compares the fixture against the spec. It does not
compare implementations, and it does not fail on divergence: the six recorded
divergences (`D1`–`D5`, including `D2a`) are all `"decision": "UNDECIDED"`, so
they are *pinned as expected behaviour*, not treated as failures. A green tick
means "the C++ port still diverges in exactly the six ways we wrote down", not
"the two agree".

---

## `claude.yml` and `claude-code-review.yml`

Neither is a correctness check. Both use `anthropics/claude-code-action@v1` with
`secrets.CLAUDE_CODE_OAUTH_TOKEN` and `actions/checkout@v5` at `fetch-depth: 1`.

**`claude.yml`** is on-demand. It fires on `issue_comment`,
`pull_request_review_comment`, `pull_request_review` and `issues`
(opened/assigned), and every one of those is gated by an `if:` requiring
`@claude` in the body (or the issue title). Without the mention, the job is
skipped. Permissions are read-only on content plus `id-token: write` and
`actions: read`, the latter noted in the file as letting it read CI results on a
PR. It has no `prompt`, so it follows the instructions in the comment that
mentioned it.

**`claude-code-review.yml`** runs on **every** pull request — `opened`,
`synchronize`, `ready_for_review`, `reopened` — with **no path filter**
(the `paths` block and the author `if:` filter are both present but commented
out). It loads the `code-review@claude-code-plugins` plugin from the
`anthropics/claude-code.git` marketplace and runs
`/code-review:code-review <repo>/pull/<number>`.

That absence of a path filter has one genuinely important consequence: **it is
the only automated feedback of any kind on a PR that touches only `pb_hooks/`,
`docs/`, `README.md` or `CLAUDE.md`.** An LLM review comment is not a test, but
for those paths it is all there is.

---

## Path-filter topology

Four workflows carry path filters, and together they partition the repo. The
partition is deliberate: the firmware has no use for a pnpm/Node/Rust pipeline,
and widening the desktop app's filter to reach it would drag it through one. The
comment at the top of `nfc-fw.yml` states exactly that reasoning — and the one
glob that now crosses the partition, `packages/shared/fixtures/**`, is narrow for
the same reason: it is the single file the C++ suite actually reads, not
`packages/**`.

| Change touches | `calendar-test` | `nfc-test-build` | `nfc-fw` | `pb-hooks-check` | `claude-code-review` (PRs) |
|---|---|---|---|---|---|
| `apps/ll-calendar/**` | yes | – | – | – | yes |
| `apps/nfc-attender/**` | – | yes | – | – | yes |
| `apps/nfc-attender-fw/**` | – | – | yes | – | yes |
| `packages/**` (except the fixture) | yes | yes | – | – | yes |
| `packages/shared/fixtures/**` | yes | yes | **yes** | – | yes |
| `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package.json`, `tsconfig.base.json` | yes | yes | – | – | yes |
| `pb_hooks/**` | – | – | – | yes | yes |
| `docs/**` | – | – | – | – | yes |
| `README.md`, `CLAUDE.md`, `.gitignore`, `package-lock.json` | – | – | – | – | yes |
| `.github/workflows/claude*.yml`, `nfc-release.yml` | – | – | – | – | yes |

### The `-fw` suffix is the whole trick

`nfc-test-build.yml` filters on `apps/nfc-attender/**`. GitHub matches that glob
against the full path, and it requires the literal segment boundary
`apps/nfc-attender/` — so it does **not** match `apps/nfc-attender-fw/anything`.
The firmware was invisible to CI until `nfc-fw.yml` was added, and it stays
outside the desktop pipeline by that one character.

The mirror consequence used to be the important one: a firmware-only change ran
only `nfc-fw.yml`, and a `packages/`-only change never ran `nfc-fw.yml`, so the
two sides of the attendance rule never met. That is now **partly** closed. The
shared fixture is in both filter sets, so a commit that touches it starts both
the TypeScript and the firmware suites. And because editing the spec makes the
committed fixture stale — which the TypeScript workflows fail on — regenerating
it is forced, and regenerating touches the fixture path. See
[the attendance implementations](#the-attendance-rule-is-now-partly-cross-checked).

A firmware-only change still runs only `nfc-fw.yml`, which is correct: it cannot
affect the TypeScript spec.

### Paths no workflow covers

Comparing the filters against `git ls-files`, these tracked paths trigger no test
or build workflow at all:

| Path | Files | Why it matters |
|---|---|---|
| `tsconfig.base.json` | 1 | Now covered: added to the path filters of both TypeScript workflows, so editing it re-runs the only check the shared packages have |
| `docs/**` | this file, `DEVELOPMENT.md`, `MONOREPO_ARCHITECTURE.md`, `RSVP_MIGRATION.md`, `POCKETBASE.md`, `SECURITY.md` | Docs only; no link checker exists |
| `README.md`, `CLAUDE.md` | 2 | Docs only |
| `package-lock.json` | 1 | Vestigial npm lockfile, contradicts `package.json` engines, read by nothing |
| `.gitignore` | 1 | Harmless |
| `.github/workflows/claude.yml`, `claude-code-review.yml`, `nfc-release.yml` | 3 | The other workflows list themselves in their own `paths`; these three do not, so editing a release or Claude workflow runs no verification |

`pb_hooks/**` used to head this list. It now has
[`pb-hooks-check.yml`](#pb-hooks-checkyml--pocketbase-hook-syntax), which parses
every hook file. That is a real gate against the failure mode that takes the
whole JS VM down, but it is only a parse: the hooks are server-side JavaScript
running in PocketBase's own VM on PocketHost — the layer that re-enforces the
`users` collection's role constraints — and nothing in CI executes them or
verifies the manual upload. **A hook *logic* regression is still discoverable
only in production.**

### Paths covered more heavily than they need to be

Two are worth knowing about because they cost runner minutes:

- `apps/nfc-attender/docs/**`, `apps/nfc-attender/README.md` and
  `apps/nfc-attender/README_SCHEDULER.md` all match `apps/nfc-attender/**`, so a
  documentation-only change to the dashboard triggers the full matrix — a macOS
  and a Windows Tauri compile.
- `apps/ll-calendar/stitch/*` (design mocks) and `apps/ll-calendar/.full-review/*`
  (review notes) match `apps/ll-calendar/**` and run the whole calendar job.

---

## What CI does **not** cover

The honest map. Every item below was checked against the tree.

### TypeScript is only partly typechecked

`tsc` ran nowhere until the `Typecheck shared packages` step was added to both
`calendar-test.yml` and `nfc-test-build.yml`. Even now it covers
`packages/*` only:

| Target | Typechecked in CI? | By what |
|---|---|---|
| `packages/pb-client`, `packages/shared`, `packages/design-tokens` | yes | `tsc --noEmit`, in both TS workflows |
| `apps/nfc-attender` app code | yes, indirectly | `next build`, inside the macOS/Windows `build` job only — never on the ubuntu job |
| `apps/ll-calendar` app code | **no** | Nothing. It has no `typecheck` script, `expo lint` is ESLint, and its jest transform sets `diagnostics: false` so ts-jest ignores type errors too |
| `nfc-release.yml`'s pre-release check | yes, for `packages/*` | Runs the same typecheck step as the two TS workflows |

### No Rust tests exist, so the card-reading path is compile-checked only

No workflow runs `cargo test`. That is not an omission with a fix waiting: a
grep for `#[test]`, `#[cfg(test)]` and `#[tokio::test]` across
`apps/nfc-attender/src-tauri/src/` returns nothing. There is no Rust test to run.

What that leaves unverified is specific. `src-tauri/src/main.rs` (127 lines) owns
the entire PC/SC integration — `get_uid()` sends the `FF CA 00 00 00` APDU and
hex-encodes the response, and `start_nfc_listener()` spawns the thread that polls
reader state, debounces card-present transitions and emits the `nfc-scanned`
Tauri event the React layer listens for. All of it is checked for *compiling* on
macOS and Windows by the `build` job, and for nothing else. A regression in UID
extraction or in the card-present debounce is caught by a human with a card, or
not at all.

`apps/nfc-attender/tools/enroll` is a second Rust crate (`nfc-enroll`, also
depending on `pcsc = "2.9.0"`). It sits under `apps/nfc-attender/**`, so it
triggers `nfc-test-build.yml` — but no job in that workflow compiles it.
`pnpm tauri build` builds `src-tauri` only. **The enroll CLI is never built by
CI.**

### `pb_hooks/` is parsed, never executed

Covered above under [Paths no workflow covers](#paths-no-workflow-covers).
Restated here because it belongs on this list: `pb-hooks-check.yml` proves the
three files parse, which is enough to stop a syntax error taking down the whole
JS VM. It proves nothing about the authorisation logic those files contain, and
deployment is still a manual upload nothing verifies.

### The attendance rule is now partly cross-checked

This item used to read "nothing compares the three attendance implementations".
That is no longer accurate, but the correction is narrower than it sounds. The
rule exists **four** times, and the shared fixture harnesses **two** of them:

| Implementation | File | Runs against the fixture? |
|---|---|---|
| Canonical TypeScript — the spec | `packages/shared/src/attendance.ts` | **Yes**, via `attendance-fixture.test.ts` (Vitest) |
| C++ port | `apps/nfc-attender-fw/src/state_machine.cpp` | **Yes**, via the PlatformIO `native` suite |
| Hand-duplicated `deriveStatus` | `packages/pb-client/src/queries/attendance.ts` | **No** — listed in the fixture's `implementations`, harnessed by nothing |
| Hand-duplicated `splitStatus` | `packages/pb-client/scripts/backfill-arrival.ts` | **No** — same |

**What is now genuinely covered.** `packages/shared/fixtures/attendance-state-machine.json`
is committed, and both the Vitest and the C++ suites read that same file — so the
spec and the C++ port are compared against one shared set of 41 cases (plus 9
sweep cases). The disjoint-filter problem is closed too: the fixture path is in
`nfc-fw.yml`'s filter as well as both TypeScript workflows', and
`pnpm check:attendance-fixture` fails when the committed fixture no longer matches
the spec. Editing the spec therefore forces a regeneration, and the regeneration
touches the path that starts the firmware suite. A spec change can no longer land
without the C++ side running on the same commit. See
[The attendance fixture check](#the-attendance-fixture-check).

**What is still not covered, and matters most.** The fixture *records* divergence
rather than forbidding it. All six entries in its `divergences` block — `D1`
through `D5`, including the masked `D2a` — carry `"decision": "UNDECIDED"`, and
both harnesses assert the divergent behaviour as expected. So:

- A green tick means **"the C++ port still diverges in exactly the six recorded
  ways"**, not "the two agree". Those six include real production-visible
  behaviour: `D1`, a one-minute window at 16:59 where the dashboard checks a
  learner out and the reader refuses the tap; `D2`, a learner who never returned
  from lunch being checked out on one path and left checked in on the other; and
  `D3`, an afternoon no-scan window that exists only on the device.
- `D4` records that `findLearnersToMarkAbsent` was never ported at all, so the
  sweep cases run against the spec only and the device can never mark anyone
  absent.
- The two `pb-client` duplicates remain enforced by comment alone. The
  `MUST STAY IN SYNC WITH packages/shared/src/attendance.ts:deriveStatus` banner
  explains the duplication exists to avoid a package cycle — `shared` imports
  `TIME_THRESHOLDS` from `pb-client`, so `pb-client` importing `shared` would
  close the loop — and instructs the author to change both. **Nothing enforces
  that.** A fixture case cannot catch it, because no harness calls those copies.

So the honest summary is: two of four implementations are now pinned against one
shared fixture and cannot drift silently, six known divergences between them are
documented and frozen rather than fixed, and the other two implementations are
still on the honour system.

### The calendar `.tsx` collection trap is closed

`apps/ll-calendar/package.json` used to set `testMatch: ["**/__tests__/**/*.test.ts"]`
— `.ts` only — so adding `__tests__/whatever.test.tsx` produced no failure and no
warning: jest simply did not collect it and the workflow reported green on a
suite that never ran the file. It now reads:

```json
"testMatch": [
  "**/__tests__/**/*.test.ts",
  "**/__tests__/**/*.test.tsx"
]
```

Both extensions are collected. `apps/ll-calendar/__tests__/` holds three files
today (`calendar-utils.test.ts`, `rsvp-errors.test.ts`,
`expand-events-start-boundary.test.ts`).

What remains true is the layer below: the `ts-jest` transform still sets
`"diagnostics": false`, so a type error never surfaces during a test run.
`pnpm --filter ll_calendar typecheck` is now a separate step in
`calendar-test.yml` and is the only thing that reads the app's own types.

The dashboard never had this problem: `apps/nfc-attender/vitest.config.ts` sets
no `include`, so Vitest's default picks up `.tsx`, and 3 of its 13 test files
are `.tsx`.

### The Expo app is never built

`calendar-test.yml` has no build job. No `expo export`, no EAS build, no iOS or
Android compile anywhere in CI. The app does now define `pnpm build`
(`expo export --platform web`, verified working), but no workflow runs it, so a
change that lints, typechecks and passes its tests can still fail to bundle.

### `packages/*` are never linted

None of the three defines a `lint` script, so `pnpm -r lint` skips them
silently: `pnpm -r` only fails when *no* selected package has the script, and
the two apps do have it. The workflows use `--filter nfc-attender` /
`--filter ll_calendar` anyway, so even the recursive form is not in play. ESLint
has never seen `packages/*/src/**`.

### Firmware hardware paths are compiled, never executed

Everything wrapped against `LLATTENDER_NATIVE_BUILD` and excluded from
`build_src_filter` — `nfc.cpp`, `ui.cpp`, `queue.cpp`, `roster.cpp`,
`line_store.cpp`, `ota.cpp`, `config.cpp`, `time_sync.cpp`, `buzzer.cpp`,
`pb_client.cpp`, `main.cpp` — is compiled by `firmware-build` and run only on
real hardware. That split is intentional and well argued in
`src/line_store.h`: LittleFS only exists on the device, so the branching logic
lives in pure modules and the filesystem is a thin adapter. It still means the
adapters themselves are untested.

### Committed STLs are never verified against their sources

The `enclosure` job proves the `.scad` sources render and that `PARAMS.sha256`
matches `params.scad`. It does not compare `stl/*.stl` to a fresh render, and
`export.sh` explains why that comparison is the wrong test across two OpenSCAD
versions. The parameter hash is a proxy: it catches "exported from different
parameters", not "exported from different geometry code". A change to
`lib/shapes.scad` that alters geometry without touching `params.scad` passes the
gate with stale STLs committed.

### No firmware release channel

`nfc-fw.yml` uploads `firmware.bin`/`firmware.elf` as a 14-day artifact. Nothing
publishes a firmware release, and nothing produces an OTA-ready image for
devices in the field. That path is entirely local.

### No security or dependency automation

Six workflow files, and none of them is a dependency audit, a CodeQL scan, a
secret scan, a license check or a `pnpm audit`. `docs/SECURITY.md` exists as a
document; nothing enforces it. See [`SECURITY.md`](SECURITY.md).

---

## Reproducing CI locally

Each job, step for step. Directories matter.

| CI job | Local equivalent | Run from |
|---|---|---|
| `calendar-test.yml` → `test-and-lint` | `pnpm install --frozen-lockfile` · `pnpm --filter ll_calendar lint` · `pnpm -r --filter "./packages/*" typecheck` · `pnpm --filter ll_calendar test` | repo root |
| `nfc-test-build.yml` → `test-and-lint` | `pnpm install --frozen-lockfile` · `pnpm --filter nfc-attender lint` · `pnpm -r --filter "./packages/*" typecheck` · `pnpm --filter nfc-attender test` | repo root |
| `nfc-test-build.yml` → `build` | `pnpm tauri build --no-bundle` (add `--target aarch64-apple-darwin` on Apple Silicon to match the macOS leg) | `apps/nfc-attender/` |
| `nfc-fw.yml` → `native-tests` | `pio test -e native` | `apps/nfc-attender-fw/` |
| `nfc-fw.yml` → `firmware-build` | `pio run -e esp32dev`, then the size check below | `apps/nfc-attender-fw/` |
| `nfc-fw.yml` → `enclosure` | `./export.sh --check` (no `xvfb-run` needed on a machine with a display) | `apps/nfc-attender-fw/hardware/enclosure/` |
| `nfc-release.yml` → `test` | `pnpm --filter nfc-attender lint` · `pnpm --filter nfc-attender test` | repo root |
| `nfc-release.yml` → `release` | Not reproducible locally without the signing key. `pnpm build:nfc` produces an unsigned bundle | repo root |
| `claude*.yml` | Not reproducible; requires the Actions event payload and the OAuth token | – |

The size gate replayed by hand. The workflow uses GNU `stat -c%s`, which fails on
macOS, so use the portable form:

```bash
# from apps/nfc-attender-fw
SIZE=$(wc -c < .pio/build/esp32dev/firmware.bin)
SLOT=1572864                      # must match app0/app1 in hardware/partitions.csv
echo "$(( SIZE * 100 / SLOT ))% of the app slot"
```

Warn at 85, fail at 95, same as CI.

Also worth knowing when comparing a local run to a CI run:

- CI runs Node **22** and pnpm **10.33.0** (from `packageManager`); nothing pins
  your local Node.
- CI uses `--frozen-lockfile`. Locally, plain `pnpm install` will happily update
  the lockfile and hide a mismatch CI would reject.
- CI's OpenSCAD is Ubuntu's 2021.01; a local Homebrew snapshot is a 2026 build.
  Renders agree; binary STL bytes do not.
- Nothing in the pnpm world reaches `apps/nfc-attender-fw`, and nothing in the
  `pio` world reaches the rest of the repo. You must run both halves.

---

## The app-local release workflow

`apps/nfc-attender/.github/workflows/release.yml` — name `Release Build`,
triggers on `v*` tags and `workflow_dispatch`.

**Does it run from this monorepo? No.** GitHub Actions only reads workflow
definitions from `.github/workflows/` at the *repository root*. A `.github`
directory nested at `apps/nfc-attender/` is just files as far as this repo's
Actions are concerned — it is never registered, never triggered.

**Where it does run.** The root `package.json` publishes the app to a standalone
repository by subtree:

```
push:nfc -> git subtree push --prefix=apps/nfc-attender nfc-attender main
```

After that push, `apps/nfc-attender/.github/workflows/release.yml` lands at
`.github/workflows/release.yml` in the standalone repo, where it *is* at the
root, and where it therefore does run. So the file lives at this path precisely
because subtree rewrites the prefix away.

**It is a stale near-duplicate of `nfc-release.yml`, and the drift is
substantive.** Verified differences:

| | root `nfc-release.yml` | app-local `release.yml` |
|---|---|---|
| Jobs | `test` (lint + Vitest) then `release` | `release` only — **no test gate at all** |
| `actions/checkout` | `@v5`, checks out the triggering ref | `@v4`, explicitly `repository: lilylilylily123/learnlife`, `ref: main` |
| pnpm setup | no `version` input → uses `packageManager: pnpm@10.33.0` | `version: 9` |
| Node | `node-version: 22` | `node-version: lts/*` |
| Install | `pnpm install --frozen-lockfile` | `pnpm install` |
| `actions/setup-node` | `@v5` | `@v4` |

Two of those are outright breakage risks, both derived from manifests in this
repo rather than guessed:

1. **It ignores the tag it was triggered by.** The checkout step pins
   `repository: lilylilylily123/learnlife`, `ref: main`. So a `v1.2.3` tag in the
   standalone repo builds whatever the monorepo's `main` happens to be at that
   moment, and publishes it under that tag's name. The tag is a label, not a
   source of truth.
2. **The pinned pnpm cannot read the lockfile.** `pnpm-lock.yaml` is
   `lockfileVersion: '9.0'`, written by pnpm 10; `version: 9` in this workflow
   asks for pnpm 9, which does not understand it. The root `package.json` also
   declares `packageManager: pnpm@10.33.0`, so this workflow simultaneously
   requests two different major versions. [INFERENCE] The run either errors on
   the conflicting version request or installs pnpm 9 and then fails on the
   lockfile; the exact failure cannot be observed from this repo, because this
   workflow does not execute here.

**Not verifiable from the repo:** whether the standalone `nfc-attender` repo
still exists, whether the subtree remotes are configured on any machine, and
whether this workflow has been run recently or successfully. Nothing in the
tracked tree records the remote URLs — `src-tauri/Cargo.toml` names
`https://github.com/lilylilylily123/nfc-attender` as the crate's `repository`
field, which is consistent with the `nfc-attender` remote name, but that is
inference, not configuration.

Treat this file as dead weight in the monorepo. If the standalone repo is still
live, it needs the same drift fixes as its root counterpart; if it is not, the
file should go.

---

## Related documents

- [`DEVELOPMENT.md`](DEVELOPMENT.md) — machine setup, root scripts, the local
  pre-push sequence
- [`MONOREPO_ARCHITECTURE.md`](MONOREPO_ARCHITECTURE.md) — package
  responsibilities and data flows
- [`SECURITY.md`](SECURITY.md) — security posture (not enforced by any workflow)
- [`POCKETBASE.md`](POCKETBASE.md) — the backend schema and rules the untested
  `pb_hooks/` operate on
- [`../pb_hooks/README.md`](../pb_hooks/README.md) — the hooks with no CI, and
  the collection rules they depend on
- [`../apps/nfc-attender-fw/README.md`](../apps/nfc-attender-fw/README.md) —
  firmware, partitions, OTA
- [`../apps/nfc-attender-fw/docs/TESTING.md`](../apps/nfc-attender-fw/docs/TESTING.md)
  — what the 134 native cases cover and how the pure/impure split is drawn
- [`../apps/nfc-attender-fw/hardware/enclosure/README.md`](../apps/nfc-attender-fw/hardware/enclosure/README.md)
  — enclosure parts and the export/print workflow
- [`../apps/nfc-attender/docs/AUTO_UPDATER_GUIDE.md`](../apps/nfc-attender/docs/AUTO_UPDATER_GUIDE.md)
  — updater signing keys
