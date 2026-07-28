# Decisions

Append-only, dated. Record the *reason*, not just the choice — the reason is what tells a
future session whether the decision still holds.

---

## 2026-07-27 — Planning

**New project, not a voice inside SynthStack.**
Verified by reading the code, not the docs: `src/engine/voice/monoVoice.ts` is design-locked to
last-note-priority mono for Mother-32 fidelity, `DECISIONS.md` there records that as deliberate,
and an exhaustive grep found **zero** polyphony, voice-pool, or voice-stealing prior art. Its
DSP cores are oscillator-based — nothing reusable for multisample playback. Its identity is
Moog semi-modular with a patchbay; the M1 has no patchbay.

**Fork SynthStack for the shell; delete its engine in one commit before writing any M1 code.**
A lazy gut leaves patchbay scaffolding that quietly shapes the voice code. Fork the *working
tree*, not HEAD — the uncommitted PC-only UX pass touches exactly the files worth inheriting,
and the full 1304-test suite passes green on the dirty tree.

**No DAW/VST3 plugin target.** It would mean C++/JUCE, discarding the entire shell and trading a
fast browser loop for compile-and-validate. Keeping DSP in pure `*Core.ts` with no Web Audio
types preserves a future port at zero cost today, so the option isn't lost.

**TypeScript, not a C++/WASM core.** Follows from dropping the plugin: a shared core is only
worth its toolchain tax if the native target is a firm commitment. SpessaSynth is the existence
proof — a full SF2/SF3/DLS synth in an AudioWorklet in pure TS. Measured, this engine uses
~4–14% of the render budget; WASM would buy ~2–3×, not 10×.

**One `AudioWorkletProcessor` owning all 16 slots.** `AudioBufferSourceNode` is disqualified
four ways: `playbackRate`/`detune` are k-rate (375 Hz updates, audible under the M1's fast pitch
EG); its resampler is unspecified and browser-dependent, so patches would sound different per
browser; it cannot crossfade a loop; and 32 streams would churn ~400 nodes at note rate. One
node also gets the whole 2.67 ms quantum instead of 1/16th of it.

