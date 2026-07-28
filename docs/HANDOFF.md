# Handoff — start here

*Written 2026-07-28, at the end of Phase 4. Paste this to a fresh session, or read it yourself
after a break.*

---

You are picking up **BorgM1**, a browser emulator of the Korg M1 (1988) PCM workstation.
Directory: `<repo root>`. Windows, PowerShell.

**Phases 0–4 are done. It plays, it edits, and it has its effects — in stereo.** Your job is
**Phase 5 — Combinations**. Do Phase 5 only; do not start Phase 6.

## Read first, in this order

1. `CLAUDE.md` — the non-negotiable conventions. Short. All of it applies.
2. `docs/PLAN.md` — the eight-phase plan with live status. **Phase 5 is your spec.**
3. `docs/DECISIONS.md` — dated log of what was decided and why. Read Phases 0–4 before
   proposing anything that contradicts them; several look like obvious improvements and are not.
4. `docs/UI-SPEC.md` — the layout spec. §3's **left column** is the 8-row timbre strip you are
   about to build; §6b is the browser, which is Phase 6's, not yours.
5. `docs/BRIEF.md` — **only the "Watch out for" section.**

`README.md` has the code map and the command table.

## Get it running before you change anything

```bash
npm install && npm run build:bank && npm run dev
```

Open <http://localhost:5184>, press **POWER**, wait for `BANK OK`, and play the keybed. Turn a
`CUTOFF` knob and hear it change; open the **FX** tab, step effect 1 to `STEREO CHORUS 1` and
hear it go wide. If you cannot hear it working, do not start editing it.

`npm run build:bank` needs **FluidR3_GM.sf2** (MIT, 141 MB, deliberately not vendored),
resolved from `$BORGM1_SF2`, then `assets/`, then `<sibling soundfont dir>/`. The
third is a sibling project — **read-only, never modify it.**

## What Phase 5 is

The workstation layer: **five Combination types**, eight timbres, and the panpot that finally
makes the effect matrix's other half reachable.

### The allocator already models exactly what you need

`voiceAllocCore` is 16 oscillator SLOTS with atomic DOUBLE claims and per-slot channel, and it
already keys note-off and sustain by channel. "No per-program limit, but never more than 16
total" therefore needs **no new mechanism** — eight timbres pointed at the same `allocate`.
Nothing is reserved and nothing is protected; that is the hardware. Authentic detail worth
keeping: the metronome costs a slot.

### The four things PLAN.md says that are easy to skim past

- **Five types, not one with a mode flag.** `SINGLE`, `LAYER`, `SPLIT`, `VELOCITY SWITCH`,
  `MULTI`. Only MULTI exposes the 8-timbre matrix; the other four have their own edit pages
  **and their own SysEx offsets**. They are not UI subsets of MULTI.
- **MIDI filter polarity is INVERTED** — OFF means receive, ON means block.
- **Windows are independent and additive.** Any timbre whose key window, velocity window and
  channel all match will sound. `coalesceTimbre` already ORDERS an inverted window rather than
  trusting it (an inverted window silences a timbre with no visible cause).
- **The panpot is the routing, and Phase 4 built the thing it routes into.** A timbre's
  14-position panpot (`A`, 9:1…1:9, `B`, `C`, `C+D`, `D`) is what feeds buses C/D — which is
  what makes PARALLEL mean anything. A Program cannot reach effect 2 in parallel and the FX
  panel says so; a Combination can, and that is the point.

### Your spec, and the warning that comes with it

The **124-byte Combination table is TABLE 2 on Owner's Manual p.128** (`pg/p128.png`), with
its page/position→offset cross-check as **TABLE 6 on `pages/b131.png`** — note `pg/` stops at
p130, so that one is only in `pages/`. `preload/final.py` decodes 100 combinations at offset
861.

