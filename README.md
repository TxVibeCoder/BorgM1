# BorgM1

A browser-based emulator of the **Korg M1** (1988) — the PCM workstation, not an analog synth.

16-voice polyphonic multisample playback, the M1's non-resonant filter, its three unusual
envelopes, a 33-algorithm effects section, 8-timbre Combinations, and (optionally) an 8-track
sequencer. Korg's official factory bank has been decoded, so the 100 factory programs and 100
combinations are **importable, not reconstructable**.

**Status: Phases 0–5 complete — it plays, it edits, it has its effects, and it is a
workstation.** 16-voice polyphony (8 in DOUBLE) from the on-screen keybed or over Web MIDI, all
100 multisounds selectable, all **139 program parameters** editable on a six-page panel and
audible in the engine, all **33 effect algorithms** in the two-slot master section with the
hardware's own routing — so the output is stereo — and **five Combination types with eight
timbres** on an 8-row strip, sharing one 16-slot pool and routed by the 14-position panpot that
reaches effect buses C and D. One command builds the sample bank. 1070 tests green plus a
Playwright layout audit. Phase 6 — the browser and the factory bank — is next.

## Quick start

```bash
npm install && npm run dev
```

Then open <http://localhost:5184>, hit **POWER**, and play the keybed or a connected MIDI
keyboard. Windows users can run `start-windows.cmd` instead, which does both steps.

POWER is the AudioContext unlock — nothing sounds before it, by browser policy, not by choice.

**RECORD** (header, right of the bank status) captures the master output and downloads it when
you stop. The chip beside it picks the format for the NEXT take: `WAV` is a lossless PCM tap,
`WEBM` is Opus. Powering off mid-take finishes the file rather than losing it.

### Building the sample bank

The app plays the *built bank*, which is generated rather than committed. Building it needs a
copy of **FluidR3_GM.sf2** (MIT, 141 MB — deliberately not vendored):

```bash
npm run build:bank
```

It looks for the SF2 at `$BORGM1_SF2`, then `assets/FluidR3_GM.sf2`, then a sibling project's
copy. The output lands in `public/bank/` (gitignored). Sources and licences are in
[`CREDITS.md`](CREDITS.md).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on **5184** (`strictPort` — a collision fails loudly) |
| `npm test` | Unit tests, Node environment |
| `npm run typecheck` | `tsc -b`, strict |
| `npm run build` | Typecheck + production build, base path `/BorgM1/` |
| `npm run build:bank` | Build `public/bank/` from the SF2. Fails on a bad loop seam or a missing guard region |
| `npm run probe:sf2` | Diagnostics on the source SoundFont |
| `npm run probe:effects` | Validates the effect table against Korg's factory bank (skips cleanly without it) |
| `npm run probe:combis` | The same, for the 124-byte Combination table. **100/100 byte-exact** |
| `npx playwright test` | The rendered-page layout audit — text and control collisions at a real window size |

## Documentation

| Document | What it is |
|---|---|
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | **Picking the work back up? Start here.** |
| [`CLAUDE.md`](CLAUDE.md) | The non-negotiable conventions. Read first. |
| [`docs/PLAN.md`](docs/PLAN.md) | **The phased build plan, with status.** Start here to build. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Dated decision log. Append, don't rewrite. |
| [`docs/UI-SPEC.md`](docs/UI-SPEC.md) | Layout audit of the reference UI, with measurements |
| [`docs/BRIEF.md`](docs/BRIEF.md) | The founding brief. Its **traps** section is still live. |
| [`docs/RESEARCH-INDEX.md`](docs/RESEARCH-INDEX.md) | Where the source material lives |
| [`CREDITS.md`](CREDITS.md) | Every sample source and its licence |
| [`src/ui/CONVENTIONS.md`](src/ui/CONVENTIONS.md) | UI contracts — knob ergonomics, the `1`/`2` rule |

## Layout

