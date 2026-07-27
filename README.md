# BorgM1

A browser-based emulator of the **Korg M1** (1988) — the PCM workstation, not an analog synth.

16-voice polyphonic multisample playback, the M1's non-resonant filter, its three unusual
envelopes, a 33-algorithm effects section, 8-timbre Combinations, and (optionally) an 8-track
sequencer. Korg's official factory bank has been decoded, so the 100 factory programs and 100
combinations are **importable, not reconstructable**.

**Status: Phase 0 complete** — forked, gutted, scaffolded. `npm run dev` serves an empty shell
on port 5184; 169 unit tests, typecheck and build all green. Phase 1 (the sample pipeline) is
next. Repo: `github.com/TxVibeCoder/BorgM1`.

```bash
npm install && npm run dev
```

## Start here

| Document | What it is |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | The non-negotiable conventions. Read first. |
| [`docs/PLAN.md`](docs/PLAN.md) | **The phased build plan** — start here to build |
| [`docs/BRIEF.md`](docs/BRIEF.md) | Routing rationale, file-by-file reuse inventory, traps |
| [`docs/UI-SPEC.md`](docs/UI-SPEC.md) | Layout audit of the reference UI, with measurements |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Dated decision log. Append, don't rewrite. |
| [`docs/RESEARCH-INDEX.md`](docs/RESEARCH-INDEX.md) | Where the source material lives |

## Shape of the build

Fork SynthStack (`<sibling SynthStack repo>`) for its **shell**, delete its engine in one
commit, then build the M1 voice engine fresh. ~1,050 lines copy verbatim; the 16-slot
allocator, multisample keymaps, and engine bridge are new.

**Eight phases, ~14–19 focused sessions.** Every phase ends with something playable. Phases 0–6
are ~12–16 sessions and give a complete instrument; Phase 7 (the sequencer) is a separate
decision made after Phase 6 ships.

The first fidelity gate is **Phase 4**: hand-enter `I17 Organ 2` and A/B it against Robin S —
"Show Me Love" (StoneBridge Mix). That patch's filter and amp envelopes do nothing, so the whole
character is sample + chorus + EQ + hall. If it doesn't match, the cause is unambiguous.

## One decision still open

**The sequencer** (Phase 7). Largest and least M1-specific chunk; three sequencers already exist
in the portfolio, and the reference plugin dropped it entirely. Decide after Phase 6, with a
working instrument in front of you.

## Port

**5184.** Taken portfolio-wide: 5173 SynthStack, 5180 another local project, 5182 another local project, 8737 another local project,
8765 another local project's Docker server.
