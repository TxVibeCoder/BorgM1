# Handoff — start here

*Written 2026-07-28, at the end of Phase 3. Paste this to a fresh session, or read it yourself
after a break.*

---

You are picking up **BorgM1**, a browser emulator of the Korg M1 (1988) PCM workstation.
Directory: `<repo root>`. Windows, PowerShell.

**Phases 0–3 are done. The instrument plays and it edits.** Your job is **Phase 4 — the
effects section**, which carries the project's **first fidelity gate**. Do Phase 4 only; do not
start Phase 5.

## Read first, in this order

1. `CLAUDE.md` — the non-negotiable conventions. Short. All of it applies.
2. `docs/PLAN.md` — the eight-phase plan with live status. **Phase 4 is your spec.**
3. `docs/DECISIONS.md` — dated log of what was decided and why. Read the Phase 0–3 entries
   before proposing anything that contradicts them; several look like obvious improvements and
   are not.
4. `docs/UI-SPEC.md` — the layout spec. §3 covers the `INSERT FX` panel.
5. `docs/BRIEF.md` — **only the "Watch out for" section**, and within it the **Effects**
   block, which is written for exactly this phase.

`README.md` has the code map and the command table.

## Get it running before you change anything

```bash
npm install && npm run build:bank && npm run dev
```

Open <http://localhost:5184>, press **POWER**, wait for `BANK OK`, and play the keybed. Turn a
`CUTOFF` knob and hear it change. If you cannot hear it working, do not start editing it.

`npm run build:bank` needs **FluidR3_GM.sf2** (MIT, 141 MB, deliberately not vendored). It is
resolved from `$BORGM1_SF2`, then `assets/`, then `<sibling soundfont dir>/`. The
third of those is a sibling project — **read-only, never modify it.**

## What Phase 4 is

33 effect algorithms plus `No Effect`, two effect slots, the routing matrix — and then the
acceptance test the whole project is built around.

### Your spec is already located, and it is complete

This is the big head start. **Owner's Manual p.129** prints `*11 EFFECT PARAMETER` in full:
the 25-byte block layout, all 33 algorithms with every parameter and range, and the
quantization grids. Read it from **`pg/p129.png`** in the research payload
(`../BorgM1-research/`).

**Read the IMAGES, not the OCR.** Every table in the MIDI appendix is multi-column and the OCR
text layers interleave the columns, so one parameter's name lands beside another's range.
Phase 3 wasted a search on the OCR before transcribing p.127 from the image in a single pass.
`docs/RESEARCH-INDEX.md` now has a table of exactly which image holds which table.

The byte layout is already reserved and decoded twice over:

- `data/programParams.ts` reserves bytes **38–62** so the record stays 143 bytes and
  round-trips. Its test asserts the block is left untouched — you will be filling it in.
- `preload/final.py` in the research payload decodes it and is validated against Korg's own
  factory bank: **38/39** the two effect types, **40–43** the L/R balances, **44/45** the
  Output 3/4 pans, **46** the routing bitfield (bit4 = serial), **47–54** and **55–62** the two
  8-byte parameter blocks.

### The four things PLAN.md says that are easy to skim past

- **Four fewer implementations than it looks.** The `I`/`II` variants of Chorus, Flanger,
  Phaser and Tremolo are **one modulation block with a phase-invert bit** — confirmed on p.129,
  where `MG Status` bit1 is the phase and bit0 the waveform.
- **Reproduce the quantization grids; do not smooth them.** Reverb time 0.1 s steps, E/R time
  10 ms, EQ 1 dB, and a **piecewise** LFO rate (p.129 note `*11-3-2`: 0.03 Hz steps to 3.00,
  0.1 to 13.0, whole Hz to 30). Continuous floats sound wrong on every sweep.
- **4 buses and a 2-effect matrix, not sends.** The `Panpot` parameter *is* the routing.
  Program mode has no panpot page at all, so a non-drum Program is hard-wired 5:5 into A/B and
  **cannot reach Effect 2 in PARALLEL**.
- **Enforce the constraints rather than fixing them.** Asterisked modulation effects cannot
  pair with Symphonic Ensemble or Rotary Speaker; most effects leave their EQ in circuit even
  when switched off; reverbs and ER are **mono-sum in, stereo out**.

### The gate

Hand-enter `I17 Organ 2` — Organ2 multisound, flat filter and amp envelopes, Stereo Chorus 1
at depth 99 with EQ +12/+12, into a 3.5 s Hall — and **A/B it against Robin S, "Show Me Love"
(StoneBridge Mix)**, with extensions off.

That patch's filter and amp envelopes do nothing, so 100% of its character is sample + chorus
+ EQ + hall. If it doesn't match, the cause is unambiguous. **Measure, don't eyeball** — Korg's
own emulation shipped with wet levels globally too hot (SOS had to drop reverb from 18 to 13).

**Phase 3 makes this reachable:** every parameter that patch needs is already editable on the
panel and audible in the engine, and the flat-envelope shape is the default program.

## What Phase 3 left you

- **`data/programParams.ts`** — the 143-byte table, 139 parameters, with `encodeParam` /
  `decodeParam`. The params bag stores **display values**, not bytes, so `decodeProgram` is
  already Phase 6's factory-bank importer.
- **`src/engine/program/programConfigCore.ts`** — the one place parameters become engine
  config. Generic in the sample type, so the same mapping serves the main thread and the
  worklet without a cast.
- **`src/engine/dsp/mgCore.ts` and `modCore.ts`** — the MGs and the modulation rules.
- **`src/ui/panel/`** — the five-page panel. Sections declare *which* parameters, never
  *where*; `layout.ts` computes positions.
- **`context.ts` still reserves an `insertSlot`** in the master chain so the effects section is
  a node swap rather than a refactor.

