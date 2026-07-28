# BorgM1 — phased build plan

Eight phases. **Every phase ends with something you can play or hear** — no phase is pure
plumbing. Estimates are focused sessions (roughly a working day).

| # | Phase | Status | Sessions | Ends with |
|---|---|---|---|---|
| 0 | Fork, gut, scaffold | ✅ **done** | 0.5 | An empty shell that boots and tests green |
| 1 | Sample pipeline | ✅ **done** | 1.5–2 | A built sample bank on disk |
| 2 | Voice engine | ✅ **done** | 2–3 | **Polyphonic playing from the keyboard** |
| 3 | Program layer + panel UI | ✅ **done** | 2–3 | Every parameter editable and audible |
| 4 | Effects | ✅ **done** | 3–4 | **First fidelity gate — `I17 Organ 2` by hand** |
| 5 | Combinations | ✅ **done** | 1.5–2 | 8-timbre splits and velocity switches |
| 6 | Browser + factory bank | ◀ **next** | 1–1.5 | **All 100 factory programs, loadable** |
| 7 | Sequencer *(decide after 6)* | | 2–3 | 8-track recording and playback |

**Phases 0–6 = ~12–16 sessions and a complete instrument.** Phase 7 is a separate decision.

**Where things stand:** the instrument plays 16-voice polyphonic multisamples (8 in DOUBLE) from
the on-screen keybed and over Web MIDI, with all 100 multisounds selectable, **all 139 program
parameters editable on a six-page panel and audible in the engine**, and **all 33 effect
algorithms in a two-slot master section with real routing** — so the output is stereo. It is now
also a workstation: **five Combination types, eight timbres against one 16-slot pool, and the
14-position panpot that reaches effect buses C and D** — the half of the effect matrix a Program
cannot get to. The header carries a **RECORD** control (WAV lossless or WEBM). 1070 unit tests
plus a Playwright layout audit, typecheck, build and bank build all clean. What is *not* built
yet: the browser and the factory bank import.

Every phase's decisions are recorded dated in `DECISIONS.md`; the notes below are the plan as
written, kept intact so the plan and its outcome can be compared.

---

## Phase 0 — Fork, gut, scaffold · 0.5 · ✅ DONE

**Goal:** a booting shell with SynthStack's proven infrastructure and none of its engine.

Clone `<sibling SynthStack repo>` **from the working tree, not HEAD** — the uncommitted
PC-only UX pass touches exactly the files worth inheriting, and the full 1304-test suite passes
green on it. Then, in **one commit**, delete: all of `engine/dsp/`, `engine/worklets/` (keep
`pcmTap`), `engine/modules/` (keep `sampler.ts`), `engine/sequencers/`, `router.ts`,
`modRouter.ts`, `units.ts`, `quantize.ts`, `ui/cables/`, `ui/controls/Jack.tsx`, all
`ui/panels/`, `monoVoice.ts`, `data/*.json`, `test/audio/`, and ~40 of the 63 unit-test files.

Then rename, set the Vite base path, move to **port 5184**, and copy the keepers — see
`BRIEF.md` for the file-by-file list with line counts.

**Done when:** `npm run dev` serves an empty shell on 5184; `npm test` and `npm run build` are
green; the `vv` convention appears nowhere.

> **Gate:** a JSON state round-trip test exists and passes. From day one, not retrofitted.

**Outcome.** All gates met. The fork-point warning turned out stale — the PC-only UX pass had
landed and merged, so `main` *was* the tree the brief wanted. Three deliberate departures from
the keep-list, all toward a more thorough gut (`sampler.ts`, `ui/keyboard/*`, the Moog audio
battery); `PresetPicker` was kept but dependency-injected, and its Node render harness lifted
into `test/helpers/renderComponent.ts` where later phases can use it. Design box settled at
1400×800 — exactly 7:4, and 1% lands on a whole 14×8 px so UI-SPEC's percentages convert
without accumulating error.

---

## Phase 1 — Sample pipeline · 1.5–2 · ✅ DONE

**Goal:** a build-time script that turns CC-licensed sources into BorgM1's sample bank. This is
**tooling, not runtime** — it runs in Node and commits its output, or is run on demand.