**Model polyphony as 16 oscillator slots, not 16 voices.** SINGLE/DRUMS costs 1, DOUBLE costs 2.
That single rule reproduces 16/8 in Program mode *and* the Combi constraint ("no per-program
limit, but ≤16 total") with no special-casing.

**FluidR3_GM (MIT) as the sample spine.** 1,418 samples with loop points on 100% of them,
already multi-rate, and it covers choir — otherwise the hardest family to source freely.
Upgrade selectively with CC0/CC-BY sets. Hard-avoid: Arachno (contains actual Korg M1 ROM
samples), Philharmonia and Pianobook (both forbid redistribution as a sampler instrument),
SGM-v2.01 (orphan work with fake licenses circulating).

**~32 kHz as a tunable constant, not a fixed rate.** Two independent derivations bracket it —
~31.2 kHz from PCM-card capacity, and ≤32,768 Hz from the effects RAM, where 32.768 makes 500 ms
exactly 2¹⁴ words. Neither is a Korg spec. The band-limiting *is* the M1 sound, so this is a
character control, not a budget one.

**Spend the removed size ceiling on coverage, not fidelity.** All 144 waveforms and denser key
zones, rather than higher rates or longer samples. Denser zones keep the pitch ratio near 1.0,
which matters more than interpolation quality — no polynomial interpolator fixes aliasing when
pitching up. Do **not** add velocity layers: a multisound has none, architecturally.

**Hardware engine, plugin UI, extensions default off.** The reference UI shows `RESONANCE` and a
two-slot `INSERT FX` rack; the hardware has neither. Korg's own plugin ships resonance as an
opt-in switch that defaults off so factory presets reproduce the original. Copy that.

**Factory bank in the Cache API; user samples in IndexedDB.** IndexedDB deserializes on
retrieval and is the wrong home for large blobs. `sampleStore.ts` keeps its IndexedDB backend
for user samples only.

**4-point cubic Hermite interpolation.** 19 ops, 44 dB at 4× versus linear's 34. What sfizz and
SpessaSynth both use.

## 2026-07-27 — Name

**`BorgM1`. Decided, closed.**

Noted at the time that it keeps the real model number and sits one letter from the
manufacturer, which is a visible break from the sibling project's convention of scrubbing
manufacturer names to cover names. Will's call, made with that context. The **no-trade-dress**
rule still stands and is the part that actually matters: original artwork only, no logos or
copied silkscreen, and `FILTER`/`AMP` in the UI rather than Korg's `VDF`/`VDA`.

### Open

- **The sequencer** (Phase 7). Decide after Phase 6 ships.
- **User-bank tagging.** The 2005 manual says the WRITE dialog tags saved sounds for search;
  Sound On Sound says there's no way to tag user-bank sounds. Settle against the running plugin.

### Undocumented — these are choices, not M1 facts. Label them as such in code.

Filter slope in dB/oct · the EG time 0–99 → seconds curve · the voice-stealing rule · the exact
sample rate · factory drum-kit note mappings.

---

## 2026-07-27 — Phase 0: fork, gut, scaffold

**The fork-point warning is stale, and that's good news.** BRIEF and PLAN both insist on
forking SynthStack's *working tree* rather than HEAD, because ~12 uncommitted files on
`feature/pc-only-ux-pass` held the raised control fonts and the mobile strip. Since those docs
were written that pass landed as `805208b` and merged: `git diff main feature/pc-only-ux-pass`
is empty and the tree is clean. Forked `main @ c480acf`, which *is* the tree the brief wanted.
Nothing in the source repo was modified — it stayed read-only throughout.

**Four commits, gut isolated in one.** Seed docs → verbatim import of all 219 tracked files →
**the gut, alone, 164 files and 39,919 deletions** → rename/port → scaffold. Keeping the import
verbatim makes the gut commit a reviewable record of exactly what SynthStack offered versus
what BorgM1 kept. Nothing that runs was written before the gut landed.

**Three deliberate departures from the BRIEF keep-list, all toward a more thorough gut.** The
brief's list was written before anyone read these files closely; the instruction that outranks
it is *"a lazy gut leaves scaffolding that quietly shapes the voice engine later."*

- **`engine/modules/sampler.ts` — deleted, though the brief kept it.** It extends `ModuleBase`
  (patchbay scaffolding), is built on `AudioBufferSourceNode` — which the same brief
  disqualifies four ways for this engine — and is written throughout in the `vv` convention
  the gut exists to erase. Keeping it would have contradicted three separate rules to save
  179 lines of code for an architecture we rejected.
- **`ui/keyboard/*` — deleted**, not on the keep-list. `keyMap.ts`, the keybed geometry
  primitive the brief *did* list, survives. `KeyboardPanel` was 690 lines wired to the Moog
  store and the 16:9 stage.
- **`devharness/` + `test/audio/` — deleted.** The brief says steal the offline-battery
  *structure*; the structure is a documented pattern (a dev-harness route renders results as a
  JSON blob, a ~10-line Playwright spec reads it back), not those files, and Phase 2 rebuilds
  it around golden buffers. The pattern is recorded in `playwright.config.ts` so it isn't lost.

**`PresetPicker.tsx` kept, but dependency-injected.** The brief calls it copy-verbatim on the
grounds that it has "zero knowledge of modules/jacks" — true, but both its imports
(`engineBridge`, `factoryPresets`) went with the gut, so verbatim was impossible. It now takes
a `SetupBridge` prop. The real prize was its test: a hand-rolled React dispatcher that renders
a component in plain Node with no jsdom and no new deps. That now lives in
`test/helpers/renderComponent.ts` where Phases 3–6 can all use it. **This is not the Phase 6
browser** — UI-SPEC specifies a different surface (two 4×4 tag grids, live faceting, card
paging, APPLY-without-closing). This stays the user-setup save/load overlay.

**Design box is 1400×800, not 1200×683.** UI-SPEC measures the reference plugin at 1.757:1 and
gives every figure as a percentage, so the design box only has to be the right *shape*.
1400×800 is exactly 7:4, and 1% of the window lands on a whole 14 × 8 px — so the spec's
percentages convert with no accumulating rounding. `pctRect(l,t,w,h)` takes percentages
directly, making Phase 3's transcription a copy rather than a conversion. No REGIONS authored
yet; that is Phase 3's job and nothing here presumes it.

**Two inherited bugs fixed in passing, both convention violations:**

- **`pcmTap.worklet.ts` hardcoded `BLOCK = 128`.** CLAUDE.md forbids it and Chrome M153's
  `renderSizeHint` will break it — a 256-frame quantum would have silently dropped half of
  every recorded block. Slots now size from the actual input length and re-size only on change,
  so the steady state still allocates nothing beyond the forced post-transfer realloc. A
  256-frame test covers it and fails on the old code.
- **`fillWhiteNoise` defaulted its PRNG to `Math.random`.** That is a nondeterminism leak
  pointed straight at Phase 2's golden-buffer tests, which are only possible *because* sample
  playback is deterministic. The rng argument is now required; `src/engine/rng.ts` ships seeded
  `mulberry32`.

**`MAX_SAMPLE_BYTES` 4 MiB → 64 MiB, and the store's scope narrowed in writing.** 4 MiB was
sized for drum one-shots; a user importing their own multisample hits it on the first file
(5 minutes of 16-bit stereo 44.1k is ~52 MB). The cap now exists to catch a mis-drag, not to
ration space. The file header states outright that this is **user samples only** — the factory
bank goes in the Cache API, and a future session should not widen this store to hold it.

**`getState()` deep-copies through the JSON codec, deliberately not `structuredClone`.** The
JSON round trip is the invariant the tree must satisfy, so cloning through it means any value
that would not survive serialization fails loudly on every read rather than silently at save
time. `structuredClone` would happily carry a `Map` or an `Infinity` through and hide the bug
until a bundle was written.

**Extensions coalesce to OFF, never ON.** A tree that predates an extension, or carries junk in
its place, must not silently enable a feature the 1988 hardware never had — that would break
the Phase 4 fidelity gate quietly, which is the worst way for it to break. Pinned by test.

**Coalesce ORDERS an inverted key or velocity window** rather than trusting it. An inverted
window silences a timbre with no visible cause, which is the most confusing possible way for a
Combination to "not work".

**State tree shape settled now, contents later.** `mode`, `master`, `keyboard`, `extensions`
plus program/combi shells. Phases 3 and 5 fill `program.params` (143-byte SysEx table) and
`combi.timbres` (124-byte table) by *extending* this tree, not replacing it. `STATE_VERSION`
bumps only on a breaking shape change; additive slices don't.

**`vv` is gone from `src/` and `test/`.** Surviving hits are prose in `docs/` describing the
instruction to remove it, plus base64 coincidences in `package-lock.json`. Moog machine names
(Monarch/Anvil/Cascade/Courier) are gone from code and test fixtures too; the remaining
"SynthStack" mentions are provenance comments recording where a kept file came from and what
was cut from it, which are worth keeping.

**Phase 0 gates, all verified:** `npm run dev` serves the shell on **5184** (`strictPort`, so a
collision fails loudly instead of drifting to 5185) and the stage renders at exactly 1.75 with
no horizontal scroll · `npm test` **169 green across 13 files** · `npm run build` clean, base
path `/BorgM1/` · `npm run typecheck` clean · the JSON round-trip test exists from day one, 21
cases, not retrofitted.

---

## 2026-07-27 — Phase 1: sample pipeline

**Both sound lists are recovered and pinned.** 100 multisounds and 44 drums, transcribed from
the Owner's Manual and cross-checked across four OCR passes of two scans. Both lists are
printed *twice* in the manual in different layouts, which resolved the two OCR ambiguities
without circularity: `68 BasThumNT2` (one pass duplicated NT1) and `76 VoiceWvNT2` (lowercase
`t`). The decoy drum list in the overview section is avoided and a test asserts its names never
appear. **`NT` is confirmed from the manual, not inferred** — "(NT) = same pitch regardless of
key played", i.e. No Tracking, a fixed-pitch flag.

**`sharesSampleWith` is declared data, not derived from names.** An NT multisound is the same
ROM sample with tracking off, so the build must not source a second sample for it — an
independently sourced one would make the pair audibly different where the hardware's are
identical. The LCD abbreviations defeat any name heuristic (`DistNT`→`Distortion`,
`BasThumNT1`→`BassThumb`, `VoiceWvNT1`→`VoiceWave`) and a match loose enough to catch them
would pair unrelated sounds. Useful consequence: **only 63 of the 100 multisounds need a sample
sourced** — 14 are NT references, 23 are the computed DWGS block.

**Indexing is deliberately non-uniform.** Multisounds are 0-based, drums are 1-based, exactly
as the manual prints them and as the SysEx values run. Pinned by test so nobody "fixes" it.

**The bake order is the load-bearing decision:** rebase → resample → normalize → crossfade →
truncate+guard → int16. Each step consumes signal a later one needs. Truncating early is the
tempting optimisation and it is a bug: the resampler kernel and the crossfade read window both
reach past `loopEnd` into the release tail, so cutting first makes both read zeros and puts a
notch at exactly the seam the pipeline exists to protect.

**Crossfade is equal-GAIN, not equal-power. Labelled a choice, not an M1 fact.** The two
blended regions are the same tone one loop-period apart, so they correlate, and a sin/cos pair
bulges up to +3 dB mid-fade — heard as a swell at exactly the loop rate.

**Loop LENGTH is scaled, not the end point.** Rounding both loop points independently lets the
length drift a sample; length is the pitch-critical quantity, so the error lands as ~8 cents of
detune on the sustain only, appearing the moment a note reaches its loop. Swept 1600 cases: the
invariant always holds, the naive form drifts on 100+ of them.

**Int16 scale is 32767, not 32768.** Scaling by 32768 puts +1.0 on a code that does not exist;
it wraps to −32768, inverting a full-scale positive peak into a full-scale negative one — the
loudest possible click, on precisely the samples most likely to reach 1.0.

### Measured against the real FluidR3_GM, not assumed

`scripts/probeSf2.ts` exists to answer these from the file rather than from documentation. Both
answers change the extractor.

- **`spessasynth_core` already rebases loop points.** They are relative to each sample, not
  absolute into the global `smpl` chunk. **Do not subtract `dwStart` again** — the extractor
  passes `dwStart: 0`. (`rebaseLoop` stays in `loopCore` for a future raw-RIFF path, and
  because it documents the trap.)
- **`loopEnd` is EXCLUSIVE**: loop length = `loopEnd − loopStart`. This matters because
  **spessasynth_core's own docs contradict each other** — the field comment says exclusive, the
  constructor's `@param` says inclusive. Measured by periodicity (under a period *L*, the
  window before `loopStart` must match the window before `loopEnd`): **1013 exclusive vs 66
  inclusive** across 1094 samples, mean mismatch ratio 4.0. Agrees with the SF2 spec.
