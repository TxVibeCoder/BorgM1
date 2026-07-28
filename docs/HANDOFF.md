# Handoff — start here

*Written 2026-07-28, at the end of Phase 5. Paste this to a fresh session, or read it yourself
after a break.*

---

You are picking up **BorgM1**, a browser emulator of the Korg M1 (1988) PCM workstation.
Developed on Windows with PowerShell; paths below are relative to the repository root.

**Phases 0–5 are done. It plays, it edits, it has its effects, and it is a workstation.** Your
job is **Phase 6 — Browser + factory bank**. Do Phase 6 only.

## Read first, in this order

1. `CLAUDE.md` — the non-negotiable conventions. Short. All of it applies.
2. `docs/PLAN.md` — the eight-phase plan with live status. **Phase 6 is your spec.**
3. `docs/DECISIONS.md` — dated log of what was decided and why. Read Phases 0–5 before
   proposing anything that contradicts them; several look like obvious improvements and are not.
4. `docs/UI-SPEC.md` — the layout spec. **§6b is the browser, and it is yours.**
5. `docs/BRIEF.md` — **only the "Watch out for" section.**

`README.md` has the code map and the command table.

## Get it running before you change anything

```bash
npm install && npm run build:bank && npm run dev
```

Open <http://localhost:5184>, press **POWER**, wait for `BANK OK`, and play the keybed. Then
press **COMBI** in the header, set the type to `SPLIT`, and check that the bottom half of the
keyboard sounds different from the top. If you cannot hear it working, do not start editing it.

`npm run build:bank` needs **FluidR3_GM.sf2** (MIT, 141 MB, deliberately not vendored),
resolved from `$BORGM1_SF2`, then `assets/`, then a sibling checkout. If it resolves from a
sibling, treat that copy as **read-only — never modify it.**

## What Phase 6 is

The instrument becomes usable: **decode Korg's preload and import 100 programs and 100
combinations**, then build the browser modal from UI-SPEC §6b.

### The decoders are already written and already validated

This is the unusual part of Phase 6 — most of the hard work is done and tested:

- **`decodeProgram`** (`data/programParams.ts`) was written in Phase 3 and round-trips.
- **`decodeEffects`** (`data/effectParams.ts`) round-trips **91/100** factory blocks
  byte-exactly, with the residue understood and documented.
- **`decodeCombi`** (`data/combiParams.ts`) round-trips **100/100** factory combinations
  byte-exactly across bytes 10..123.

So the import is mostly plumbing: unpack the SysEx, walk the records, hand them to three
functions that already work. **Programs are 100 × 143 bytes at offset 13261; combinations are
100 × 124 at 861** — and `861 + 100×124 = 13261` exactly, which is a free check that both are
right.

### The one seam you actually have to replace

`engineBridge.programParamsFor(ref)` is the **Phase 5 stand-in** for the program bank. A
Combination timbre stores a pointer (`I00`..`C99`), and until the bank exists a slot that is
not the edit buffer materialises as the INIT program with its multisound set to the slot
number. It is labelled as a stand-in in the code and in `DECISIONS.md`. **Replace that one
method with a lookup into the imported bank and eight timbres become eight real programs.**
The resolver is injected into `buildCombiTimbres` precisely so this costs a line.

Keep the rule the stand-in already implements: **the edit buffer wins over the bank for its own
slot**, because a Combination timbre plays the program as currently edited.

### The parts of the browser that matter

- **Live faceting** — any INSTRUMENTS tag that would return zero results greys out and becomes
  unselectable. This is what makes the grid self-teaching.
- **Two 4×4 tag grids**, with CHARACTER's row-2 slots 3–4 swapping with the COMBI/PROG tab.
- **`APPLY` applies without closing** — the audition-and-keep-browsing button.
- **Horizontal card paging**, 5×10 = 50 per page = exactly one card's capacity.
- **Blue accent, not lime.** Lime is editing, blue is browsing. `ACCENT.browse` already exists.
- **No text search.** A deliberate omission, not an oversight — don't "improve" it.

> **Gate:** the Phase 4 fidelity test now runs from the *decoded bank* rather than by hand.
> Add `I01 Piano 16'` and `I00 Universe` as the second and third checks.

**`PresetPicker` is NOT this browser.** It is the user-setup save/load surface, built and tested
since Phase 0 and still unwired. Don't rewrite it and don't confuse the two.

## What Phase 5 left you

- **`data/combiParams.ts`** — the 124-byte record: five types, eight timbres of eleven bytes,
  the 14-position panpot, and the two polarity traps documented together.
