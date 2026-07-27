# Credits and licences

Every source the BorgM1 sample bank is built from, and the licence it ships under.

The bank is **generated, not committed** — `npm run build:bank` produces `public/bank/`
from the sources below. Nothing in this repository contains third-party audio.

---

## Sample sources

| Source | Licence | Used for |
|---|---|---|
| **FluidR3_GM** by Frank Wen | **MIT** | 63 of the 100 multisounds, and all 44 drum sounds |

FluidR3_GM is the spine of the bank. It is MIT-licensed, carries loop points on 100% of
its 1,418 samples, is already multi-rate, and covers choir — otherwise the hardest family
to source freely.

The build references General MIDI **program numbers**, not FluidR3-specific internals, so
any GM-compliant SoundFont can be substituted by pointing `BORGM1_SF2` elsewhere.

### Rendered, not sampled

**Multisounds 77–99 (23 sounds)** carry no third-party audio at all. On the 1988 hardware
these were *computed* — Korg's DWGS (Digital Waveform Generator System) stored harmonic
amplitude tables and summed them. `src/engine/sample/dwgsCore.ts` does the same thing, so
the method is authentic even though the tables are ours.

Six of them (`SquareWave`, `SawWave`, `DWGS Tri`, `DWGS Sine`, `25% Pulse`, `10% Pulse`)
are the exact mathematical definitions of those waveforms. The other seventeen are
**authored approximations** of timbres Korg never published, and are flagged `exact: false`
in the code. They are original work.

---

## Substitutions — the upgrade shortlist

39 of the 100 multisounds and 12 of the 44 drums are marked `approx` in
[`data/sourceMap.ts`](data/sourceMap.ts): General MIDI has no slot for them, so each maps
to the nearest available timbre. That flag is a to-do list, not an apology — it is exactly
the set of sounds worth re-sourcing once the instrument is playable and it is possible to
*hear* which substitutions actually hurt.

The M1-specific textures with no GM equivalent at all are the interesting ones: `Lore`,
`PanWave`, `PingWave`, `FvWave`, `MvWave`, `Wire`, `Rhythm`, `Flexatone`.

Planned upgrades, all compatible:

| Candidate | Licence | Would improve |
|---|---|---|
| Greg Sullivan E-Pianos | CC-BY | `E.Piano1`, `E.Piano2` (Rhodes / Wurli / CP80) |
| FreePats electric organ | CC0 | `Organ1`, `Organ2`, `MagicOrgan` |
| VCSL (Versilian Community Sample Library) | CC0 | strings, mallets, world percussion |
| VSCO 2 Community Edition | CC0 | strings, brass, woodwind |

`Organ2` is the one that matters most: `I17 Organ 2` is the Phase 4 fidelity gate, A/B'd
against Robin S — "Show Me Love" (StoneBridge Mix). Its filter and amp envelopes are flat,
so the sample carries the entire character.

---

## Deliberately excluded

These are **not** used, and should not be added later. Each is a trap that looks like a
solution:

| Source | Why not |
|---|---|
| **Arachno SoundFont** | Contains actual Korg M1 ROM samples, by its own author's documentation, and is private-use-only. It is the top hit for "M1 soundfont". |
| **Philharmonia Orchestra samples** | Explicitly forbid redistribution as a sampler instrument — precisely what this is. |
| **Pianobook** | Same restriction. |
| **SGM-v2.01** | Orphan work. Two *different* fabricated open licences circulate for it. |
| **Musyng Kite** | No clear redistribution licence. |
| **Timbres of Heaven** | No clear redistribution licence. |
| **jRhodes** | Non-commercial only. |
| **Sonatina Symphonic Orchestra** | Redistribution terms incompatible with shipping as an instrument. |

---

## Tools

| Package | Licence | Role |
|---|---|---|
| [`spessasynth_core`](https://github.com/spessasus/spessasynth_core) | Apache-2.0 | SF2 parsing at build time. **Dev dependency** — never shipped to the browser. |
| `fft.js` | MIT | Spectral assertions in tests only. |
| `tsx` | MIT | Runs the build scripts. Dev dependency. |

BorgM1 ships **no runtime audio or UI libraries**. React and React-DOM are the only
runtime dependencies.

---

## Trade dress

BorgM1 is an independent emulation. It contains no Korg logos, wordmarks, badges or
copied silkscreen artwork; all panel artwork is original. "Korg" and "M1" are referenced
only to identify the instrument being emulated. The UI says `FILTER` and `AMP` rather than
Korg's `VDF` and `VDA`.