- **A weak metric gave a confidently wrong answer first.** Comparing single samples either side
  of the wrap by value said INCLUSIVE, 858 to 366. Two adjacent samples on a smooth waveform
  are nearly equal, so that test measures which one happens to sit closer in value, not which
  one precedes the other. Worth remembering the next time a cheap check looks decisive.
- FluidR3_GM: 189 presets, 193 instruments, 1418 samples, **100% of them looped**. Rates are
  mostly 44100 (817) and 32000 (328) — 328 already sit at the target rate and pass through the
  resampler as a copy.

**The SF2 is not vendored.** 141 MB for a file the app never loads (it loads the *built bank*).
`scripts/bankConfig.ts` resolves it from `BORGM1_SF2`, then `assets/`, then a sibling project's
copy — read-only.

### Building the bank

**One blob, not hundreds of files.** `bank.pcm` (all samples, Int16LE, concatenated) plus
`bank.json` (keymap + per-sample offset/length/loop/root/tuning). The factory bank belongs in
the Cache API, and one entry fetched once beats ~600 conditional requests. Result: **50 MiB,
479 distinct samples, 594 key zones, 100/100 multisounds, 44/44 drums.**

**Zones are inherited, not invented.** For each source preset the builder walks all 128 keys
asking the SoundFont which sample would sound, and groups runs that answer the same. That
reproduces FluidR3's own zone boundaries (typically 9 per instrument) instead of guessing them
— and dense key zones are exactly where the absent 1988 size ceiling is worth spending, because
keeping the pitch ratio near 1.0 matters more than interpolation quality.

**GM program numbers, not FluidR3 internals.** Every entry in `data/sourceMap.ts` names a
General MIDI program, so swapping in a better-sourced SF2 later is a config change.

**`approx` is an upgrade shortlist, not an apology.** 39 multisounds and 12 drums are marked
it: GM simply has no slot for `Lore`, `PanWave`, `FvWave`, `MvWave`, `Wire`, `Rhythm` — M1
synthesised textures — or for one-shot percussion like `Pole`, `Drop`, `Pop`. Each maps to the
nearest timbre and is flagged, so once the instrument is playable it is possible to hear which
substitutions actually hurt and re-source only those. A test asserts the *core* instruments
(pianos, organs, flute, choir, strings, trumpet) are NOT flagged, or the list would be noise.

**The three kicks come from three different kits** (Standard / Room / TR-808), and the two
hi-hat pairs from two. Sourcing `Kick1/2/3` from one kit three times would give three identical
kicks where the M1 has three distinct ones. Pinned by test.

**DWGS 77–99 are rendered additively, not sampled — and that is authentic.** DWGS was Korg's
*Digital Waveform Generator System*: stored harmonic amplitude tables, summed. Doing the same
here means the method is right even though the tables are ours. Three further benefits: the
result is band-limited by construction (no partial above Nyquist is ever created, so there is
nothing to alias), the loop is seamless by construction (the table IS exactly one period), and
it runs in plain Node where there is no `OfflineAudioContext`.

**256 samples at 32 kHz = 125 Hz = MIDI 47 + 21 cents.** An integer table length is what makes
the loop exact; the odd root pitch is the price and is carried in the manifest. A test pins all
three constants together, since moving one without the others detunes every synthesized sound.

**Six DWGS tables are exact, seventeen are authored.** The geometric waves have closed-form
Fourier definitions and are exactly right. Everything named `DWGS <instrument>` is an
approximation of a timbre Korg never published — flagged `exact: false`, and a test requires
each to carry a note explaining where its shape came from. **Label the guesses.**

### The gate runs on the build, not only on fixtures

`buildBank.ts` measures loop-seam continuity on **every looped sample it emits** and fails the
build if any exceeds the limit. A unit test proves the algorithm is right on fixtures; this
proves the actual output is right on the actual data. Currently **451/451 pass**.

