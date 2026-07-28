/**
 * DWGS / geometric waveform synthesis.
 *
 * The geometric waves are exactly defined, so they get exact assertions. The `DWGS
 * <instrument>` tables are authored approximations of timbres Korg never published, so
 * they get structural assertions only — anything tighter would be pinning an invention.
 */

import { describe, expect, it } from 'vitest';
import {
  DWGS_RECIPES,
  DWGS_ROOT_FINE_CENTS,
  DWGS_ROOT_KEY,
  DWGS_TABLE_SIZE,
  MAX_HARMONIC,
  renderCycle,
  renderRecipe,
} from '../../src/engine/sample/dwgsCore';
import { DEFAULT_BANK_RATE } from '../../src/engine/sample/bakeCore';
import { FIRST_SYNTHESIZED_MULTISOUND, MULTISOUNDS } from '../../data/sounds';
import { loopSeamDiscontinuity, LOOP_GUARD_SAMPLES } from '../../src/engine/sample/loopCore';
import {
  hasGuard,
  makePlayerState,
  renderInto,
  startPlayer,
} from '../../src/engine/dsp/samplePlayerCore';

describe('DWGS recipes', () => {
  it('covers exactly multisounds 77..99, in order, with matching names', () => {
    const synth = MULTISOUNDS.filter((m) => m.synthesized);
    expect(DWGS_RECIPES).toHaveLength(synth.length);
    DWGS_RECIPES.forEach((r, i) => {
      expect(r.index).toBe(FIRST_SYNTHESIZED_MULTISOUND + i);
      expect(r.name).toBe(synth[i]!.name);
    });
  });

  it('every recipe has at least one non-zero harmonic', () => {
    for (const r of DWGS_RECIPES) {
      expect(r.harmonics.some((h) => h !== 0), `${r.name} is silent`).toBe(true);
    }
  });

  it('no recipe writes a harmonic above the table Nyquist', () => {
    // A partial above tableSize/2 cannot be represented and would alias down into the
    // audible spectrum as an inharmonic tone.
    for (const r of DWGS_RECIPES) {
      expect(r.harmonics.length, `${r.name}`).toBeLessThanOrEqual(MAX_HARMONIC);
    }
  });

  it('flags the exact waveforms as exact and the invented tables as not', () => {
    // The honesty check: only waves with a closed-form definition may claim to be exact.
    const exact = DWGS_RECIPES.filter((r) => r.exact).map((r) => r.name);
    expect(exact.sort()).toEqual(
      ['10% Pulse', '25% Pulse', 'DWGS Sine', 'DWGS Tri', 'SawWave', 'SquareWave'].sort(),
    );
    for (const r of DWGS_RECIPES.filter((x) => !x.exact)) {
      expect(r.note.length, `${r.name} needs a note explaining where its shape came from`)
        .toBeGreaterThan(10);
    }
  });
});

describe('renderCycle', () => {
  it('renders a pure sine from a single fundamental', () => {
    const out = renderCycle([1], 256);
    for (let i = 0; i < 256; i++) {
      expect(out[i]!).toBeCloseTo(0.99 * Math.sin((2 * Math.PI * i) / 256), 5);
    }
  });

  it('peak-normalizes, since the tables are relative weights', () => {
    for (const r of DWGS_RECIPES) {
      const out = renderRecipe(r).data;
      let p = 0;
      for (const v of out) p = Math.max(p, Math.abs(v));
      expect(p, `${r.name}`).toBeCloseTo(0.99, 5);
    }
  });

  it('a table containing only harmonic h completes exactly h cycles', () => {
    const h = 4;
    const table = new Array<number>(MAX_HARMONIC).fill(0);
    table[h - 1] = 1;
    const out = renderCycle(table, 256);
    // count zero crossings: h cycles => 2h crossings
    let crossings = 0;
    for (let i = 1; i < out.length; i++) {
      if (Math.sign(out[i]!) !== Math.sign(out[i - 1]!) && out[i] !== 0) crossings++;
    }
    expect(crossings).toBe(2 * h);
  });

  it('the square table is odd-harmonic only', () => {
    const square = DWGS_RECIPES.find((r) => r.name === 'SquareWave')!;
    square.harmonics.forEach((a, i) => {
      if ((i + 1) % 2 === 0) expect(a, `harmonic ${i + 1} should be silent`).toBe(0);
    });
  });

  it('the triangle table falls off as 1/n^2 with alternating sign', () => {
    const tri = DWGS_RECIPES.find((r) => r.name === 'DWGS Tri')!;
    expect(tri.harmonics[0]).toBeCloseTo(1, 10); // h=1
    expect(tri.harmonics[1]).toBe(0); // h=2 even
    expect(tri.harmonics[2]).toBeCloseTo(-1 / 9, 10); // h=3
    expect(tri.harmonics[4]).toBeCloseTo(1 / 25, 10); // h=5
  });

  it('the saw table has every harmonic at 1/n', () => {
    const saw = DWGS_RECIPES.find((r) => r.name === 'SawWave')!;
    saw.harmonics.forEach((a, i) => expect(a).toBeCloseTo(1 / (i + 1), 10));
  });
});