FluidR3_GM (MIT) → `spessasynth_core` to enumerate presets/zones and pull per-sample PCM, loop
points, and key/velocity ranges → **rebase SF2 loop offsets** (subtract `dwStart` per sample) →
resample to a configurable rate, default 32 kHz, **scaling loop points by the same ratio** →
bake the loop crossfade **and a 4-sample guard region after `loopEnd`** → emit `Int16Array`
blobs plus a JSON keymap.

Target the full manifest — **100 multisounds + 44 drum sounds**, both lists recovered verbatim.
Upgrade selectively: Greg Sullivan E-Pianos (CC-BY) for Rhodes/Wurli/CP80, FreePats CC0 electric
organ, VCSL and VSCO 2 CE (CC0) for strings and brass. **Synthesize multisounds 77–99** rather
than sampling them — they were computed DWGS waves on the hardware, and `factorySamples.ts`'s
offline-render pattern is exactly the tool.

Spend the absent size ceiling on **denser key zones**, not longer samples or higher rates.

**Done when:** one command produces a bank; a `CREDITS.md` records every source and license.

> **Gate:** an automated test asserts **loop-seam continuity** for every looped sample — no
> discontinuity across the wrap. This is the bug that would otherwise surface as clicks on every
> sustained note, three phases later.

**Outcome.** `npm run build:bank` produces 50 MiB / 480 samples / 594 key zones, 100 multisounds
and 44 drums, **451/451 loop seams within limit**. The gate runs on the build itself, so a bad
bank cannot be produced — and it caught a bug in *itself* first, failing the square and saw
tables because a tail-only window under-reads a flat waveform's natural step size.

Only 63 multisounds actually needed sourcing: 14 are NT references that reuse a sibling's
recording, 23 are the computed DWGS block. Two facts were **measured** rather than assumed
(`scripts/probeSf2.ts`) and both changed the code: `spessasynth_core` already rebases loop
points, and `loopEnd` is exclusive — which needed measuring because the library's own docs
contradict each other.

---

## Phase 2 — Voice engine · 2–3 · ✅ DONE

**Goal:** play polyphonically. The core of the project.

Pure cores in `*Core.ts`, Node-tested, no Web Audio types:

- **`samplePlayerCore`** — float64 phase accumulator, 4-point cubic Hermite, loop wrap against
  the baked guard region. Recompute the increment per block and **interpolate it across the
  block** or a fast pitch EG steps audibly.
- **`levelTimeEgCore`** — **one** generic level/time envelope, configured three ways. Do not
  write three envelope classes. VDF EG: 4 time/level pairs, signed, bipolar around cutoff,
  scaled by EG Intensity. VDA EG: 7 params, unsigned, **no release level**. Pitch EG: no
  sustain, no break point, clamped to ±1 octave.
- **`lowpassCore`** — non-resonant TPT lowpass. Slope is undocumented; pick one and label it a
  choice.
- **`keymapCore`** — a 128×128 `uint16` table **per oscillator** (32 KB, branch-free).
- **`voiceAllocCore`** — pure state machine over **16 oscillator slots**. FluidSynth's published
  weights (released −2000, sustained −1000, age +1000/sec, volume +500) plus a **hard
  same-note-first rule** that runs before scoring. **DOUBLE claims two slots atomically** —
  allocating one and failing the other yields a half-voice, the worst outcome.

Then one `AudioWorkletProcessor` wrapping all of it, with near-zero `AudioParam`s and parameter
changes over `port.postMessage`.

**Done when:** you can play 16 voices from the on-screen keyboard and over Web MIDI, with no
clicks at loop seams, note-off, or voice steal.

> **Gate:** golden-buffer tests. Sample playback is fully deterministic — no PRNG in the signal
> path — so byte-exact render comparison is available here where SynthStack could only use
> spectral tolerance bands. Use the sharper tool. Plus explicit tests for the three click
> sources: loop seam, a ~5 ms minimum release clamp, and the 4 ms forced fade on steal.

**Outcome.** All gates met, all three click sources covered. Verified in the browser at 48 kHz
against the 32 kHz bank, not only in tests.

Three corrections to the specifics above, each recorded in `DECISIONS.md`: the steal weights
needed a **direction** (as written, age protects old notes and steals the one you just played)
and a **saturation** (unbounded age swamps the released/sustained terms entirely); and the
filter had to become a TPT **state-variable** filter, because a one-pole cascade with global
feedback cannot resonate at two poles — the first implementation shipped a resonance control
that only attenuated.