**The gate caught a bug in itself first.** The initial metric normalised the wrap step against
the steepest step in the loop's last 64 samples, and failed the square, saw and comb tables —
all of which are periodic by construction and therefore *cannot* click. A square wave is flat
across most of its cycle and steps rail-to-rail once, so a tail-only window usually misses that
edge, under-reads the waveform's natural step size by orders of magnitude, and calls an exact
loop broken. Fixed by scanning the whole loop. The question the metric asks is "is the move at
the wrap unusual **for this waveform**?", and that only works if the scale comes from the whole
waveform.

---

## 2026-07-28 — Phase 2: voice engine

**Sixteen oscillator slots, not sixteen voices — one rule, everywhere.** SINGLE and DRUMS cost
one, DOUBLE costs two. That gives 16-voice single and 8-voice double from the same pool, and
will give Combinations their "no per-program limit, but never more than 16 total" with no
special-casing anywhere else. **DOUBLE claims both slots or neither**: a half-voice is one
oscillator of a two-oscillator patch at the wrong level and the wrong timbre, which is worse
than dropping the note.

**Same-note-first is a hard rule that runs before any scoring**, not a weight. No weighting can
express "this is the same note". Without it a trill against long release tails stacks a fresh
copy per retrigger until 16 slots hold 16 copies of two notes; the test plays 40 such events
and asserts the pool never exceeds two.

**Steal weights are a CHOICE, not a measurement** — the M1's rule is unpublished. FluidSynth's
are a defensible starting point. Two corrections were needed:

- **Direction.** PLAN.md lists the age term as "+1000/sec" without stating a sign convention.
  Read literally under keep-the-highest it protects old notes and steals fresh ones — the note
  you just played is the one that goes silent. Implemented so age *increases* stealability.
- **Saturation.** Unbounded age swamps everything: a pad held 5 s scored 5000 and outranked a
  note released an instant ago at 2000, so the still-sounding pad was stolen and the fading one
  spared; past ~10 s only age mattered at all. Age now saturates just under the `sustained`
  weight, restoring released > sustained > held with age ordering *within* a state — while
  keeping the published 1000/sec as the slope near zero, where it actually discriminates.

**ONE envelope configured three ways, not three classes.** The filter EG releases to a *level*
and the amp EG to zero — that asymmetry is why UI-SPEC calls for two EG graph components, and
modelling it once here is what keeps them honest. **Release is clamped to a 5 ms floor**: a
release time of 0 is a reachable parameter value, not an edge case, and an instant drop to zero
clicks on every note-off.

**The filter is a TPT state-variable, not a cascade of one-poles — because resonance could not
resonate.** A one-pole cascade with global negative feedback cannot produce a peak at two poles;
the loop needs 180° of phase shift, which takes four. The first implementation shipped a
"resonance" control that only ever attenuated. An SVF resonates correctly at 12 dB/oct, and
`k = 2` (critically damped, monotonic, no peak anywhere) is resonance-off — so the extension
genuinely defaults to the hardware's signal path, which the Phase 4 gate depends on.

**Determinism is a feature, deliberately preserved.** No PRNG and no wall clock in the signal
path; time arrives as a frame count. That is what lets the Phase 2 gate be a **byte-exact**
render comparison rather than a spectral tolerance band — a band would pass a change that
shifts every sample by half a bit, and the exact test does not. A single `Math.random` for
"analogue drift" would cost the sharpest test in the project.

### Two bugs the browser found that unit tests could not

**All 23 synthesized multisounds were silent.** The DWGS tables skip `bakeSample` — there is
nothing to resample and the loop is already exact — and skipped the **guard region** with it. A
256-sample table with `loopEnd` 256 makes the 4-point interpolator read `data[256]` and
`data[257]` off the end: `undefined`, then NaN, then silence. Every unit-test fixture went
through `bakeSample`, so nothing caught it. One spectral measurement in the page did, because a
pure sine read a centroid of 0 Hz. Fixed **at the source** (`renderRecipe` emits the guard, so
no caller can forget), plus a build-time invariant and a test that renders every recipe through
the real player.

**Envelope resolution was tied to the host's block size.** Advancing envelopes once per render
quantum made the same 1 ms attack a 4 ms ramp at 128 frames and a 32 ms ramp at 1024. CLAUDE.md
already forbids reading the quantum as 128; this is the same rule applied to the *control* path.
The engine now subdivides into fixed **32-frame control blocks**, and a test asserts 8×128 and
1×1024 agree.

**The lesson worth keeping:** both bugs were in the seam between correct components, which is
exactly where unit tests are blind. Measuring the real graph in the page is not a nicety at the
end of a phase — it is the only thing that tests either of these.

### Wiring

**The bank goes in the Cache API and converts to float once at load.** IndexedDB deserializes on
retrieval, so it would pay a full structured-clone pass on every open of a 50 MiB blob.
Converting Int16→float once costs 100 MiB resident and buys removing a multiply and a type
conversion from the innermost loop of the engine, for every voice, forever. PC-only target;
memory is cheap, the render budget is not.

**PCM is transferred to the worklet, not cloned**, and programs then carry only offsets — so a
program change moves two 32 KB keymaps rather than 100 MiB of audio.

**`process()` is wrapped and returns true even on a throw.** An uncaught throw there silences
the node permanently, with no error and no recovery. The guard is the difference between one bad
block and a dead instrument.

**Verified in the browser, at 48 kHz against a 32 kHz bank:** one note peaks 0.56, a four-note
chord 1.19, release returns to exact silence and frees the slot, 20 notes into a 16-slot pool
steals cleanly with every sample finite, DOUBLE claims two slots per note. The sine's centroid
landing on 268 Hz for note 60 (C4 = 261.6 Hz) validates the whole pitch chain end to end.

---

## 2026-07-28 — Phase 3: program layer + panel UI

### The table is recovered, and it cross-checks against itself

**TABLE 1 is on Owner's Manual p.127, not p.128.** The 143-byte Program Parameter table was
transcribed from `pg/p127.png` in the research payload — a clean scan, fully legible, no OCR
needed. The djvu/OCR text layers interleave its two columns and are unusable for this; the
image is the source. p.128 is Tables 2-4 (Combination / Global / Sequencer).

**Every offset is confirmed twice, from two independently-printed tables.** Manual p.130
prints **TABLE 5, "PROGRAM PARAMETER PAGE, POSITION -> OFFSET"**, which lists the same
offsets a second time grouped by edit page rather than by byte. Both agree on all 143. That
is why the transcription is trustworthy without a third pass: the manual checks itself. A
third, fully independent check exists in `preload/final.py`, the factory-bank decoder
validated 20/20 against predicted multisamples; `programParams.test.ts` asserts the table
against the 17 offsets that decoder reads.