describe('rendered DWGS samples', () => {
  it('are single-cycle tables looped over their full length', () => {
    for (const r of DWGS_RECIPES) {
      const s = renderRecipe(r);
      expect(s.loopStart).toBe(0);
      expect(s.loopEnd).toBe(DWGS_TABLE_SIZE);
    }
  });

  it('CARRY THE GUARD REGION — without it every synthesized sound is silent', () => {
    // These skip bakeSample (nothing to resample, loop already exact) and the first
    // version skipped the guard with it. A 256-sample table with loopEnd 256 makes the
    // 4-point interpolator read data[256] and data[257] off the end: undefined, then NaN,
    // then silence, across all 23 sounds. The producer emits the guard so no caller can
    // forget it.
    for (const r of DWGS_RECIPES) {
      const s = renderRecipe(r);
      expect(s.data.length, `${r.name}`).toBe(DWGS_TABLE_SIZE + LOOP_GUARD_SAMPLES);
      expect(hasGuard(s), `${r.name} fails the player's own guard check`).toBe(true);
      // and the guard must CONTINUE the wave, i.e. hold the first loop samples
      for (let i = 0; i < LOOP_GUARD_SAMPLES; i++) {
        expect(s.data[DWGS_TABLE_SIZE + i]!).toBeCloseTo(s.data[i]!, 6);
      }
    }
  });

  it('renders finite audio through the player, not NaN', () => {
    // The end-to-end version of the bug above: the symptom was silence, which points
    // nowhere near the cause.
    for (const r of DWGS_RECIPES) {
      const s = renderRecipe(r);
      const st = makePlayerState();
      startPlayer(st, 0);
      const out = new Float32Array(2048);
      renderInto(out, 0, out.length, s, st, 1.37, 1.37, 1, 1); // non-integer increment
      expect(out.every(Number.isFinite), `${r.name} produced NaN`).toBe(true);
      let peak = 0;
      for (const v of out) peak = Math.max(peak, Math.abs(v));
      expect(peak, `${r.name} is silent`).toBeGreaterThan(0.1);
    }
  });

  it('wrap seamlessly BY CONSTRUCTION — the table is exactly one period', () => {
    // No crossfade is applied to these and none is needed: a sum of harmonics whose
    // periods all divide the table length is exactly periodic across it.
    for (const r of DWGS_RECIPES) {
      const s = renderRecipe(r);
      const seam = loopSeamDiscontinuity(s.data, { loopStart: 0, loopEnd: DWGS_TABLE_SIZE });
      expect(seam, `${r.name} seam`).toBeLessThan(2);
    }
  });

  it('the root pitch matches the table size at the bank rate', () => {
    // 256 samples at 32 kHz is 125 Hz, which is MIDI 47 + 21 cents. If any of these three
    // constants moves without the others, every synthesized multisound plays off-pitch.
    const freq = DEFAULT_BANK_RATE / DWGS_TABLE_SIZE;
    expect(freq).toBe(125);
    const midi = 69 + 12 * Math.log2(freq / 440);
    expect(Math.floor(midi)).toBe(DWGS_ROOT_KEY);
    expect(Math.round((midi - DWGS_ROOT_KEY) * 100)).toBe(DWGS_ROOT_FINE_CENTS);
  });
});
