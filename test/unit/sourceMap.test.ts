/**
 * Source-map integrity. The build script reads this table; if it drifts out of step with
 * the sound manifest the failure mode is a silent multisound, discovered whenever someone
 * next plays that program — possibly phases later.
 */

import { describe, expect, it } from 'vitest';
import { DRUM_SOURCES, MULTISOUND_SOURCES } from '../../data/sourceMap';
import { DRUM_SOUNDS, MULTISOUNDS } from '../../data/sounds';

describe('multisound sources', () => {
  it('maps exactly the sounds that need sourcing — no more, no fewer', () => {
    const needed = MULTISOUNDS.filter((m) => !m.synthesized && m.sharesSampleWith === null)
      .map((m) => m.index)
      .sort((a, b) => a - b);
    const mapped = Object.keys(MULTISOUND_SOURCES).map(Number).sort((a, b) => a - b);
    expect(mapped).toEqual(needed);
    expect(mapped).toHaveLength(63);
  });

  it('never maps an NT sound — those reuse their sibling`s audio', () => {
    for (const m of MULTISOUNDS.filter((x) => x.sharesSampleWith !== null)) {
      expect(MULTISOUND_SOURCES[m.index], `${m.index} ${m.name} must not be sourced`).toBeUndefined();
    }
  });

  it('never maps a synthesized sound — those are rendered', () => {
    for (const m of MULTISOUNDS.filter((x) => x.synthesized)) {
      expect(MULTISOUND_SOURCES[m.index], `${m.index} ${m.name} must not be sourced`).toBeUndefined();
    }
  });

  it('uses only valid General MIDI program numbers', () => {
    for (const [idx, src] of Object.entries(MULTISOUND_SOURCES)) {
      expect(Number.isInteger(src.program), `${idx}`).toBe(true);
      expect(src.program, `${idx}`).toBeGreaterThanOrEqual(0);
      expect(src.program, `${idx}`).toBeLessThanOrEqual(127);
      expect(src.preset.length, `${idx} needs a preset name for CREDITS`).toBeGreaterThan(0);
    }
  });

  it('pins the sources the acceptance tests depend on', () => {
    // I17 Organ 2 is the Phase 4 fidelity gate; I00 Universe layers Choir with Lore.
    expect(MULTISOUND_SOURCES[6]?.program).toBe(17); // Organ2 -> Percussive Organ
    expect(MULTISOUND_SOURCES[0]?.program).toBe(0); // A.Piano -> Yamaha Grand
    expect(MULTISOUND_SOURCES[30]?.program).toBe(52); // Choir -> Ahh Choir
    expect(MULTISOUND_SOURCES[42]).toBeDefined(); // Lore -> approximated, but present
  });

  it('flags roughly a third as approximations, and none of the core instruments', () => {
    // The approx flag is the upgrade shortlist, so it has to mean something: the sounds GM
    // genuinely covers must NOT be flagged, or the list is noise.
    const approx = Object.values(MULTISOUND_SOURCES).filter((s) => s.approx);
    expect(approx.length).toBeGreaterThan(15);
    expect(approx.length).toBeLessThan(35);
    for (const core of [0, 1, 2, 3, 4, 5, 6, 26, 30, 31, 36]) {
      expect(MULTISOUND_SOURCES[core]?.approx, `multisound ${core} should not be approximate`)
        .toBeUndefined();
    }
  });
});

describe('drum sources', () => {
  it('maps all 44 drums, 1-based', () => {
    const mapped = Object.keys(DRUM_SOURCES).map(Number).sort((a, b) => a - b);
    expect(mapped).toEqual(DRUM_SOUNDS.map((d) => d.index));
    expect(mapped[0]).toBe(1);
    expect(mapped.at(-1)).toBe(44);
  });

  it('uses valid MIDI notes and preset numbers', () => {
    for (const [idx, src] of Object.entries(DRUM_SOURCES)) {
      expect(src.note, `drum ${idx}`).toBeGreaterThanOrEqual(0);
      expect(src.note, `drum ${idx}`).toBeLessThanOrEqual(127);
      const program = src.kind === 'drum' ? src.kitProgram : src.program;
      expect(program, `drum ${idx}`).toBeGreaterThanOrEqual(0);
      expect(program, `drum ${idx}`).toBeLessThanOrEqual(127);
    }
  });

  it('draws the three kicks and the two snare pairs from DIFFERENT kits', () => {
    // Sourcing Kick1/2/3 from one kit three times would give three identical kicks where
    // the M1 has three distinct ones — the single most obvious way for a kit to sound wrong.
    const kicks = [1, 2, 3].map((i) => DRUM_SOURCES[i]!);
    const kitOf = (s: (typeof kicks)[number]) => (s.kind === 'drum' ? s.kitProgram : -1);
    expect(new Set(kicks.map(kitOf)).size).toBe(3);
    const hats = [11, 13].map((i) => DRUM_SOURCES[i]!); // ClosedHH1 vs ClosedHH2
    expect(new Set(hats.map(kitOf)).size).toBe(2);
  });

  it('sources the four tubular bells from one preset at four distinct pitches', () => {
    // They are a tuned set on the M1, not four unrelated samples.
    const bells = [38, 39, 40, 41].map((i) => DRUM_SOURCES[i]!);
    for (const b of bells) expect(b.kind).toBe('pitchedHit');
    const programs = new Set(bells.map((b) => (b.kind === 'pitchedHit' ? b.program : -1)));
    expect(programs.size).toBe(1);
    expect(new Set(bells.map((b) => b.note)).size).toBe(4);
  });

  it('keeps both metronome clicks, at different pitches', () => {
    const m1 = DRUM_SOURCES[43]!;
    const m2 = DRUM_SOURCES[44]!;
    expect(m1.note).not.toBe(m2.note); // downbeat vs beat
  });
});