**143 BYTES, 139 PARAMETERS.** The gap is the 10-byte name (one field), the 25-byte effect
block, and six bytes that pack several parameters each. `PLAN.md` says "143 parameters"
throughout and that is a byte count — pinned by test so nobody later takes it as the control
count and concludes four are missing.

**The params bag stores DISPLAY values, not bytes.** The table owns `encodeParam` /
`decodeParam`, so the byte layout lives in exactly one place. The payoff is Phase 6: Korg's
preload is raw bytes, so `decodeProgram` is already the importer, written and tested a phase
early at no extra cost.

**The per-oscillator block is declared once and instantiated twice.** Manual p.127 says
"103 SAME AS OSC-1(63~102)" and the code says the same thing: `OSC_BLOCK` carries offsets
RELATIVE to its base and `oscBlock(1|2)` places it. The `1`/`2` rule is not only a UI
principle — applied to the data it makes the two halves structurally unable to drift, and a
test asserts every OSC-1 parameter has an OSC-2 twin at exactly +40.

**Except MULTISOUND and OCTAVE, which are NOT at +40.** Bytes 12/13 are oscillator 1's and
14/15 are oscillator 2's — per-oscillator controls that live in the *common* block, two apart
and interleaved. The +40 rule does not reach them, and applying it there would read the pitch
EG as a multisound number. Found by the test, which is why it is now pinned separately.

### Two traps, and they point in opposite directions

**Confirmed from the manual, verbatim: VDF cutoff keyboard tracking of 0 means 100%
tracking.** Manual p.27: *"The change of Cutoff and the change of pitch are equal when set to
0."* `lowpassCore.keyboardTrackingRatio` already had this right and was left alone.

**Unresolved, and deliberately left alone: what NEGATIVE cutoff tracking should do.** The
same page says *"The opposite occurs when setting to '-'"*, which reads as an inverted slope
— cutoff falling as pitch rises. The current mapping (`amount = 1 + tracking/99`) instead
reaches *no* tracking at -99 and never inverts. The accompanying diagram is ambiguous: it
shows the `<0` line shallower than `+0`, not obviously descending. Both readings are
defensible from the page. **Left as-is**, because changing it would move every patch on one
sentence's reading and would perturb the golden buffers; flagged here so the Phase 4 A/B
against a real recording can settle it with evidence rather than argument. A LABELLED GUESS,
not a verified behaviour.

**EG-time tracking of 0 genuinely IS off, and that asymmetry is the trap.** Bytes 99-102 each
hold four three-state switches where the ENABLE and the POLARITY are separate bits four apart
(manual p.127 note *1), and pp.26-27 say *"with 0 having no effect"*. So two parameters that
read almost identically on a panel mean opposite things at zero. Both are documented at their
definitions in `modCore.ts`, together, because the danger is precisely that someone tidies one
to match the other.

### Making every parameter audible cost more than the panel did

Phase 3's done-criterion is "turning any control changes the sound", and the Phase 2 engine
had nowhere for two thirds of the table to land. Added as pure cores: **`mgCore`** (the two
program-level MGs — Korg's name for the LFO) and **`modCore`** (EG-time scaling, signed amp
velocity, amp keyboard tracking). Extended in `voiceEngineCore`: centre keys, delay start,
MONO and HOLD, joystick and aftertouch inputs.

**AMP VELOCITY SENSE is SIGNED, and the sign is load-bearing.** Byte 89 is `9D~63 : -99~99`.
A DOUBLE program with opposite-signed sensitivities on its two oscillators is the M1's *only*
velocity crossfade, because a multisound contains no velocity zones at all. Modelling it
unsigned — which Phase 2 did, as `velocitySensitivity: 0..1` — would silently delete the whole
technique. Measured in the browser: at +99, soft 0.039 / hard 0.246; at -99, soft 0.206 /
hard 0.000.

**The MGs are PROGRAM-level with per-oscillator ENABLE bits**, not one MG per oscillator.
That is how the manual lays them out (bytes 19-26 common, bits 5 and 6 the enables), and it
means they advance once per control block rather than once per slot — advancing per slot
would have run them 16x fast on a full chord.

**KEY SYNC off deliberately does NOT reset the phase.** Two notes held together then share one
modulation phase and beat against each other, which is what a single shared hardware
generator does.

**The joystick and the aftertouch strip are Phase 3 UI, not Phase 5 polish.** Eleven
parameters (bytes 27-37) are controller DEPTHS. Without something to move they would be
editable and permanently silent, and "every parameter audible" would be false for eleven of
them. The Y-axis split — up drives PITCH MG and the filter sweep, down drives FILTER MG — is
Korg's arrangement and is why bytes 33-37 come in an up-half/down-half pair.

### Undocumented curves added this phase — all CHOICES, not M1 facts

MG frequency 0..99 -> 0.05..30 Hz (exponential) · MG delay 0..99 -> 0..3 s (linear) · OSC-2
delay start 0..99 -> 0..1 s (linear) · VDF cutoff 0..99 -> 30..18000 Hz (exponential) ·
EG-time modulation depth (+/-2 octaves of time at full amount) · PITCH MG full-scale depth
(2 semitones) · amp keyboard tracking depth (one octave of gain across the tracking span).
Each is labelled at its definition. The cutoff curve's top end matters most: at 99 the filter
must be genuinely out of circuit, or the Phase 4 gate measures this curve instead of the
sample.

### Panel

**Sections declare WHICH parameters, never WHERE.** 139 hand-placed coordinates is 139 chances
to typo a number that afterwards looks like a design decision. `layout.ts` holds percentage
regions straight out of UI-SPEC and computes cells; a test asserts every column fits its band
and no two work-area columns overlap.

**A coverage test asserts every parameter appears on some page**, and it earned its keep
immediately: the filter EG section was declared and left off every page, so its eight bytes
were reachable only by dragging a 7 px graph handle. A parameter that is in the table, wired
to the engine, and on no page is invisible — the one failure mode that looks like success from
every other angle.

**Two EG graph components, and the difference is structural rather than a prop.** The amp
graph has three level handles for four segments; the filter graph has four. That missing
eighth parameter IS the difference, and a shared component with a `hasReleaseLevel` flag would
be the same mistake wearing a disguise.