- **`src/engine/program/combiConfigCore.ts`** — the seam. Five types resolve to one list of
  timbres with effective windows; the engine then applies one rule.
- **`voiceEngineCore` is multi-timbre.** `setTimbres()`, `noteOn(note, vel, channel)`,
  `renderBuses(a, b, c, d, count)`. `setProgram()` still exists as a one-timbre shim, so Phase
  2's byte-exact golden buffers are untouched.
- **The effect matrix is complete.** `EffectChain.processBuses` takes all four buses, and
  Output 3/4 Pan fold outputs 3 and 4 into the stereo pair.
- **A Combination has its own effect section**, and the store's effect methods resolve by mode —
  so the FX panel serves both without knowing which it is looking at.
- **The 8-row timbre strip**, with the layout audit that keeps it honest.

## The tests that matter most, and why

- **`test/unit/combiConfig.test.ts` — the audibility sweep.** Every combination field set live,
  change ONE, require the render to differ. It caught two probe weaknesses immediately (no
  sustain pedal, and controllers that could not reach half the timbres). **Extend the same
  pattern to anything Phase 6 adds** — it has now earned its keep in three consecutive phases.
- **`test/unit/panelLayout.test.ts`** — asserts every parameter is on some page, every FX
  algorithm fits its box, and every piece of a timbre row fits the row. Extend it to the
  browser: 50 cards in a 5×10 grid is a size claim that should be checked, not assumed.
- **`test/e2e/layoutAudit.spec.ts` — the rendered-page audit.** Playwright at 1900×1030,
  walking every `<text>` pair AND every labelled control for overlaps. It found three real bugs
  this phase, one of which made a header button unclickable. **A modal over the panel is a new
  z-order; run this against it.**
- **`npm run probe:combis`** — validates the table against Korg's bank and skips cleanly when
  the payload is absent. It is the template for anything Phase 6 needs to check.

## How to work

- **One branch per phase.** `git checkout -b phase-6-browser`, merge with `--no-ff`.
- **Append to `docs/DECISIONS.md`, dated**, whenever you make a call a later session would
  otherwise re-derive. Highest-value habit in the project.
- **Label the guesses**, next to the existing labelled ones rather than buried.
- **Verification floor:** `npm test`, `npm run typecheck`, `npm run build`, `npm run build:bank`
  all clean, plus `npx playwright test`, plus Phase 6's own gate.
- **Then drive the app and measure it.** Every phase so far has had at least one bug that lived
  in the seam between correct components, where unit tests are blind.

## Traps that will bite you specifically

- **READ THE IMAGES, NOT THE OCR.** Still true. `docs/RESEARCH-INDEX.md` has a table of which
  image holds which table.
- **CHECK THE SPEC AGAINST THE FACTORY BANK.** This has now paid off in two consecutive phases,
  and in Phase 5 it caught something worse than an ambiguity: **TABLE 6's footnote `*14` reads
  as a byte offset and is not one.** Every other cell in that table is an offset. Taking it
  literally would have put every factory SPLIT's split point at E0. The data said otherwise in
  one run of the probe.
- **A weak metric will give you a confidently wrong answer.** FIVE phases, five times, recorded
  each time. Phase 5's was a peak-bin pitch read that reported 260.7 Hz and 785.2 Hz — the 1st
  and 3rd harmonics — for two notes an octave apart. **What worked was changing the detector,
  not refining it:** L/R balance, with one timbre hard to bus A and the other hard to bus B, so
  "which timbre sounded" became a channel amplitude that no harmonic can imitate.
- **PLAN.md is not always right about the details it warns you of.** Its "MIDI filter polarity
  is INVERTED" warning is real but points at the wrong field. Phase 4 found four such
  corrections in its own gate patch. Trust the plan for scope, the manual for structure, and
  the factory bank for facts.
- **Extensions default OFF and must heal to OFF.** Still true, still pinned by test.
- **A width-fitted SVG's height comes from its viewBox aspect, not its container.** The browser
  modal is a full-window overlay; this is exactly where that bites.
- **Don't re-litigate the panpot law.** It was settled by measurement — a sum-preserving law
  made a SINGLE combination exactly 6 dB quieter than the same program in Program mode, and the
  manual says Program mode *is* 5:5. The reasoning is in `DECISIONS.md` and in `panpotGains`.

## Deployment, and the trap in it

`main` auto-deploys to **<https://txvibecoder.github.io/BorgM1/>** via
`.github/workflows/deploy.yml`.