```
data/            build-time + shared data
  sounds.ts        the 100 multisound / 44 drum manifests, from the 1988 manual
  sourceMap.ts     which GM preset each sound is built from
  programParams.ts THE 143-byte SysEx program table — 139 parameters, with byte codecs
  effectParams.ts  THE 25-byte effect block — 33 algorithms, their grids and defaults
  combiParams.ts   THE 124-byte Combination table — 5 types, 8 timbres, the 14-position panpot
  schema.ts        ControlDef + validation
scripts/         build-time only, never shipped
  buildBank.ts     THE bank builder. One command; runs the loop-seam gate on its own output
  probeSf2.ts      measures the SoundFont instead of trusting its docs
  probeEffects.ts  validates the effect table against Korg's own factory bank
  probeCombis.ts   the same for combinations — it is what corrected TABLE 6 and the plan
src/engine/
  sample/          bake pipeline: resample -> loop -> crossfade -> guard -> int16
  dsp/             levelTimeEgCore, lowpassCore, samplePlayerCore, mgCore, modCore
  dsp/fx/          the effect section: nine blocks + effectChainCore, the 2-slot matrix
  voice/           voiceAllocCore (16 slots), keymapCore, voiceEngineCore, keyMap
  program/         programConfigCore — params bag -> engine config, the Phase 3 seam
                   combiConfigCore — the five types -> one list of timbres, the Phase 5 seam
  worklets/        thin shells only — voice.worklet, pcmTap.worklet
  bankLoader.ts    Cache API; converts Int16 -> float once at load
  engineBridge.ts  the ONE seam between React and the engine
src/ui/          stage geometry, controls, keybed, theme
  panel/           the six-page panel: layout, Section, ParamControl, EgGraph, Joystick,
                   EffectSection (the FX page — its parameters come from the algorithm),
                   TimbreStrip + CombiSection (COMBI mode's 8 rows and their detail)
src/state/       m1State.ts — the single serializable tree; store.ts — its one instance
test/unit/       1070 tests, Node environment
test/e2e/        the rendered-page layout audit (Playwright, real window size)
```

**Pure cores, thin shells.** Everything audible lives in a `*Core.ts` with no Web Audio types,
tested in Node. The worklet marshals buffers and messages and nothing else.

## Shape of the build

Forked from SynthStack (`<sibling SynthStack repo>`) for its shell, engine deleted in one
commit, M1 voice engine built fresh. That fork is done; the source repo is read-only and
untouched.

**Eight phases.** Every phase ends with something you can play or hear. Phases 0–6 give a
complete instrument; Phase 7 (the sequencer) is a separate decision made after Phase 6 ships.

The first fidelity gate is **Phase 4**: hand-enter `I17 Organ 2` and A/B it against Robin S —
"Show Me Love" (StoneBridge Mix). That patch's filter and amp envelopes do nothing, so the whole
character is sample + chorus + EQ + hall. If it doesn't match, the cause is unambiguous.

Everything measurable about that gate is measured and recorded in `docs/DECISIONS.md` —
RT60 3.61 s against a 3.5 s setting, stereo correlation −0.06 from a mono source. **The
listening comparison itself is still open**; it needs the recording, and the two constants to
move first if it misses are named there.

## Known limitations at this stage

- **The Phase 4 A/B has not been done by ear.** Everything around it has been measured.
- **No program browser, no WRITE.** Phase 6 owns those; the program name is display-only.
- **Two inherited features are built and tested but have no UI yet.** `PresetPicker` (named
  user setups, `.json` export/import) needs a `SetupBridge` binding; MIDI **pitch bend and
  mod wheel** are decoded by `webMidiInput` but not routed to the joystick. Both are roughly
  one binding each — they are unwired, not unwritten.
- **DRUMS mode plays one drum per key** and unassigned keys are silent, which is authentic.
  Assembling the four selectable Drum Kits is Phase 5/6.
- **39 of 100 multisounds and 12 of 44 drums are approximated** from the nearest General MIDI
  timbre, because GM has no slot for the M1's own synthesised textures (`Lore`, `PanWave`,
  `Wire`…). They are flagged `approx` in `data/sourceMap.ts` and marked `~` in the UI; that
  flag is the upgrade shortlist, not an apology.
- **A Program cannot reach effect 2 in PARALLEL** — it has no panpot page, so it is hard-wired
  into buses A/B, and in PARALLEL those stop at effect 1. That is the hardware; the panel says
  so rather than leaving controls that do nothing. A **Combination** has a real panpot and does
  reach it — measured at correlation 0.868 through effect 2.
- **A Combination timbre panned to C/D is SILENT when Output 3/4 Pan are OFF.** Also the
  hardware: those pans are what folds outputs 3 and 4 into the stereo pair, and 37 of Korg's
  100 factory combinations leave them off because they expected a mixer on those jacks.
- **Combination timbres point at a program bank that does not exist yet.** Until Phase 6
  imports Korg's preload, a slot other than the edit buffer materialises as the INIT program
  with its multisound set to the slot number — a labelled stand-in, not a guess at the factory
  bank. Phase 6 replaces one method.
- **Per-timbre `IFX` is visibly inert.** It is a plugin-era extension the hardware has no
  equivalent for, it is not implemented, and whether it is a send or a toggle is itself
  unresolved (UI-SPEC §11).
- **Multisounds do not all span the keyboard.** That is authentic — the Owner's Manual says each
  waveform has a limited pitch range and "may not sound when played in a high octave".

## One decision still open

**The sequencer** (Phase 7). Largest and least M1-specific chunk; three sequencers already exist
in the portfolio, and the reference plugin dropped it entirely. Decide after Phase 6, with a
working instrument in front of you.

## Port

**5184.** Taken portfolio-wide: 5173 SynthStack, 5180 another local project, 5182 another local project, 8737 another local project,
8765 another local project's Docker server.