Engine output is **mono**, deliberately: the M1's stereo image comes from this section, and its
reverbs are mono-sum in / stereo out anyway.

## The test that matters most, and why

`test/unit/programConfig.test.ts` holds an **audibility sweep**: one program with every
modulation live, then change ONE parameter at a time and require the rendered audio to differ.
It is the only test in the project that catches a parameter which exists in the table and never
reaches the engine — and it caught two during Phase 3 (`JS_PITCH_MG_FREQ` and `JS_VDF_MG_FREQ`
were simply never wired). `test/unit/panelLayout.test.ts` does the same for the panel and caught
a third: an entire section declared and placed on no page.

**Extend the sweep to the effect parameters.** It is the cheapest insurance you will get.

## How to work

- **One branch per phase.** `git checkout -b phase-4-effects`, merge to `main` with `--no-ff`
  when the gates pass.
- **Append to `docs/DECISIONS.md`, dated**, whenever you make a call a later session would
  otherwise have to re-derive. This is the single highest-value habit in the project.
- **Label the guesses.** Several curves are already labelled choices rather than M1 facts;
  add yours to that list rather than burying them.
- **Verification floor before closing the phase:** `npm test`, `npm run typecheck`,
  `npm run build` and `npm run build:bank` all clean, plus Phase 4's own gate.
- **Then drive the app and measure it.** Both Phase 2 bugs and one Phase 3 bug lived in the
  seam between correct components, where unit tests are blind. Going green is not the same as
  working.

## Traps that will bite you specifically

- **`ManualsLib 819462` is the 2006 SOFTWARE PLUGIN manual, not the hardware one.** It lists
  `SEND 1`/`SEND 2`/`RETURN LEVEL` and a compressor — none of which existed in 1988. Korg
  explicitly did *not* model the hardware effects in the Legacy Collection. Use Korg's own CDN
  PDF (`M1_official.pdf`) or ManualsLib **898710**.
- **A weak metric will give you a confidently wrong answer.** This has now happened in three
  separate phases and it is recorded each time. In Phase 3 a peak-bin FFT search reported the
  pitch bend as *inverted*, and autocorrelation reported a note an octave low. Prefer a
  measurement where a known bias cancels — compare two readings through the same detector and
  claim only the ratio.
- **An analyser whose FFT window is longer than your settle time reports the PREVIOUS note.**
  `fftSize` 32768 at 48 kHz is 683 ms of history. This cost real time in Phase 3.
- **Extensions default OFF and must heal to OFF.** The gate has to pass with `resonance` off.
  A state tree that coalesces an unknown flag to "on" breaks the gate silently, which is the
  worst way for it to break.

## Environment friction, already paid for

- **PowerShell here-strings and bash heredocs both break on this project's prose.** A
  multi-line `git commit -m` will shred itself into pathspec errors, and a `cat << 'EOF'` with
  backticks in the body fails to parse. Write the message to a file and use
  `git commit -F <file>`; use the Edit tool for long doc appends.
- **.NET file APIs do not follow `Set-Location`.** Pass absolute paths, or prefer Read/Edit/Write.
- **The launcher must keep CRLF line endings.** `.gitattributes` pins `*.cmd`/`*.bat`; don't
  relax it.
- **The bank is cached by the Cache API.** After `npm run build:bank`, an already-open page
  keeps serving the old blob. Clear it in the console before re-testing:
  `for (const k of await caches.keys()) await caches.delete(k)` then reload.
- **Port 5184 is `strictPort`** — a stale dev server makes `npm run dev` fail rather than drift
  to 5185. That is deliberate. Kill the old process.
- **Dev-only handles at `window.__borgm1` and `window.__borgm1store`** (stripped from
  production builds). The bridge gives you `noteOn`, `noteOff`, `setParam`, `previewParam`,
  `setJoystick`, `setAftertouch`, `audioContext` and `outputNode` — attach an `AnalyserNode` to
  `outputNode` and measure. That is how Phases 2 and 3 were verified.
- **`.claude/launch.json`** exists, so the browser preview tooling can start the dev server by
  name (`borgm1`).

## Do not

- **Do not modify SynthStack** at `<sibling SynthStack repo>`. Fork source, read-only.
- **Do not commit the bank.** `public/bank/` is generated and gitignored. Nor the SF2.
- **Do not add runtime audio or UI libraries.** Build-time and test-only deps are fine.
- **Do not put a PRNG in the signal path.** Its absence is what makes byte-exact golden-buffer
  tests possible, and that is the sharpest test in the project. Note this bites in Phase 4:
  the **breathing noise floor** is worth modelling, but derive it from the signal level, not
  from `Math.random`.
- **Do not re-litigate the settled decisions** in `DECISIONS.md` without reading the reasoning.

## Where things stand

552 unit tests, typecheck, build and bank build all clean. The bank builds to 50 MiB /
480 samples / 594 key zones, 100 multisounds and 44 drums, with 451/451 loop seams within
limit.

Known and deliberate: output is **mono** (Phase 4 fixes this), 39 multisounds and 12 drums are
**approximated** from the nearest General MIDI timbre and flagged `approx`, there is **no
browser and no WRITE** (Phase 6), and **DRUMS mode plays one drum per key** with unassigned
keys silent — the four selectable Drum Kits are Phase 5/6.

**One question left open by Phase 3, for your A/B to settle:** the manual says negative VDF
cutoff keyboard tracking makes "the opposite" happen — cutoff falling as pitch rises — but the
current mapping reaches *no* tracking at −99 and never inverts. The diagram is ambiguous and
both readings are defensible, so it was left alone rather than changed on one sentence's
reading. You will have a real recording in front of you; see the Phase 3 entry in
`DECISIONS.md`.