**READ THE IMAGES, NOT THE OCR.** Every table in the MIDI appendix is multi-column and the OCR
interleaves the columns. Phase 3 wasted a search on it; Phase 4 did not repeat the mistake.
`docs/RESEARCH-INDEX.md` has a table of exactly which image holds which table.

**And do what Phase 4 did next: CHECK the spec against the factory bank.** p.129 left three
questions genuinely ambiguous and Korg's own 100 programs settled all three — including one
where two decoders in the research payload contradict each other and the more-finished-looking
one was wrong. `npm run probe:effects` is the template; `scripts/probeEffects.ts` is ~150 lines
and skips cleanly when the payload is absent. Expect p.128 to have its own ambiguities and plan
to histogram them, not to argue about them.

## What Phase 4 left you

- **`data/effectParams.ts`** — the 25-byte block, 33 algorithms, their grids, defaults and the
  pairing rule, with `encodeEffects`/`decodeEffects`. Round-trips 91/100 factory blocks
  byte-exactly; the residue is two understood causes, both documented.
- **`src/engine/dsp/fx/`** — nine DSP blocks plus `effectChainCore`, the two-slot matrix. All
  pure, all Node-tested.
- **The engine is stereo.** `EffectChain` runs in the worklet downstream of `VoiceEngine`,
  which still sums to mono on purpose — that is where the M1's stereo image comes from.
- **`program.effects`** lives in the state tree beside `program.params`, kept out of the params
  bag because a slot's parameter set depends on which algorithm it holds.
- **A RECORD button** in the header (WAV lossless or WEBM), so you can capture what you build.

## The tests that matter most, and why

- **`test/unit/effectDsp.test.ts` — the audibility sweep.** For all 33 algorithms: set every
  parameter live, change ONE, require the render to differ. It is the only test that catches a
  parameter which exists in the table and never reaches the DSP. **Extend the same pattern to
  the Combination fields** — it is the cheapest insurance in the project, and it has now caught
  dead parameters in two consecutive phases.
- **`test/unit/panelLayout.test.ts`** — asserts every parameter is on some page, and that every
  FX algorithm FITS its box. Extend it to the timbre strip.
- **A rendered-page audit, not just unit tests.** Phase 4's layout was "green" while text
  printed over text in six places. The audit that found it walks every `<text>` pair's
  bounding boxes at a real window size and fails any overlap; it went dozens → 0. Rebuild it
  (~80 lines of Playwright around `getBoundingClientRect`) before you call the timbre strip
  done — **eight rows of controls is exactly the density that breaks this way.**

## How to work

- **One branch per phase.** `git checkout -b phase-5-combinations`, merge with `--no-ff`.
- **Append to `docs/DECISIONS.md`, dated**, whenever you make a call a later session would
  otherwise re-derive. Highest-value habit in the project.
- **Label the guesses**, next to the existing labelled ones rather than buried.
- **Verification floor:** `npm test`, `npm run typecheck`, `npm run build`, `npm run build:bank`
  all clean, plus Phase 5's own gate.
- **Then drive the app and measure it.** Every phase so far has had at least one bug that lived
  in the seam between correct components, where unit tests are blind.

## Traps that will bite you specifically

- **A weak metric will give you a confidently wrong answer.** This has now happened in FOUR
  phases and is recorded each time. Phase 4's pitch probe read note 60 an octave low, because
  `Organ2` is a drawbar registration whose loudest partial is the 16' drawbar. **Prefer a
  measurement where a known bias cancels — compare two readings through the same detector and
  claim only the ratio.**
- **Grid-snapping bugs hide from every test that constructs data directly.** Phase 4 shipped a
  snapper that rewrote `PHASE '180'` to `'0'` — inverting every `I` variant — and 900 tests
  missed it because only the UI path went through the snapper. Setting up a patch in the
  running app found it in seconds. **Assert the general form** (round-tripping is identity and
  idempotent for every field), not the instance you happened to notice.
- **`ManualsLib 819462` is the 2006 SOFTWARE PLUGIN manual, not the hardware one.** Use Korg's
  own CDN PDF or ManualsLib **898710**. The Super Guide is pre-release marketing and loses to
  the Owner's Manual.
