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
