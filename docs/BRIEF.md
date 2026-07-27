# Brief: BorgM1 — Korg M1 workstation emulator

For: BorgM1 (new project)
Directory: `<repo root>`   ← create and open Claude Code here
Repo: `github.com/TxVibeCoder/BorgM1` (exists, **empty** — nothing to clone)
Written: 2026-07-27

---

## Goal

A browser-based emulator of the Korg M1 (1988) — the PCM workstation, not a Moog-style
analog synth. 16-voice polyphonic multisample playback, the M1's non-resonant VDF, its
three unusual envelopes, its 33-algorithm effects section, 8-timbre Combinations, and an
8-track sequencer. Korg's **official factory bank has already been decoded**, so the 100
factory programs and 100 combinations are importable rather than reconstructable.

Target: play `I17 Organ 2` and have it sound like the record.

## Why here — and not in SynthStack

SynthStack (`<sibling SynthStack repo>`) was the obvious host and it is the wrong one.
Verified by reading the code, not the docs:

- **It is monophonic by design.** `src/engine/voice/monoVoice.ts` is design-locked to
  last-note priority for Mother-32 fidelity, and `DECISIONS.md` records that as deliberate.
  An exhaustive grep found **zero** polyphony, voice-pool, or voice-stealing prior art.
- **Its voice engine is oscillator-based** (`dsp/{ladder,osc,fold,eg,drift}Core.ts`). There
  is nothing to reuse for multisample playback.
- **Its identity is Moog semi-modular with a patchbay.** The M1 has no patchbay.

So: new project. But **fork SynthStack for the shell** — see below. A DAW/VST3 plugin target
was considered and **explicitly dropped** (it would mean C++/JUCE, discarding the whole shell).
Keeping DSP in pure `*Core.ts` files with no Web Audio types preserves a future C++ port at
zero cost today.

## Reuse first — fork and gut

Clone SynthStack, then **delete the engine in one commit before writing any M1 code.** A lazy
gut leaves dead patchbay scaffolding that will quietly shape the voice code.

**Fork the working tree, not HEAD.** SynthStack has ~12 uncommitted files on
`feature/pc-only-ux-pass` (a PC-only sizing pass: control fonts up, mobile media queries and
`OrientationHint.tsx` removed). The full 1304-test suite passes green on the dirty tree —
verified. Copying from HEAD gets you the old small text and mobile cruft.

### Copy verbatim (~1,050 lines)

| File | Lines | Note |
|---|---|---|
| `src/engine/scheduler.ts` | 108 | Chris Wilson lookahead, zero imports, fully generic |
| `src/ui/midi/webMidiInput.ts` | 260 | Zero imports. The best single file in that repo |
| `src/engine/sampleEdit.ts` | 151 | `trimAndFade`, `peaks`, `encodeWav` |
| `src/engine/recorder.ts` + `recordHelpers.ts` | 365 | Only coupling is a `tap: AudioNode` ctor arg |
| `src/engine/quantGrid.ts` | 61 | Anchor-multiply grid math, drift-free |
| `src/engine/voice/keyMap.ts` | 42 | Keybed geometry |
| `src/ui/controls/{Knob,Switch,Button,StepLed}.tsx` | 874 | `Knob` keeps the mod-assign gesture — an M1 wants it |
| `src/ui/controls/dragMath.ts` | 129 | Type-only dep on `ControlDef` |
| `src/ui/PresetPicker.tsx` | 295 | Zero knowledge of modules/jacks |
| `test/helpers/spectral.ts` | 157 | `fft.js`, test-only |

### Copy with surgery

- `src/engine/sampleStore.ts` — **raise `MAX_SAMPLE_BYTES` (4 MiB is far too small)** and
  rename `DB_NAME`. Keep it for *user* samples only; see the factory-bank note in Constraints.
- `data/schema.ts` — keep `ControlDef` + control validation (~60 lines), delete `JackDef`,
  `rangeVv`, and all jack/normal referential-integrity validation.
- `src/ui/theme.ts` — one line: it re-exports `CABLE_COLORS`/`CABLE_COUNT` from `studio.ts`,
  dragging a 1,459-line singleton into everything. Inline the two constants.
- `src/engine/factorySamples.ts` — **keep the native-render family** (~200 lines: stock
  `OscillatorNode`/`GainNode`/`BiquadFilterNode` + `fillWhiteNoise`, rendered offline into an
  `OfflineAudioContext`). Delete the Anvil family. Use this for the DWGS/synth waveforms
  (multisounds 77–99), which were *computed* on the M1, not sampled.
- `src/ui/panels/MonarchPanel.tsx` — copy as the **template** for the panel pattern (controls
  come from JSON, only x/y are hand-coded), then delete.