- **Extensions default OFF and must heal to OFF.** Still true, still pinned by test.
- **A width-fitted SVG's height comes from its viewBox aspect, not its container.** That is how
  the keybed ended up three times the height of its band. Eight timbre rows are a stack of
  aspect-ratio decisions; check them at a real window size.

## Environment friction, already paid for

- **PowerShell mangles this project's prose.** `Set-Content` turned every em dash in a test
  file into mojibake this session. Use the Edit tool for docs, and `git commit -F <file>` for
  commit messages — a multi-line `-m` shreds itself into pathspec errors.
- **Never `git stash` to test a revert.** It reverts the whole working tree, not the one file
  you meant. Mutate the single line with an editor instead.
- **.NET file APIs do not follow `Set-Location`.** Pass absolute paths, or prefer Read/Edit/Write.
- **The launcher must keep CRLF.** `.gitattributes` pins `*.cmd`/`*.bat`; don't relax it.
- **The bank is cached by the Cache API.** After `npm run build:bank`, clear it in the console
  before re-testing: `for (const k of await caches.keys()) await caches.delete(k)` then reload.
- **Port 5184 is `strictPort`** — a stale dev server fails loudly rather than drifting. Kill it.
- **Dev-only handles at `window.__borgm1` and `window.__borgm1store`** (stripped from production
  builds): `noteOn`, `noteOff`, `setParam`, `previewParam`, `setEffectType`, `setEffectParam`,
  `setEffectBalance`, `setEffectRouting`, `setJoystick`, `setAftertouch`, `audioContext`,
  `outputNode`. Attach an `AnalyserNode` to `outputNode` and measure — that is how Phases 2–4
  were verified.
- **If the in-app browser pane is hidden, its screenshots and synthetic clicks fail.** Driving
  the page with the project's own Playwright (`@playwright/test` is already a dev dep) works
  and gives you real pixels; `powerOn()` can also be called directly from the console handle.

## Do not

- **Do not modify SynthStack** at `<sibling SynthStack repo>`. Fork source, read-only.
- **Do not commit the bank** (`public/bank/`, generated and gitignored) or the SF2.
- **Do not add runtime audio or UI libraries.** Build-time and test-only deps are fine.
- **Do not put a PRNG in the signal path.** Its absence is what makes byte-exact golden-buffer
  tests possible. Phase 4's DAC noise model is derived from signal level for exactly this
  reason — copy that pattern if you need "analogue" behaviour.
- **Do not rewrite `PresetPicker` or the MIDI bend/mod-wheel decode.** Both are built and
  tested and merely unwired — see the last DECISIONS.md entry.
- **Do not re-litigate settled decisions** without reading the reasoning.

## Where things stand

908 unit tests, typecheck, build and bank build all clean. The bank builds to 50 MiB /
480 samples / 594 key zones, 100 multisounds and 44 drums, 451/451 loop seams within limit.

Known and deliberate: **39 multisounds and 12 drums are approximated** from the nearest GM
timbre and flagged `approx`; there is **no browser and no WRITE** (Phase 6); **DRUMS mode plays
one drum per key** with unassigned keys silent, and the four selectable Drum Kits are Phase 5/6
work you may want to fold in.

**Two open questions carried forward:**

1. **The Phase 4 listening A/B was never done** — it needs the Robin S recording, which that
   session could not obtain. Everything measurable was measured (RT60 3.61 s against a 3.5 s
   setting, stereo correlation −0.06). If the sound is wrong, `DECISIONS.md` names the two
   constants to move first: the per-effect EQ shelf corners and the chorus depth.
2. **Negative VDF cutoff tracking is still unresolved**, from Phase 3. The manual says "the
   opposite occurs"; the current mapping reaches *no* tracking at −99 and never inverts. I17
   uses tracking `0`, so the gate patch exercised neither reading and could not settle it.