**The drag path does not write the store.** `previewParam` pushes the engine without a store
write and `setParam` commits on release, because a knob fires `onInput` per pointermove and a
store write notifies every subscriber. Likewise the store grew direct scalar readers
(`getProgramParam`, `programName`, `getExtension`) because `getState()` deep-copies through
the JSON codec — correct for anyone taking a whole tree, but as a `useSyncExternalStore`
snapshot it returns a fresh object every call and re-renders all 139 controls every frame.

**Keymaps are cached on (mode, multisound).** A program push carries two 32 KB keymaps, and
rebuilding them per pointermove would burn megabytes a second producing byte-identical output.

### Two bugs fixed in passing, both pre-existing

- **`VoiceEngine.render` double-counted its frame clock.** Both `render` and `renderChunk`
  advanced `this.frames`, so `now` ran at twice real time and the allocator aged every voice
  twice as fast in its steal score. Now advanced in one place.
- **`voiceMessages.ts` restated every OscConfig field by hand**, so a parameter added to the
  engine could be wired in the bridge and silently dropped in transit with nothing failing to
  compile. It is now `Omit<OscConfig, 'samples'>` — the only field the wire format may
  disagree about is the one that genuinely differs, because a transferred buffer cannot carry
  a Float32Array view.

### Verified by driving the running app, not only by tests

Per CLAUDE.md's standing rule. At 48 kHz against the 32 kHz bank: note 60 rests at **263.7 Hz**
(261.6 expected, validating the pitch chain end to end) · cutoff 99->20 drops peak 0.567->0.065
· DOUBLE peaks at exactly 2x SINGLE (1.2175 / 0.6087) · the pitch MG sweeps the fundamental
237-287 Hz against 3 Hz of jitter with it off · a bend of +/-12 semitones lands on exactly the
same pitch as playing +/-12 semitones away (ratio 1.000 and 1.002) · the EG-time bitfield
tracks up on `+`, inverts on `-`, and does nothing on `0` · all five pages render, greying
33-43% of their controls in SINGLE and none in DOUBLE · the tree still round-trips with all
139 parameters and both extensions off · no console errors.

**A weak metric gave a confidently wrong answer twice**, which is the lesson Phase 1 already
recorded and worth restating because it recurs. A full-spectrum peak-bin search reported the
pitch bend as *inverted*; it was latching onto whichever harmonic happened to be loudest.
Autocorrelation then reported the bent-up note an octave low, because every integer multiple
of the true period correlates and a global maximum systematically prefers the longest lag in
range. And an analyser whose FFT window is longer than the settle time reports the PREVIOUS
note. The measurement that finally settled it compares two readings taken through the same
biased detector, so the bias cancels and only the equality is claimed.

### Deliberately still open

**DRUMS mode plays one drum per key, and unassigned keys are silent** — verified: notes 36-96
that carry a drum sound, note 41 does not. The bank's kit has duplicate note assignments
(three kicks all on 36), so only one drum per key is reachable; assembling the four selectable
Drum Kits is Phase 5/6 work, not Phase 3's.

**No program browser, no WRITE, no COMPARE.** Phase 6 owns the browser; the name field is
display-only for now.

---

## 2026-07-28 — Phase 4: effects

### The spec was located and then CHECKED, which mattered more than locating it

The 25-byte block and all 33 algorithms came off Owner's Manual **p.129**, exactly as PLAN.md
promised. Two further sources turned out to matter as much:

- **M1R Owner's Manual pp.56-57, "EFFECT PARAMETERS DEFAULT VALUES CHART"** (`pages/b056.png`,
  `b057.png`) — the official effect NAMES, every algorithm's DEFAULT values, and the asterisks
  that drive the pairing restriction, which p.129 does not carry. It also states the pairing
  rule verbatim. **Its A..H columns are the hardware's eight DISPLAY positions, not byte
  offsets**, and the two orders differ: a reverb's row reads Reverb Time / Pre Delay / E/R
  Level / High Damp for bytes 00 / 03 / 04 / 02. Conflating them is the easiest available
  mistake and would have mis-defaulted half the catalogue.
- **Korg's factory preload**, histogrammed by the new `npm run probe:effects`. p.129 left three
  questions genuinely ambiguous and the data settled all three.

**The type byte is the effect number MINUS ONE; 0x21 means Through.** The two decoders in the
research payload contradict each other on this (`fx2.py` reads the byte as the effect number,
`final.py` adds one). Settled non-circularly: under `byte+1`, I17 `Organ 2` decodes to Stereo
Chorus 1 at depth 99 with EQ +12/+12 into a 3.5 s Hall, and I00 `Universe` to a 247/414 ms
stereo delay — the exact figures PLAN.md quotes from a separate source, three independent
numbers landing at once. The rival reading also puts **8 of 12** Early Reflection times outside
their documented range. `fx2.py` is the earlier exploratory pass and is wrong.

**MG Status bit1 (phase) is editable DATA, and it is what separates the `I`/`II` variants.**
The operation manual says so in prose — *"Stereo ChorusI ... phase inversion of the two
circuits. Stereo ChorusII has no phase inversion"*, and likewise for Phaser and Tremolo — and
the factory bank agrees: **bit1 is set on 51 of 54 `I`-variant slots and clear on all 3 `II`
slots, and it VARIES within a single effect number**, so it is data rather than a constant
implied by the algorithm. p.129's per-cell arrow notes read the other way round; the prose and
the measurement agree with each other and outvote an ambiguous notation. This is what makes
PLAN.md's "four fewer implementations" real: chorus/flanger/phaser/tremolo are one block, and
`I`/`II` is one bit.

**For the dual algorithms 26-33 a slot's two balance bytes are the two HALVES' dry:wet, not a
left/right pair.** The quick reference lists two separate `Dry:EFF` controls for `Delay/Hall`
and pp.56-57 give two separate defaults. MEASURED, and the split is total: across the factory
bank the two bytes are **equal in 196 of 196** slots holding a stereo effect (1-25) and
**unequal in 4 of 4** slots holding a dual one.

**Bit 5 of the I/O byte is real, undocumented, and preserved rather than guessed at.** p.129
specifies `bit4~0`; 33 of 100 factory programs set a bit 5, only ever alongside all four
channel enables, correlating with nothing testable — not oscillator mode, not output pan, not
either effect type, not the balances. It is carried verbatim in `ioReserved` so a factory
import is lossless. Preserving an honest unknown beats inventing a meaning for it.