**The runner builds the sample bank as well as the app, and it has to.** `public/bank/` is
50 MiB of generated output and is gitignored, so the first deploy shipped a page that rendered
the whole panel perfectly and then failed on POWER with `BANK ERROR` — a completely silent
instrument that looked fine. CI installs `fluid-soundfont-gm` from apt (FluidR3_GM is MIT and
Debian packages it, so there is no third-party mirror to rot), points `BORGM1_SF2` at it, and
runs `npm run build:bank` before `npm run build`. A final step asserts `dist/bank/` exists.

**If you change anything about the bank or the build, check the deployed page, not just
localhost.** The failure mode is invisible until someone presses POWER, and `npm run dev`
never exercises it because your local `public/bank/` is already populated.

Each visitor downloads 50 MiB once, cached by the Cache API afterwards. Pages' soft bandwidth
limit is 100 GB/month, so that is roughly 2,000 cold loads — fine, but worth knowing before
linking it anywhere busy.

## Environment friction, already paid for

- **PowerShell mangles this project's prose.** `Set-Content` turns em dashes into mojibake. Use
  the Edit tool for docs, and `git commit -F <file>` for commit messages.
- **Never `git stash` to test a revert.** It reverts the whole working tree.
- **.NET file APIs do not follow `Set-Location`.** Pass absolute paths, or prefer Read/Edit/Write.
- **The launcher must keep CRLF.** `.gitattributes` pins `*.cmd`/`*.bat`; don't relax it.
- **The bank is cached by the Cache API.** After `npm run build:bank`, clear it in the console
  before re-testing: `for (const k of await caches.keys()) await caches.delete(k)` then reload.
- **Port 5184 is `strictPort`.** Playwright's config has `reuseExistingServer: true`, so it will
  attach to a dev server that is already up rather than fighting it.
- **Vite's HMR wipes anything you attached to `window` from the console.** If a measurement rig
  stops answering mid-session, re-install it; nothing is broken.
- **Dev-only handles at `window.__borgm1` and `window.__borgm1store`** (stripped from production
  builds). Phase 5 added: `setMode`, `setCombiParam`, `previewCombiParam`, `setCombiParams`,
  `setCombiType`, `setTimbreSolo`, `setEffectOutPan`, and `noteOn`/`noteOff` now take a channel.
  Attach an `AnalyserNode` to `outputNode` and measure — that is how Phases 2–5 were verified.
- **If the in-app browser pane is hidden, its screenshots and synthetic clicks fail.** Its
  `javascript_tool` still works, which is enough to drive and measure the engine. For real
  pixels use the project's own Playwright.

## Do not

- **Do not modify SynthStack**, the sibling repo this was forked from. Read-only.
- **Do not commit the bank** (`public/bank/`, generated and gitignored) or the SF2.
- **Do not add runtime audio or UI libraries.** Build-time and test-only deps are fine.
- **Do not put a PRNG in the signal path.** Its absence is what makes byte-exact golden-buffer
  tests possible.
- **Do not rewrite `PresetPicker` or the MIDI bend/mod-wheel decode.** Both are built and
  tested and merely unwired.
- **Do not re-litigate settled decisions** without reading the reasoning.

## Where things stand

1070 unit tests, a 4-test Playwright layout audit, typecheck, build and bank build all clean.
The bank builds to 50 MiB / 480 samples / 594 key zones, 100 multisounds and 44 drums, 451/451
loop seams within limit.

Known and deliberate: **39 multisounds and 12 drums are approximated** from the nearest GM
timbre and flagged `approx`; **DRUMS mode plays one drum per key** with unassigned keys silent,
and the four selectable Drum Kits are still unbuilt; **per-timbre IFX is visibly inert** and
labelled an unimplemented extension; **a timbre panned to C/D is silent when Output 3/4 Pan are
OFF**, which is the hardware.

**Three open questions carried forward:**

1. **The Phase 4 listening A/B was never done** — it needs the Robin S recording. Everything
   measurable was measured (RT60 3.61 s against a 3.5 s setting, stereo correlation −0.06). If
   the sound is wrong, `DECISIONS.md` names the two constants to move first.
2. **Negative VDF cutoff tracking is still unresolved**, from Phase 3. Nothing in Phases 4 or 5
   exercised it.
3. **`TIMBRE.INST` (byte+4 bit 7) is an unidentified bit**, carried verbatim. The drum-kit
   hypothesis is refuted by the factory bank — 2 of 800 timbres set it, zero overlap with the
   11 that point at a drum program. Phase 6 will decode those two programs properly and may be
   able to settle it.