**Two bugs were found by measuring the running app, not by tests** — both in the seam between
correct components, which is where unit tests are blind: every synthesized multisound was silent
(the DWGS tables skipped `bakeSample` and lost their guard region with it), and envelope
resolution was tied to the host's block size. Hence the standing rule in `CLAUDE.md`: drive the
app and measure it before calling a phase done.

---

## Phase 3 — Program layer + panel UI · 2–3 · ✅ DONE

**Goal:** every one of the 143 program parameters editable, and audible.

**Starting from:** the engine already consumes a `ProgramConfig` (`voiceEngineCore.ts`) with
per-oscillator level, octave, interval, detune, cutoff, EG intensity, cutoff tracking, velocity
sensitivity and the three envelopes. What it is fed today is a deliberately flat placeholder
built in `engineBridge.ts` — instant attack, full sustain, filter open — which is the shape
`I17 Organ 2` itself uses. **Phase 3 replaces that placeholder, it does not extend it.** The
serializable `program.params` bag in `src/state/m1State.ts` is where the real values live, and
it already round-trips.

Build the parameter model straight from the **143-byte SysEx table** in the research — every
parameter, hex range, and the EG-time bitfield packing where enable and polarity are separate
bits, so `0` genuinely means disabled.

UI per `UI-SPEC.md`, in a **7:4 design-coordinate space** using SynthStack's `designToScreen`
transform with the 16:9 constants replaced.

**The `1`/`2` rule is the organising principle.** Every per-oscillator control appears twice and
the `2` copy greys out in SINGLE mode. Build **one** per-oscillator component, instantiate it
twice against the two halves of the parameter model, drive both from a single `enabled` flag
off `OSC MODE`. This halves the panel work and makes the halves structurally unable to drift.

**Two EG graph components, not one** — the VDF trace steps down to a release *level*; the VDA
trace falls to zero because there is no release level. That asymmetry is engine behaviour
showing through.

Ship the **`EASY` page as a curated subset** with `OSC`/`VDF`/`VDA` as deep-edit tabs beside it.
That pattern is what makes 143 parameters approachable.

**Watch:** VDF cutoff keyboard tracking of `0` means **100% tracking**, not none. It silently
affects every patch.

**Done when:** turning any control changes the sound; the state tree round-trips; disabled state
is designed, not bolted on (a third of the centre column greys in SINGLE mode).

> **Gate:** a data-driven test asserts every parameter's range and default against the SysEx
> table — the equivalent of SynthStack's `moduleData.test.ts`.

**Outcome.** All gates met. The table came off Owner's Manual **p.127** (TABLE 1) and is
cross-checked against **p.130** (TABLE 5, the same offsets grouped by edit page) and against
`preload/final.py`, the independently-validated factory decoder. **143 bytes, 139 parameters** —
the difference is the name, the 25-byte effect block, and six bytes that pack several
parameters each; pinned by test so the byte count is never read as a control count.

Three corrections to the specifics above. The `1`/`2` rule applies to the **data** as well as
the panel — the per-oscillator block is declared once with relative offsets and instantiated
at 63 and 103 — **but MULTISOUND and OCTAVE are the exception**: they are per-oscillator
controls living in the *common* block at 12/13 and 14/15, two apart, not +40. And the params
bag stores **display values, not bytes**, which hands Phase 6 its factory-bank importer for
free.

