# BorgM1

A browser emulator of the Korg M1 (1988) PCM workstation. **Hardware engine, plugin UI.**

Read `docs/BRIEF.md` before starting. `docs/UI-SPEC.md` is the layout spec.
`docs/DECISIONS.md` is the running log — append to it, dated.

## Conventions — non-negotiable

- **Pure cores + thin shells.** DSP lives in `*Core.ts` with no Web Audio types, unit-tested
  in Node. Worklets only marshal buffers and params. This also keeps a future C++ port cheap.
- **One `AudioWorkletProcessor` owns all 16 slots.** Not one per voice. Near-zero `AudioParam`s
  — parameter changes go over `port.postMessage` and are read at block boundaries.
- **16 oscillator slots, not 16 voices.** SINGLE/DRUMS costs 1, DOUBLE costs 2, claimed
  atomically. That one rule reproduces both Program and Combi polyphony.
- **Never `setInterval`/`setTimeout` for audio events** — lookahead scheduler only.
- **No allocation or logging inside worklet `process()`** — preallocate in constructors. An
  uncaught throw in `process()` silences the node permanently; guard it.
- **No runtime audio or UI libraries.** Vite + React 18 + TS strict. Test-only deps are fine.
- **Single serializable state tree.** `JSON.parse(JSON.stringify(getState()))` round-trips,
  enforced by a test from day one.
- **Deterministic pure code.** Seeded PRNG (never `Math.random`), injected `now()`. Randomness
  lives in the impure shell and is passed in as an argument.
- **Don't read the render quantum as 128.** Read the actual buffer length.

## Fidelity

The engine models the **1988 hardware**. The UI wears the **software plugin's** layout. Plugin
additions the hardware lacks — filter resonance, insert FX — ship as switchable extensions that
**default to off**, exactly as Korg did.

Acceptance test: `I17 Organ 2` must A/B against Robin S — "Show Me Love" (**StoneBridge Mix**)
with extensions off.

## Naming

**No trade dress.** Original artwork only; no Korg logos, wordmarks, or copied silkscreen.
In the UI say **`FILTER`** and **`AMP`** — `VDF`/`VDA` are Korg's nomenclature. Keep VDF/VDA
internally where they match the SysEx model.
