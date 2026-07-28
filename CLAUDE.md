# BorgM1

A browser emulator of the Korg M1 (1988) PCM workstation. **Hardware engine, plugin UI.**

**Phases 0–2 are done — the instrument plays.** `docs/PLAN.md` has the status of every phase and
is where to start building. `docs/UI-SPEC.md` is the layout spec. `docs/DECISIONS.md` is the
running log — append to it, dated, whenever a choice is made that a later session would
otherwise re-derive. `docs/BRIEF.md` is the founding brief; its **traps** section is still live.

## Conventions — non-negotiable

- **Pure cores + thin shells.** DSP lives in `*Core.ts` with no Web Audio types, unit-tested
  in Node. Worklets only marshal buffers and params. This also keeps a future C++ port cheap.
- **One `AudioWorkletProcessor` owns all 16 slots.** Not one per voice. Near-zero `AudioParam`s
  — parameter changes go over `port.postMessage` and are read at block boundaries.
- **16 oscillator slots, not 16 voices.** SINGLE/DRUMS costs 1, DOUBLE costs 2, claimed
  atomically. That one rule reproduces both Program and Combi polyphony.
- **Never `setInterval`/`setTimeout` for audio events** — lookahead scheduler only.
- **No allocation or logging inside worklet `process()`** — preallocate in constructors. An
  uncaught throw in `process()` silences the node permanently; guard it and return `true`.
- **No runtime audio or UI libraries.** Vite + React 18 + TS strict. Test-only and build-time
  deps are fine (`spessasynth_core` and `tsx` are build-only; `fft.js` is test-only).
- **Single serializable state tree.** `JSON.parse(JSON.stringify(getState()))` round-trips,
  enforced by a test from day one.
- **Deterministic pure code.** Seeded PRNG (never `Math.random`), injected `now()`. Randomness
  lives in the impure shell and is passed in as an argument. The signal path has no PRNG at
  all, which is what makes byte-exact golden-buffer tests possible — do not spend that.
- **Don't read the render quantum as 128.** Read the actual buffer length. **And the same rule
  applies to the control path:** envelopes and parameters advance on the engine's own fixed
  control block, never on the host's quantum, or a 1 ms attack becomes a 32 ms ramp at 1024
  frames.
- **Every looped sample carries a guard region** — 4 samples past `loopEnd` holding the first
  loop samples, so the 4-point interpolator can read across the wrap. **The producer emits it**;
  a consumer that has to remember will forget, and the symptom is silence, which points nowhere
  near the cause.
- **Label the guesses.** The filter slope, the EG time→seconds curve, the voice-stealing rule,
  the sample rate and the drum-kit mappings are undocumented. Mark them in code as choices, not
  M1 facts, so nobody later mistakes them for verified behaviour.

## Verification

Unit tests are blind at the seams between correct components — both Phase 2 bugs lived there
and both were found by measuring the real audio graph in the page. **Before calling a phase
done, drive the running app and measure it**, don't just go green.

The verification floor for closing a phase: `npm test`, `npm run typecheck`, `npm run build`
and `npm run build:bank` all clean, plus whatever gate `docs/PLAN.md` names for that phase.

## Fidelity

The engine models the **1988 hardware**. The UI wears the **software plugin's** layout. Plugin
additions the hardware lacks — filter resonance, insert FX — ship as switchable extensions that
**default to off**, exactly as Korg did. State that coalesces to "on" is a bug: an unknown or
missing extension flag must heal to off, or the fidelity gate breaks silently.

Acceptance test: `I17 Organ 2` must A/B against Robin S — "Show Me Love" (**StoneBridge Mix**)
with extensions off.

## Naming

**No trade dress.** Original artwork only; no Korg logos, wordmarks, or copied silkscreen.
In the UI say **`FILTER`** and **`AMP`** — `VDF`/`VDA` are Korg's nomenclature. Keep VDF/VDA
internally where they match the SysEx model.