- `src/ui/stage16x9.ts` — keep the ~80-line tail (`designToScreen`, `insetRectilinear`,
  `polygonPath`); replace all the Moog console geometry.

### Copy the conventions, not the doc mass

Port `src/ui/CONVENTIONS.md` (65 lines) and write a **24-line `CLAUDE.md`** in SynthStack's
format. Do **not** port `DECISIONS.md` (846 lines), `UX_AUDIT.md` (639), `WORK_ORDER.md` (474).

Inherit these rules verbatim: pure cores + thin worklets; no allocation or logging inside
worklet `process()`; never `setInterval`/`setTimeout` for audio events; single serializable
state tree with a JSON round-trip enforced by tests; seeded `mulberry32`, never `Math.random`
in pure code; injected `now()`; **§12.3 no trade dress** — original artwork only, no Korg
logos or copied silkscreen.

Steal the **offline audio battery** structure (`test/audio/` + `src/ui/devharness/` + a
~10-line Playwright spec that reads a JSON blob off the page). It sidesteps Node's lack of
`AudioWorklet` and it is the highest-leverage thing in that repo. **Bonus for BorgM1:** sample
playback is deterministic, so you can use **golden-buffer tests**, which SynthStack could not.

### Delete

All of `engine/dsp/`, `engine/worklets/` (except `pcmTap`), `engine/modules/` (except
`sampler.ts`), `engine/sequencers/`, `router.ts`, `modRouter.ts`, `units.ts`, `quantize.ts`,
`ui/cables/`, `ui/controls/Jack.tsx`, all `ui/panels/`, `monoVoice.ts`, `data/*.json`,
`test/audio/`, and ~40 of the 63 unit-test files.

**The `vv` convention is cheaper to remove than it looks** — it is not a branded type, just
plain numbers with a naming habit. In a fork of only the keeper files it survives in **four
files, ~15 lines**. Delete, don't migrate.

---

## Architecture — settled by research

