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
