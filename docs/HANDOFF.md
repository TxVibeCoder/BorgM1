# Handoff — start here

*Written 2026-07-28, at the end of Phase 2. Paste this to a fresh session, or read it yourself
after a break.*

---

You are picking up **BorgM1**, a browser emulator of the Korg M1 (1988) PCM workstation.
Directory: `<repo root>`. Windows, PowerShell.

**Phases 0–2 are done and the instrument plays.** Your job is **Phase 3 — the program layer and
the panel UI**. Do Phase 3 only; do not start Phase 4.

## Read first, in this order

1. `CLAUDE.md` — the non-negotiable conventions. Short. All of it applies.
2. `docs/PLAN.md` — the eight-phase plan with live status. **Phase 3 is your spec.**
3. `docs/DECISIONS.md` — dated log of what was decided and why. Read the Phase 0–2 entries
   before proposing anything that contradicts them; several look like obvious improvements and
   are not.
4. `docs/UI-SPEC.md` — the layout spec you are building to.
5. `docs/BRIEF.md` — **only the "Watch out for" section.** The rest is the founding brief and is
   marked historical. The traps are still live and several would each cost a session.

`README.md` has the code map and the command table.

## Get it running before you change anything

```bash
npm install && npm run build:bank && npm run dev
```

Open <http://localhost:5184>, press **POWER**, wait for `BANK OK · 100 sounds`, and play the
keybed. If you cannot hear it working, do not start editing it.

`npm run build:bank` needs **FluidR3_GM.sf2** (MIT, 141 MB, deliberately not vendored). It is
resolved from `$BORGM1_SF2`, then `assets/`, then `<sibling soundfont dir>/`. The
third of those is a sibling project — **read-only, never modify it.**

## What Phase 3 is

Every one of the 143 program parameters editable and audible, with the panel from `UI-SPEC.md`.

**Your first task is not code.** The 143-byte Program Parameter table has *not* been extracted
from the research payload yet — it exists only as a visual transcription described in
`docs/RESEARCH-INDEX.md`. Recover it into typed data (`data/`) with a test asserting every
parameter's range and default, exactly the way `data/sounds.ts` was done in Phase 1. That test
is Phase 3's gate.

Research lives at `../BorgM1-research/` (193 MB, not committed).
`docs/RESEARCH-INDEX.md` says what is in it and what each phase still needs.

**Replace, don't extend.** `engineBridge.ts` currently builds a deliberately flat placeholder
program — instant attack, full sustain, filter open. That is the shape `I17 Organ 2` itself
uses, which is why it was chosen, but it is scaffolding. Phase 3 replaces it. The engine already
consumes a full `ProgramConfig` (`src/engine/voice/voiceEngineCore.ts`); you are feeding it real
values, not extending its interface.

The rig in `App.tsx` (`.rig__*` in `styles.css`) is a harness for hearing the engine, not a
draft of the panel. **None of it should survive your phase.**

### The four things PLAN.md says that are easy to skim past

- **The `1`/`2` rule is the organising principle.** Build ONE per-oscillator component and
  instantiate it twice against the two halves of the parameter model, both driven by a single
  `enabled` flag off `OSC MODE`. This halves the panel work and makes the halves structurally
  unable to drift.
- **Two EG graph components, not one.** The filter EG releases to a *level*; the amp EG falls to
  zero because it has no release level. That asymmetry is engine behaviour showing through, and
  it is already modelled in `levelTimeEgCore.ts`.
- **`EASY` page as a curated subset**, with `OSC`/`VDF`/`VDA` as deep-edit tabs beside it. That
  pattern is what makes 143 parameters approachable.
- **Disabled state is designed, not bolted on.** About a third of the centre column greys out in
  SINGLE mode.

### Traps that will bite you specifically

- **VDF cutoff keyboard tracking of `0` means 100% tracking**, not none. Negative values give
  you none. It silently affects every patch. Already handled in `lowpassCore.ts` — do not
  "correct" it. Note the asymmetry: EG-time tracking at 0 *is* off.