Making every parameter *audible* turned out to cost more than the panel did: the Phase 2
engine had nowhere for two thirds of the table to land. Two new pure cores (`mgCore` for the
program's two MGs, `modCore` for the modulation rules) plus centre keys, delay start, MONO,
HOLD, joystick and aftertouch. **AMP VELOCITY SENSE had to become SIGNED** — Phase 2 modelled
it 0..1, which silently deletes the M1's only velocity-crossfade technique.

**The strongest test in the phase is the audibility sweep**: one program with every modulation
live, then change ONE parameter and require the render to differ. 135 of 139 covered, four
skipped with reasons. It is the only test that catches a parameter which is in the table and
never reaches the engine — and it found two (`JS_PITCH_MG_FREQ`, `JS_VDF_MG_FREQ`, never
wired). A companion coverage test found a third failure of the same shape: the filter EG
section was declared and placed on no page.

Two pre-existing bugs fixed in passing: `render` double-counted the engine's frame clock, and
`voiceMessages.ts` restated every OscConfig field by hand so a new parameter could be dropped
in transit without a compile error.

---

## Phase 4 — Effects · 3–4 · ✅ DONE

**Goal:** the first real fidelity gate.

**Starting from:** `context.ts` reserves an `insertSlot` in the master chain specifically so the
effects section is a node swap rather than a refactor. Engine output is currently **mono** —
that is deliberate, since the M1's stereo image comes from this section and its reverbs are
mono-sum in / stereo out anyway. The `resonance` extension exists and defaults to 0; this gate
must pass with it there.

**The spec is already located, and it is complete.** Owner's Manual **p.129** prints `*11
EFFECT PARAMETER` in full: the 25-byte block layout, all 33 algorithms with their parameters
and ranges, and the quantization grids — including the piecewise LFO rate (`*11-3-2`:
0.03 Hz steps to 3.00, 0.1 to 13.0, whole Hz to 30). Read it from `pg/p129.png`; it is as
legible as p.127 was. `data/programParams.ts` already reserves bytes 38-62 so the record stays
143 bytes, and `preload/final.py` decodes that block: 38/39 are the two effect types, 40-43
the L/R balances, 44/45 the Output 3/4 pans, 46 the routing bitfield (bit4 = serial), 47-54
and 55-62 the two 8-byte parameter blocks.

33 algorithms plus `No Effect`. Four fewer implementations than it looks — the `I`/`II` variants
of Chorus, Flanger, Phaser and Tremolo are **one modulation block with a phase-invert bit**.

**Reproduce the quantization grids; do not smooth them.** Reverb time 0.1 s steps, E/R time
10 ms, EQ 1 dB, and a **piecewise** LFO rate — 0.03 Hz steps to 3 Hz, 0.1 to 13 Hz, whole Hz
above 14. Continuous floats sound wrong on every sweep.

Routing: **4 buses and a 2-effect matrix, not sends.** The `Panpot` parameter *is* the routing —
a 14-position discrete assignment. Serial/parallel is a single bit.

**Enforce the constraints rather than fixing them:** asterisked modulation effects cannot pair
with Symphonic Ensemble or Rotary Speaker (the hardware ran out of DSP); most effects leave
their EQ in circuit even when switched off; reverbs and ER are **mono-sum in, stereo out**,
which is why M1 reverb sits so centred.

Optional but cheap and high-value: model the **breathing noise floor** — the DAC is 16-bit plus
a 3-bit analog gain range, so quantization noise tracks signal level. That's what 1988 reviewers
heard as "graininess on drums."

**Done when:** hand-enter `I17 Organ 2` from the decoded parameters — Organ2 multisound, flat
filter and amp envelopes, Stereo Chorus 1 at depth 99 with EQ +12/+12, into a 3.5 s Hall — and
**A/B it against Robin S, "Show Me Love" (StoneBridge Mix)**.

> **Gate:** this is the fidelity gate. Its filter and amp envelopes do nothing, so 100% of the
> character is sample + chorus + EQ + hall. If it doesn't match, the problem is unambiguous.
> Korg's own emulation had wet levels globally too hot — SOS had to drop reverb from 18 to 13.
> **Measure, don't eyeball.**

**Outcome.** All 33 algorithms plus Through, the two-slot matrix, the routing bit and the panel
page. Engine output is now **stereo**. 908 unit tests, typecheck, build and bank build clean.

The spec was where PLAN.md said, and **checking it mattered more than finding it**. Two further
sources carried things p.129 does not: the M1R manual's **pp.56-57 default-values chart** (the
official names, every default, and the asterisks behind the pairing rule) and **Korg's own
factory bank**, now histogrammed by `npm run probe:effects`. The data settled three questions
p.129 left ambiguous — the type byte is the effect number **minus one**, MG-Status bit1 is
**editable data** and is what separates the `I`/`II` variants, and for the dual algorithms
26-33 a slot's two balance bytes are the two **halves'** dry:wet rather than a left/right pair.
Each is recorded with its evidence in `DECISIONS.md`; the last two split the factory bank
51-of-54 and 196/196-vs-4/4 respectively, so none of them is a judgement call.

**PLAN.md's own description of the gate patch was wrong in four audible ways**, which the
decoded record corrected: `I17 Organ 2` is at **16'** not 8', **level 30** not 70, **cutoff 70
with tracking 0** not wide open, and amp release 4 not 25. Its envelopes do nothing, as stated —
but a patch built from "defaults plus Organ2 plus effects" would have missed all four, and
Korg's low oscillator level is what keeps a 60%-wet chorus with +12/+12 EQ inside headroom.

Measured, extensions off: **RT60 3.61 s against a 3.5 s setting**, decay linear in dB across
3 s; **stereo correlation −0.06** from a mono source; four-note chord peaks 0.72 pre-master.
**The listening half of the gate is not closed** — the A/B needs the recording, which the
session could not obtain. A normalised 7.17 s WAV of the patch was rendered so it can be done
by ear; if it misses, `DECISIONS.md` names the two constants to move first.

**One bug that 900 tests could not see, found by driving the app**: grid-snapping silently
rewrote `PHASE '180'` to `'0'`, turning every `I` variant into its `II` — because encode
returned a bit VALUE where decode read a bit POSITION, and only the snapper round-tripped
through both. Fixed by making them exact inverses, and the test added asserts the general form
(snapping is identity and idempotent for every parameter of every algorithm) rather than the
instance.

---

## Phase 5 — Combinations · 1.5–2

**Goal:** the workstation layer.

**Starting from:** the allocator already models the pool the way this phase needs — 16 slots,
atomic DOUBLE claims, per-slot channel — so "no per-program limit, but never more than 16 total"
needs no new mechanism, only eight timbres pointed at the same `allocate`. `voiceAllocCore`
already keys note-off and sustain by channel.

**Five Combination types**, not one: `SINGLE`, `LAYER`, `SPLIT`, `VELOCITY SWITCH`, `MULTI`.
Only MULTI exposes the 8-timbre matrix, and the other four have their own edit pages and SysEx
offsets — they are not UI subsets.

Per timbre: program, MIDI channel, key window, velocity window, transpose, detune, output level,
and the 14-position panpot bus assignment. Windows are independent and additive — any timbre
whose key window, velocity window and channel all match will sound.

Allocation is **dynamic and unreserved** across all 8 timbres against the same 16-slot pool.
Nothing is protected. Authentic detail worth keeping: the metronome costs a slot.

UI: the 8-row timbre strip from `UI-SPEC.md` — `SOLO`/`MUTE`/`IFX`/`▼`, name field, `LEVEL`
with slider, `PAN` with rotary, `OUT` dropdown, and a green edge bar marking the selected row.

**Watch:** MIDI filter polarity is **inverted** — OFF means receive, ON means block.

**Done when:** an 8-timbre combi plays with working splits and velocity switches, and voices
steal sensibly under load.

**Outcome.** All done, and measured in the running app rather than only in tests. 1070 unit
tests plus a rebuilt Playwright layout audit; typecheck, build and bank build clean.

The table came off Owner's Manual **p.128 (TABLE 2)**, cross-checked against **p.131 (TABLE 6)**
and against Korg's own 100 factory combinations, now histogrammed by `npm run probe:combis`.
**The round trip is 100/100 byte-exact.** As in Phase 4, checking the spec mattered more than
finding it — the data corrected the plan and the manual in three places:

- **TABLE 6's footnote `*14` is NOT a byte offset.** Read literally it puts the split point at
  byte 68; the factory bank shows byte 68 is timbre 3's TIMBRE-OFF bit and the real split point
  is a **contiguous pair of key windows**. The literal reading would have given every factory
  SPLIT a split point of E0.
- **The MIDI filter polarity is NOT inverted.** PLAN.md's warning is real but points one field
  to the left: the four CONTROL FILTER bits are `0:DIS, 1:ENA` (set in 96-99% of 800 factory
  timbres), and the inverted one is TIMBRE ON/OFF in the next byte.
- **`TIMBRE.INST` bit7 is not the drum-kit flag.** Set on 2 of 800 timbres, zero overlap with
  the 11 that point at a drum program. Carried verbatim, not modelled.

The allocator needed exactly one new mechanism, and not the one this plan predicted: the
16-slot pool needed nothing, but the **same-note-first rule needed a timbre term** — Korg puts
all 800 factory timbres on channel 1, so without it every LAYER collapsed to one sound.

**The panpot law was settled by measuring, after arguing got nowhere.** A sum-preserving law
made a SINGLE combination exactly 6 dB quieter than the same program in Program mode; the
manual says Program mode *is* 5:5, so the centre must be unity. The law is now ratio-preserving
and peak-normalised, verified at ratio 1.010 against Program mode and 0.111 for `9:1`.

Measured with L/R balance as the detector — after a peak-bin pitch read reported the 1st and
3rd harmonics for two notes an octave apart, which is the fourth time a weak metric has given a
confidently wrong answer here. SPLIT and VELOCITY SWITCH switch exactly at their boundaries,
LAYER sums both timbres, 24 notes into the 16-slot pool stay finite and return to exact
silence, and a timbre on C+D reaches effect 2 in PARALLEL at correlation 0.868 — silent with
the Output 3/4 pans OFF, which is the hardware.

---

## Phase 6 — Browser + factory bank · 1–1.5

**Goal:** the instrument becomes usable, and the acceptance test runs automatically.

Decode Korg's preload SysEx (`preload/final.py` already works) and import **100 programs and
100 combinations**. Programs are 100 × 143 bytes at offset 13261; combis 100 × 124 at 861.

Then the browser modal per `UI-SPEC.md`. The parts that matter:

- **Live faceting** — any INSTRUMENTS tag that would return zero results greys out and becomes
  unselectable. This is what makes the grid self-teaching.
- **Two 4×4 tag grids**, with CHARACTER's row-2 slots 3–4 swapping with the COMBI/PROG tab.
- **`APPLY` applies without closing** — the audition-and-keep-browsing button.
- **Horizontal card paging**, 5×10 = 50 per page = exactly one card's capacity.
- **Blue accent, not lime.** Lime is editing, blue is browsing. Mode-signalling by hue.
- **No text search.** It's a deliberate omission, not an oversight — don't "improve" it.

**Done when:** you can browse by tag and by card and load any of the 100 factory programs.

> **Gate:** the fidelity test from Phase 4 now runs from the *decoded bank* rather than by hand.
> Add `I01 Piano 16'` (keyboard tracking, the 5/10 ms full-wet doubler) and `I00 Universe`
> (DOUBLE-mode layering, asymmetric 247/414 ms delay) as the second and third checks.

---

## Phase 7 — Sequencer · 2–3 · **decide after Phase 6**

8 tracks, 10 songs, 100 patterns, 48 PPQ, 250 measures per track, real-time and step recording,
quantize, event edit.

**Three reasons to skip it**, worth weighing honestly once Phases 0–6 are real:

1. It is the largest and **least M1-specific** chunk — a generic MIDI sequencer.
2. You already own three: another local project's editable canvas piano roll with `quantizeNotes`, another local project's
   session grid with `.mid` import, and a MIDI pattern builder. A commercial DAW is on the PC.
3. **The reference plugin dropped it entirely.** Korg's own software M1 has no sequencer — the
   host sequences it.

The counterargument is real: if the appeal is the *one-box* experience, the sequencer isn't
redundant, it's the point. That's a taste call, and it's better made with a working instrument
in front of you than now.

It is cleanly severable either way — sequencer tracks are fully independent of Combinations,
with their own program, level, transpose, detune, pan and channel per track.

---

## Standing rules across all phases

- **Commit discipline:** one branch per phase; append to `DECISIONS.md` with a date whenever a
  choice is made that a later session would otherwise have to re-derive.
- **Verification floor:** unit tests green, typecheck clean, build clean before a phase closes.
  The offline audio battery grows each phase.
- **Label the guesses.** Filter slope, the EG time→seconds curve, the voice-stealing rule, the
  sample rate, and the factory drum-kit mappings are **undocumented**. Mark them in code as
  choices, not M1 facts, so nobody later mistakes them for verified behaviour.
- **Extensions default off.** Resonance and insert FX are plugin-era additions. The Phase 4
  fidelity gate must pass with them off.