**Six factory bytes sit one past the range p.129 documents** (an E/R Level or Drive of 100
where `00~63 : 00~99` allows 99; an Exciter Emphatic Point of 11 where `00~09 : 01~10` allows
10). The manual is explicit and is treated as the authority; the clamp costs under 0.1 dB on 6
of ~800 bytes. Recorded because it is the kind of thing a later session would otherwise
rediscover as a bug. Round-trip is **91/100 byte-exact**, and the residue is only this plus two
programs carrying junk in MG-Status bits 3-4, which p.129 does not define.

### Structure

**The effect section runs in the worklet, DOWNSTREAM of the voice engine, not inside it.** The
M1 sums all 16 oscillator slots into the effect buses and the effects run once on the sum. It
also keeps the Phase 2 golden buffers measuring the voice engine alone, which is exactly what
they must keep measuring.

**Thirty-three algorithms collapse into nine DSP blocks**, and that collapse is Korg's own
structure rather than a simplification — the `Delay/X` family is literally a delay feeding one
of the others. Reverb, early reflection, delay, modulation, EQ, drive, exciter, symphonic,
rotary.

**`Dry:EFF` is a CROSSFADE, not a send.** The display reads `60:40`, the halves sum to 100, and
the byte is the effect half, so `out = dry*(1-w) + wet*w`. The alternative reading — dry at
unity with wet added on top — is up to 6 dB louder and is precisely the error PLAN.md warns
about ("Korg's own emulation had wet levels globally too hot"). I17's hall sits at 18.

**PROGRAM MODE CANNOT REACH EFFECT 2 IN PARALLEL, and that is the hardware.** A program has no
panpot page, so it is hard-wired 5:5 into buses A/B, and in PARALLEL the A/B path stops at
effect 1. Switching a Program to PARALLEL therefore silences effect 2 entirely. It looks like a
fault, so the panel LABELS it (`NOT IN PATH — PARALLEL`) rather than leaving a live-looking row
of knobs that change nothing. Phase 5's Combinations get a real panpot and can feed C/D.

**The pairing restriction is enforced in three places, and the UI one is the visible one.** The
selector STEPS OVER the barred entries rather than accepting a choice and having it rejected
somewhere invisible — verified in the running app, where the slot-1 stepper jumps 11 → 20 with
Symphonic Ensemble in slot 2. It is also enforced in `coalesceEffectsState` (slot 2 yields) and
in `setEffectType`, so MIDI and a hand-edited bundle cannot route around the panel.

**The breathing noise floor is modelled with NO PRNG.** A 16-bit DAC behind a 3-bit gain range,
where the range is chosen by a signal follower — so quantization error IS the noise, exactly as
on the hardware, and it steps as a tail decays. CLAUDE.md is explicit that randomness in the
signal path would cost the byte-exact golden-buffer tests, which are the sharpest tests in the
project.

### Undocumented curves added this phase — all CHOICES, not M1 facts

Per-effect EQ shelf corners (500 Hz / 2 kHz, borrowed from Korg's own documented EQUALIZER
defaults rather than invented) · chorus full-scale depth 5 ms and flanger 4 ms · phaser sweep
100 Hz–4 kHz over six stages · reverb comb and allpass tunings · early-reflection tap pattern ·
overdrive and distortion transfer curves · exciter band split · symphonic six-voice rates ·
rotary base rates and crossover · tremolo SHAPE skew. Each is labelled at its definition and
collected at the top of its file, because these are the numbers a future A/B will want to move.

**The chorus sweep is UNIPOLAR — upward from the base delay, not around it.** Found by
measuring in the browser: I17 sets DELAY TIME 0 with DEPTH 99, and a bipolar sweep spent half
of every cycle clamped against the interpolator's minimum delay, which flattens one side of the
modulation audibly. Unipolar also matches the parameter's own definition ("time between direct
sound and effect sound", i.e. the floor of the sweep).

### The bug the tests could not see, and the one they now can

**`snapEffectValue` silently rewrote PHASE '180' to '0' — turning every `I` variant into its
`II`.** `encodeValue` returned the bare bit VALUE for the sub-byte codecs while `decodeValue`
read a bit POSITION, so round-tripping a value through both — which is exactly what grid
snapping does — shifted it away. The block encode/decode round-tripped fine (a compensating
shift lived in `encodeEffectParams`), the audibility sweep constructed params directly and
never went through the snapper, and the panel coverage test does not run values. So **nothing
in 900 tests caught it**; setting up the gate patch in the running app did, on the single most
load-bearing bit in the phase.

Fixed by making encode the exact inverse of decode — the bit is shifted into position at
encode, and `encodeEffectParams` ORs rather than shifting again. One representation, one place
to get it wrong. The test added for it asserts the GENERAL form (snapping is identity on every
parameter of every algorithm, and idempotent) rather than the instance; mutating the shift back
now fails six tests including two that already existed.

**This is the fourth phase in which measuring the running app caught something unit tests could
not, and the third in which a weak metric gave a confidently wrong answer.** The pitch probe
here reported note 60 an octave low, because `Organ2` is a drawbar registration whose strongest
partial is the 16' drawbar below the nominal pitch — the spectrum reads 131.8 / 260.7 / 392.6 /
524.4 / 785.2 Hz, i.e. 0.5x, 1x, 1.5x, 2x, 3x of C4. Phase 3's 263.7 Hz reading was the 8'
partial and was right. The measurement that settled it claimed only a RATIO through one
detector (octave switch 2.0016, note transposition 2.0042), which is the technique DECISIONS.md
has now recorded three times.

### The fidelity gate

`I17 Organ 2` is hand-entered from the decoded factory record, and **the decode corrects
PLAN.md's description of it in four audible ways**: the oscillator is at **16'**, not 8'; its
level is **30**, not the default 70; the filter is at **cutoff 70 with tracking 0** (the
documented trap — 0 means 100% tracking), not wide open; and the amp release is 4, not 25. The
envelopes do nothing, as PLAN.md says, but a patch built from "defaults plus Organ2 plus
effects" would have been wrong in all four. Korg's low oscillator level is also what keeps the
60%-wet chorus with +12/+12 EQ inside headroom.