- **The EG-time bitfield packs enable and polarity as separate bits**, so `0` genuinely means
  disabled. Get this wrong and a third of the envelopes are subtly wrong in a way that looks
  like a DSP bug.
- **Multisounds do not all span the keyboard**, and that is authentic — the manual says each
  waveform has a limited pitch range and "may not sound when played in a high octave". The key
  range is already in `bank.json`. Do not extend the top zone to 127 to "fix" it.

## How to work

- **One branch per phase.** `git checkout -b phase-3-program-layer`, merge to `main` with
  `--no-ff` when the gates pass.
- **Append to `docs/DECISIONS.md`, dated**, whenever you make a call a later session would
  otherwise have to re-derive. This is the single highest-value habit in the project.
- **Label the guesses.** The filter slope, the EG time→seconds curve, the steal weights and the
  sample rate are undocumented. Mark them in code as choices, not M1 facts.
- **Verification floor before closing the phase:** `npm test`, `npm run typecheck`,
  `npm run build` and `npm run build:bank` all clean, plus Phase 3's own gate.
- **Then drive the app and measure it.** Both Phase 2 bugs lived in the seam between correct
  components, where unit tests are blind, and both were found by measuring the real audio graph
  in the page. Going green is not the same as working.

## Environment friction, already paid for

Save yourself the time these cost:

- **PowerShell here-strings break on embedded quotes.** A multi-line `git commit -m @'...'@`
  will silently shred itself into pathspec errors. Write the message to a file and use
  `git commit -F <file>`. Use the session scratchpad for that file.
- **.NET file APIs do not follow `Set-Location`.** `[IO.File]::ReadAllText('x.md')` resolves
  against a stale working directory. Pass absolute paths, or prefer the Read/Edit/Write tools.
- **The launcher must keep CRLF line endings.** `cmd.exe` misparses an LF-only batch file and
  drops the first characters of every line, so `rem` runs as `m`. `.gitattributes` pins
  `*.cmd`/`*.bat`; do not relax it.
- **The bank is cached by the Cache API.** After `npm run build:bank`, an already-open page
  keeps serving the old blob. Clear it in the console before re-testing:
  `for (const k of await caches.keys()) await caches.delete(k)` then reload.
- **Port 5184 is `strictPort`** — a stale dev server or launcher makes `npm run dev` fail rather
  than drift to 5185. That is deliberate. Kill the old process.
- **A dev-only handle is exposed at `window.__borgm1`** (stripped from production builds). It
  gives you `noteOn`, `noteOff`, `audioContext` and `outputNode`, which is how the Phase 2 audio
  verification was done — attach an `AnalyserNode` to `outputNode` and measure.

## Do not

- **Do not modify SynthStack** at `<sibling SynthStack repo>`. It is the fork source and is
  read-only. It was untouched through three phases; keep it that way.
- **Do not commit the bank.** `public/bank/` is generated and gitignored. Nor the SF2.
- **Do not add runtime audio or UI libraries.** Build-time and test-only deps are fine.
- **Do not put a PRNG in the signal path.** Its absence is what makes byte-exact golden-buffer
  tests possible, and that is the sharpest test in the project.
- **Do not re-litigate the settled decisions** in `DECISIONS.md` without reading the reasoning
  first. The 16-oscillator-slot model, the Cache-API bank, the equal-gain crossfade and the
  exclusive `loopEnd` were each arrived at against a plausible-looking alternative.

## Where things stand

324 unit tests, typecheck, build and bank build all clean. Working tree clean on `main`.
The bank builds to 50 MiB / 480 samples / 594 key zones, 100 multisounds and 44 drums, with
451/451 loop seams within limit.

Known and deliberate at this point: output is **mono** (stereo comes from the effects section in
Phase 4), 39 multisounds and 12 drums are **approximated** from the nearest General MIDI timbre
and flagged `approx`, and the program is the placeholder described above.

The acceptance test for the whole project is Phase 4's: hand-enter `I17 Organ 2` and A/B it
against Robin S — "Show Me Love" (**StoneBridge Mix**), with extensions off. Phase 3 is what
makes that possible, so build the parameter model accurately enough to hand-enter a patch from
the decoded values.