| Decision | Choice |
|---|---|
| Language | **TypeScript**, DSP in pure `*Core.ts` (no Web Audio types, Node-tested) |
| Engine | **One `AudioWorkletProcessor` owning all 16 slots** — not one per voice |
| Voice model | **16 oscillator slots.** SINGLE/DRUMS = 1, DOUBLE = 2 |
| Interpolation | 4-point cubic Hermite (19 ops; 44 dB @4× vs linear's 34) |
| Sample source | **FluidR3_GM (MIT)** as the spine |
| Sample rate | ~**32 kHz**, as a tunable constant |

**`AudioBufferSourceNode` is disqualified** — `playbackRate`/`detune` are k-rate (375 Hz
updates, audible zipper under the M1's fast pitch EG); its resampler is unspecified and
browser-dependent (Chrome linear ~19 dB, Firefox libspeex), so patches would sound different
per browser; it cannot crossfade a loop; and 32 streams would mean ~400 nodes churned at note
rate. There is also no non-resonant lowpass in the native node set.

**Near-zero `AudioParam`s.** Measured: cutting a 16-voice synth from 544 params to 96 took
total audio processing 5.94 ms → 2.31 ms. Send parameter changes over `port.postMessage` and
read them at block boundaries.

---

## Phases

Each ends playable. Estimates are focused sessions (~a working day).

| # | Phase | Sessions |
|---|---|---|
| 0 | Fork, gut, scaffold, port conventions | 0.5 |
| 1 | Sample pipeline (build-time) | 1.5–2 |
| 2 | Voice engine | 2–3 |
| 3 | Program layer + panel UI | 2–3 |
| 4 | Effects (33 algorithms) | 3–4 |
| 5 | Combinations | 1.5–2 |
| 6 | Sequencer | 2–3 |
| 7 | Factory bank import | 0.5–1 |

**~14–19 sessions total.** Phases 0–5 + 7 (dropping the sequencer) give a complete instrument
in ~12–16.

**Phase 1** — FluidR3_GM → `spessasynth_core` (TS, Apache-2.0, active) to enumerate
presets/zones and pull per-sample PCM + loop points + key/vel ranges → **rebase SF2 loop
offsets** → resample → **bake the loop crossfade and a 4-sample guard region after
`loopEnd`** → emit `Int16Array` blobs + a JSON keymap. Target the full manifest: **100
multisounds + 44 drum sounds** (both lists recovered verbatim; see research). Upgrade
selectively with Greg Sullivan E-Pianos (CC-BY), FreePats CC0 electric organ, VCSL/VSCO 2 CE
(CC0). Synthesize multisounds 77–99 rather than sampling them.

**Phase 2** — One generic `LevelTimeEG` configured three ways (do **not** write three envelope
classes). Non-resonant TPT lowpass. 128×128 `uint16` keymap table **per oscillator** (32 KB,
branch-free). Allocator: FluidSynth's published weights (released −2000, sustained −1000,
age +1000/sec, volume +500) plus a **hard same-note-first rule**, and a 4 ms fade on steal —
never a hard kill.

---

## Constraints

- **Port 5184.** Taken portfolio-wide: 5173 SynthStack, 5180 another local project, 5182 another local project,
  8737 another local project, 8765 another local project's Docker server.
- Vite + React 18 + TS strict. **No runtime audio or UI libraries** (`fft.js` test-only).
- Windows launcher `.cmd` on the fixed port, per portfolio convention.
- **Factory bank belongs in the Cache API, not IndexedDB** — IndexedDB deserializes on
  retrieval and is the worst home for large blobs. Keep `sampleStore.ts`'s IndexedDB for
  user samples.
- **Do not hardcode a 128-frame render quantum.** Web Audio 1.1 `renderSizeHint` ships in
  Chrome M153. Read the actual buffer length.
- PC-only. SynthStack's in-flight pass strips mobile; inherit that (it also dodges mobile
  Safari's uncatchable ~100–200 MB audio-memory crash).

## Done when

1. `I17 Organ 2` A/Bs credibly against Robin S — "Show Me Love" (**StoneBridge Mix**, not the
   1990 original). This is the acceptance test: its filter and amp envelopes are flat, so
   100% of the character is the sample plus chorus-at-depth-99-with-+12/+12-EQ into a 3.5 s
   hall. If the chorus and EQ are right, the patch is right.
2. `I01 Piano 16'` — exercises keyboard tracking and the 5/10 ms full-wet stereo doubler.
3. `I00 Universe` — exercises DOUBLE-mode layering (Choir + Lore) and the asymmetric
   247/414 ms delay.
4. All 100 factory programs load from Korg's decoded preload and are playable.
5. Golden-buffer tests green; offline audio battery green.

---

## Watch out for

### Research traps — each would poison the build

- **ManualsLib entry 819462 titled "KORG M1 OWNER'S MANUAL" is the 2006 *software plugin*
  manual.** It lists `RESONANCE` and a `RESONANCE Switch [OFF/ON]` — the switch exists
  *because* the hardware had none. **The hardware VDF has no resonance**, confirmed three
  ways. Use ManualsLib **898710** or Korg's own CDN PDF.
- **There is a decoy drum list in the real manual.** An illustrative figure in the overview
  section reads "BASS DRUM 1 / PICCOLO SNARE / HI BONGO…" — the M1 has none of those. The
  real list is on p.138.
- **The Korg Super Guide contradicts the Owner's Manual** on drum-kit ranges. It is
  pre-release marketing; the Owner's Manual wins.
- **Do not port parameter names from the Korg Legacy Collection M1.** It has `SEND 1`/`SEND 2`/
  `RETURN LEVEL` and a compressor — none existed in 1988. Korg explicitly did *not* model the
  hardware effects.
- **Arachno SoundFont contains actual Korg M1 ROM samples** (its author documents this) and is
  private-use-only. It is the most tempting hit when searching "M1 soundfont". Also excluded:
  **Philharmonia** and **Pianobook** (both explicitly forbid redistribution as a sampler
  instrument — precisely what this is), **SGM-v2.01** (orphan work, two *different* fake open
  licenses in circulation), Musyng Kite, Timbres of Heaven, jRhodes (NC), SSO.

### Engine traps

- **VDF cutoff keyboard tracking of `0` means 100% tracking**, not none — cutoff follows pitch
  1:1. Negative values are needed for *no* tracking. Silently affects every patch. Note the
  asymmetry: EG-Time tracking at 0 *is* off.
- **`NT` means "No Tracking"** (fixed pitch), not "no transient". One ROM sample exposed twice
  with tracking toggled — a per-multisound boolean.
- **There are no velocity zones inside a multisound.** Velocity lives at Program level
  (DOUBLE with opposite-signed VDA sensitivities = continuous crossfade) or Combi level
  (`VELOCITY SW` hard split).
- **Attack transients are separate multisounds**, layered via DOUBLE + OSC2 Delay Start — not
  concatenated onto loop bodies.
- **DOUBLE mode must claim both slots atomically.** Allocating one and failing the other
  yields a half-voice.
- **An uncaught exception in `process()` silences the node permanently.** Guard it.
- **SF2 loop points are absolute offsets** into the global sample blob — rebase per sample by
  subtracting `dwStart`. And **ffmpeg silently drops the WAV `smpl` chunk**; extract loop
  points to JSON *before* resampling, then scale.
- **sfizz was archived in June 2026.** Use `spessasynth_core`.
- **Vite worklet import:** use `?worker&url`, never plain `?url` — the latter ships raw
  uncompiled `.ts` as a data URI. SynthStack's `context.ts` documents this; copy the comment.

### Effects

- **There are no effect sends.** The **Panpot** parameter *is* the routing — a 14-position
  discrete bus assignment (`A`, 9:1…1:9, `B`, `C`, `C+D`, `D`). Build 4 buses + a 2-effect
  matrix. Program mode has no panpot page at all, so a non-drum Program is hard-wired 5:5 into
  A/B and **cannot reach Effect 2 in PARALLEL**.
- **Reproduce the quantization grids**, don't smooth them: reverb time 0.1 s steps, E/R 10 ms,
  EQ 1 dB, and a **piecewise** LFO rate (0.03 Hz steps to 3 Hz, 0.1 to 13 Hz, whole Hz above
  14). Continuous floats will sound wrong on sweeps.
- **Enforce the pairing restriction** — asterisked (modulation) effects cannot coexist with
  Symphonic Ensemble or Rotary Speaker. The hardware ran out of DSP; an emulator that allows
  any pair is not an M1.
- Reverbs, Early Reflections, Overdrive, Distortion, Symphonic and Rotary are **mono-sum in,
  stereo out**. That is why M1 reverb sits so centred.
- `I`/`II` variants of Chorus/Flanger/Phaser/Tremolo are **not separate algorithms** — one
  modulation block with a phase-invert bit. Four fewer implementations.
- **Model the breathing noise floor.** The DAC is 16-bit plus a 3-bit analog gain range, so
  quantization noise tracks signal level — stepping down as a tail decays, up on the next
  transient. That is what 1988 reviewers heard as "graininess on drums."
- **Korg's own emulation got the wet levels globally too hot** — SOS had to drop reverb from
  18 to 13 across most patches. Measure, don't eyeball.

### Genuinely undocumented — design decisions, not facts

Flag these in code as choices, not M1 truth: **filter slope in dB/oct**; the **EG time 0–99 →
seconds curve**; the **voice-stealing rule**; the **exact sample rate** (two independent
derivations bracket it — ~31.2 kHz from PCM-card capacity, and ≤32,768 Hz from the effects
RAM, where 32.768 kHz makes 500 ms exactly 2¹⁴ words and partitions memory into four clean
16K blocks).

Also unpublished: the factory drum-kit note mappings. Author your own.

---

## Research artifacts — read these first

**`../BorgM1-research/`** — 193 MB, 560 files, preserved 2026-07-27 from a
session scratchpad that would otherwise have been cleaned. Move it into the repo (gitignored)
or keep it alongside.

- `preload/M1_Preload.zip` + `preload/final.py` — **Korg's official factory preload SysEx and a
  working decoder.** 100 programs at offset 13261 (143 bytes each), 100 combis at 861 (124
  bytes each). Decode: strip the 5-byte header, skip 3 more, then Korg 7-bit unpack in groups
  of 8. Validated non-circularly — 20/20 programs matched their predicted multisamples.
- `M1_official.pdf` — the official 138-page Owner's Manual from Korg's CDN. Image-only;
  `img/` and `drums/` hold rendered page crops (p.138 has both sound lists).
- `m1_service.pdf` + `mde_zoom.png`, `dac_zoom.png` — service manual. Confirms the **MB87405
  "MDE"** effects chip, its **65,536-word × 20-bit** delay RAM (the origin of every delay
  limit), and the gain-ranged DAC.
- The complete **143-byte Program Parameter table** was transcribed visually from a 6× render —
  every parameter, hex range, and the EG-time bitfield packing (enable and polarity are
  separate bits, so `0` genuinely means disabled). This is the data model; build the schema
  from it.

---

## Open — your call

- **Name.** `BorgM1` keeps the real model number and sits one letter from the manufacturer, on
  a public repo. SynthStack scrubs Moog names to cover names (Monarch, Anvil, Cascade,
  Courier). Legal risk is small; it is a visible break from the convention. Decide before the
  first commit — it lands in the directory, the port, and the repo.
- **Sequencer.** Phase 6 is the largest, least M1-specific chunk, and you already own three
  sequencers (another local project's editable piano roll, another local project's session grid, a MIDI pattern builder) plus a commercial DAW.
  It is cleanly severable — sequencer tracks are fully independent of Combinations. Decide
  after Phase 5 ships, when you'll know whether you want it.