Measured in the browser at 48 kHz with both extensions OFF:

- **RT60 3.61 s against a 3.5 s setting** (3% error), decay linear in dB across 3 s. That
  validates the whole reverb-time chain: display value → byte → Schroeder comb feedback → decay.
- **Stereo correlation −0.06** on a held chord from a mono source — a genuinely wide image,
  which is the 180° phase inversion doing what the manual describes.
- **Four-note chord peaks 0.72** pre-master; no clipping. A dense five-note chord low in the
  register reaches 1.27, which the master stage's 0.8 gain and soft clip absorb.
- Octave and transposition ratios exact (see above).

**The listening half of the gate is NOT closed.** A/B against Robin S — "Show Me Love"
(StoneBridge Mix) requires the recording, which this session had no way to obtain or hear.
Everything measurable is measured and recorded above; a 7.17 s stereo WAV of the patch
(`BorgM1-I17-Organ2.wav`, normalised to −3 dBFS so it carries timbre rather than the master
limiter) was rendered for that comparison to be made by ear. **If it does not match, the first
numbers to move are the per-effect EQ shelf corners and the chorus depth constant**, both
labelled and collected at the top of their files for exactly that reason.

### Still open

**The negative-cutoff-tracking question from Phase 3 is NOT settled**, because settling it
needed the A/B that did not happen. I17 uses tracking `0` (full tracking) and never a negative
value, so the gate patch exercises neither reading. It stays as Phase 3 left it.

---

## 2026-07-28 — Layout repair, after the first real-window review

The first human look at the app (a ~1900px window) found text collisions and a keyboard
overflowing its band. Root causes and the decisions they forced, so nobody re-introduces them:

**The keybed is now the full 88-key piano, A0–C8 — and that is a GEOMETRY fix as much as a
spec fix.** UI-SPEC §6 measured the reference at 88 keys all along; the Phase 2 bed was
2 octaves + top C. The overflow mechanism: `.keybed` is width-fitted (`width:100%;
height:auto`), so its rendered height is width ÷ aspect — and 15 white keys give a 2.8:1
aspect that made the SVG ~400px tall in a ~144px band, climbing over the panel. 52 white keys
give 9.6:1, which fits the band at any window size. **A width-fitted SVG's height is set by
its viewBox aspect, not by its container** — worth remembering, because the bug is invisible
at the aspect ratio you happen to develop at. Octave-shifted notes now clamp to MIDI 0..127
(A0 −2 octaves is note −3, which would have been an out-of-bounds keymap read).

**Every control now FITS the 66px cell, and the two that cannot are handled by name.** The
switch (label above) is shifted down 10px inside its cell so the label stays off the section
title and off the row above; knob labels are one clamped line, never two — the second line
was 15px into the next row, printing across any switch that wrapped beneath (the KBD TRACK
sections' "RELEASE over CENTER KEY"). The 4-position waveform switch still pokes 3px over the
cell top, so `layout.ts` keeps it out of column 0 — recorded THERE as a comment, because the
constraint is invisible at the declaration site.

**The EG graphs got a second text row and collision-proof handles.** Title and segment
headers shared one row and printed over each other (`PAD.t` 22 → 38). Handle letters flip
BELOW a handle within 14px of the well top, and `xPositions` enforces a 16px minimum spread —
INIT PROG's zero attack/decay/slope parked three amp-EG handles on one pixel, letters
overprinted and only the topmost grabbable.

**Layout verification is now a MEASUREMENT, not an eyeball**: the audit (Playwright,
1900×1030, all six pages) walks every rendered `<text>` pair and fails any overlap over
8px² between different controls, plus asserts the keybed's band. It went dozens → 4 → 2 → 0,
and each intermediate count was a distinct bug class. The lesson repeats Phase 2's: the unit
tests assert columns fit bands and every parameter is on a page, and were blind to glyphs
printing over glyphs — only measuring the RENDERED page sees that. The script lives in the
session record; rebuilding it is ~80 lines around `getBoundingClientRect` intersection.

---

## 2026-07-28 — RECORD, and the inherited features still without switches

**The master recorder is wired to a header control.** `MasterRecorder` and `recordHelpers`
came over from SynthStack in Phase 0 and had sat in `StudioContext` with no way to reach them
since — engine with no switch. The bridge now forwards the four calls and the header carries a
lamp, an elapsed readout and a per-take `WAV`/`WEBM` chip.

**WAV is the default, not WEBM.** The lossless PCM tap is the point of having a recorder in a
project whose acceptance test is an A/B against a commercial record; Opus is offered for when
size matters more than fidelity. The format applies to the NEXT take and is locked while
recording, because a format that changed mid-take would describe a file that does not exist.

**The elapsed readout polls at 4 Hz, and that does not violate the no-`setInterval` rule.**
CLAUDE.md forbids `setInterval`/`setTimeout` for AUDIO EVENTS — scheduling sound. This is a UI
label reading a clock the recorder already keeps; nothing about when a sample is heard depends
on it. The interval also exists only while a take is running.

**Verified end to end in the running app rather than by unit test**, per the standing rule: the
real button starts the recorder, the readout ticks, stop triggers an actual browser download,
and the resulting file reads back as a valid 48 kHz stereo 16-bit WAV with signal in it. A unit
test could not have reached any of that — `MediaRecorder`, the blob and the download are all
browser surface.

### Deliberately still unwired, and the distinction matters

Two more SynthStack inheritances are **built and tested but have no UI**, which is a different
state from "not built" and is worth stating so a later session does not rewrite them:

- **`PresetPicker`** — factory list, named user slots, two-step-confirm delete, `.json`
  export/import, and a Node render harness that already tests all of it. It needs a
  `SetupBridge` implementation against the store. It is the USER-SETUP surface and is **not**
  Phase 6's program browser, which UI-SPEC specifies as a different thing entirely (two 4x4
  tag grids, live faceting, card paging, APPLY-without-closing).
- **MIDI pitch bend and mod wheel (CC1)** — decoded, channel-filtered and unit-tested in
  `webMidiInput`; simply not routed into the joystick's X/Y. Note-on/off, the channel filter
  and the hot-unplug panic ARE wired. Sustain (CC64) is not decoded at all.

Neither was pulled forward on the reasoning that a phase's scope is the phase's scope; both are
recorded here because "already written" is invisible from the outside and is exactly the sort
of thing that gets duplicated.
