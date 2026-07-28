# Research index

The source material lives at **`../BorgM1-research/`** — 193 MB, 560 files,
preserved 2026-07-27 from a session scratchpad that would otherwise have been cleaned.

Move it to `research/` inside this project (and gitignore it) if you'd rather have everything in
one tree. It is deliberately *not* committed — most of it is scanned PDFs.

## What has been extracted so far

Findings are transcribed into the repo as they are used, so the research payload is a source,
not a dependency — the build does not read it.

| Extracted | Lives in | Phase |
|---|---|---|
| The 100-multisound and 44-drum lists | `data/sounds.ts` | 1 |
| `NT` = No Tracking, confirmed verbatim from the manual | `data/sounds.ts` | 1 |
| Multisounds have a limited pitch range and may not sound high up | `bank.json` key ranges | 1 |
| The 143-byte Program Parameter table, all 139 parameters | `data/programParams.ts` | 3 |
| The EG-time bitfield packing (enable and polarity are separate bits) | `data/programParams.ts`, `dsp/modCore.ts` | 3 |
| Cutoff keyboard tracking: 0 means 100%, confirmed verbatim | `dsp/lowpassCore.ts` | 3 |

**Still to extract**, in the phase that needs it:

| Not yet extracted | Needed by |
|---|---|
| The 33 effect algorithms and their quantization grids | Phase 4 |
| The 124-byte Combination table | Phase 5 |
| `preload/final.py` — the 100 factory programs and 100 combinations | Phase 6 |

## Where the tables actually are — read the IMAGES, not the OCR

The MIDI-implementation appendix is scanned cleanly enough to read directly at full
resolution. **The OCR text layers are useless for these pages**: every table is multi-column
and the OCR interleaves the columns, so byte 63's name lands next to byte 16's range. Phase 3
transcribed p.127 from the image in one pass after the OCR wasted a search.

| Page | Table | What it is | Status |
|---|---|---|---|
| `pg/p127.png` | **TABLE 1** | **The 143-byte Program Parameter table.** Plus notes *1 (the EG-time SW & POLARITY bit layout), *2 (osc modes) and *3 (MG waveforms) | ✅ extracted, Phase 3 |
| `pg/p128.png` | TABLES 2–4 | Combination (124 bytes), Global, Sequencer Control Data | Phases 5, 7 |
| `pg/p129.png` | `*11` | **The 25-byte effect block and all 33 algorithms**, with their quantization grids | Phase 4 |
| `pg/p130.png` | TABLE 5 | Program parameter **page/position → offset**. The independent cross-check on TABLE 1, and the hardware's own edit-page grouping | ✅ used, Phase 3 |
| `pages/b131.png` | TABLE 6 | The same, for Combinations. Note `pg/` stops at p130 — this one is only in `pages/` | Phase 5 |

The Edit Program Mode pages (`png/p021.png`–`png/p036.png`, manual pp.20–35) carry the
per-parameter semantics and the display names. Note the filenames are offset by one from the
printed page number: `png/p027.png` is printed page 26.

**The SF2 is not here.** FluidR3_GM lives outside the payload; `scripts/bankConfig.ts` resolves
it from `$BORGM1_SF2`, then `assets/`, then a sibling project's copy.

## The important artifacts

| Path | What it is |
|---|---|
| `preload/M1_Preload.zip` + `preload/final.py` | **Korg's official factory preload SysEx and a working decoder.** The single most valuable item here. |
| `M1_official.pdf` | The official 138-page Owner's Manual from Korg's CDN. Image-only, no text layer. |
| `img/`, `drums/` | Rendered page crops. p.138 carries both the multisound and drum lists. |
| `m1_service.pdf` | Service manual. |
| `mde_zoom.png`, `dac_zoom.png` | Crops identifying the **MB87405 "MDE"** effects chip and the gain-ranged DAC. |
| `korg/` | High-resolution reference images of the plugin UI from Korg's own CDN. |
| `*_djvu.txt`, `*_ocr.txt` | OCR text layers of the manual scans — searchable, but verify against the images. |

## Decoding the factory bank

Strip the 5-byte SysEx header, skip 3 more bytes, then Korg 7-bit unpack in groups of 8 (byte 0
holds the MSBs for the next 7). Programs are **100 × 143 bytes at offset 13261**; combinations
are **100 × 124 bytes at offset 861**. Validated non-circularly — 20/20 programs matched their
predicted multisamples.

## Which manual is which — this trips people up

- **The hardware Owner's Manual** (Korg CDN, or ManualsLib **898710**) documents the 1988
  machine. Use it for the engine.
- **ManualsLib 819462** is the **2006 software plugin** manual. Use it for the UI. It lists
  `RESONANCE` and insert effects, which the hardware does not have.
- **The Korg Super Guide** is pre-release marketing and contradicts the Owner's Manual on drum
  kit ranges. The Owner's Manual wins.
- **There is no manual for the current plugin version.** Korg still ships the 2005 PDF, so
  anything post-2020 is documented only by screenshots and release notes.

## Traps recorded elsewhere

`docs/BRIEF.md` has the full list. The three that would waste the most time:

1. The plugin manual's resonance (above) coded into a non-resonant hardware filter.
2. A **decoy drum list** printed in the hardware manual's overview section — "BASS DRUM 1 /
   PICCOLO SNARE / HI BONGO…". The M1 has none of those. The real list is on p.138.
3. The **Arachno SoundFont**, which contains actual Korg M1 ROM samples by its own author's
   admission and is private-use-only. It is the top hit for "M1 soundfont".
