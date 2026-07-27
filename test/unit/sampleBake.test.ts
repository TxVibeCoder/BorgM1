/**
 * Sample pipeline cores.
 *
 * The centrepiece is the LOOP-SEAM GATE (last describe block): every looped sample the
 * bank ships must wrap without a discontinuity. That bug does not announce itself in
 * Phase 1 — it surfaces three phases later as a click on every sustained note, at which
 * point the suspects are the envelope, the voice allocator, the filter and the effects,
 * and the actual cause is a build script nobody has looked at in a fortnight.
 */

import { describe, expect, it } from 'vitest';
import {
  bakeLoopCrossfade,
  isLoopValid,
  LOOP_GUARD_SAMPLES,
  loopSeamDiscontinuity,
  maxCrossfade,
  rebaseLoop,
  truncateWithGuard,
} from '../../src/engine/sample/loopCore';
import {
  blackman,
  DEFAULT_HALF_WIDTH,
  resample,
  scaleLoop,
  sinc,
} from '../../src/engine/sample/resampleCore';
import {
  floatToInt16,
  int16ToFloat,
  INT16_SCALE,
  normalizeInPlace,
  peak,
} from '../../src/engine/sample/pcmCore';
import { bakeSample, DEFAULT_BANK_RATE, type RawSample } from '../../src/engine/sample/bakeCore';
import { mulberry32 } from '../../src/engine/rng';

// ---- fixtures -------------------------------------------------------------------------

/** A sine at `freq` Hz, `n` samples at `rate`, starting at phase 0. */
function sine(n: number, freq: number, rate: number, amp = 0.8): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

/**
 * A sample whose loop is deliberately mis-cut: the loop region spans a non-integer number
 * of cycles, so the wrap steps. This is what an un-crossfaded real-world loop looks like.
 */
function badLoopSample(rate: number): { data: Float32Array; loopStart: number; loopEnd: number } {
  const data = sine(4000, 220, rate);
  // 220 Hz at this rate is rate/220 samples per cycle; land loopEnd a third of a cycle off.
  const period = rate / 220;
  const loopStart = Math.round(period * 4);
  const loopEnd = Math.round(period * 12 + period / 3);
  return { data, loopStart, loopEnd };
}

// ---- rebase ----------------------------------------------------------------------------

describe('rebaseLoop', () => {
  it('subtracts dwStart, because SF2 offsets are absolute into the global chunk', () => {
    // The trap: dwStartloop/dwEndloop index the file's single smpl chunk, not the sample.
    // Forget the subtraction and the loop points at some other instrument entirely.
    expect(rebaseLoop(100000, 100500, 101000)).toEqual({ loopStart: 500, loopEnd: 1000 });
  });

  it('leaves an already-zero-based sample untouched', () => {
    expect(rebaseLoop(0, 500, 1000)).toEqual({ loopStart: 500, loopEnd: 1000 });
  });

  it('isLoopValid rejects the malformed regions a bad rebase produces', () => {
    expect(isLoopValid({ loopStart: 500, loopEnd: 1000 }, 2000)).toBe(true);
    expect(isLoopValid({ loopStart: -500, loopEnd: 1000 }, 2000)).toBe(false); // under-subtracted
    expect(isLoopValid({ loopStart: 500, loopEnd: 9000 }, 2000)).toBe(false); // past the end
    expect(isLoopValid({ loopStart: 900, loopEnd: 900 }, 2000)).toBe(false); // empty
    expect(isLoopValid({ loopStart: 900, loopEnd: 500 }, 2000)).toBe(false); // inverted
    expect(isLoopValid({ loopStart: 1.5, loopEnd: 900 }, 2000)).toBe(false); // non-integer
  });
});

// ---- resampling -------------------------------------------------------------------------

describe('resample', () => {
  it('sinc and blackman have the right shape', () => {
    expect(sinc(0)).toBe(1);
    expect(sinc(1)).toBeCloseTo(0, 12);
    expect(sinc(2)).toBeCloseTo(0, 12);
    expect(sinc(0.5)).toBeCloseTo(2 / Math.PI, 12);
    expect(blackman(0)).toBeCloseTo(1, 12);
    expect(blackman(-1)).toBe(0);
    expect(blackman(1)).toBe(0);
    expect(blackman(2)).toBe(0);
  });

  it('is a pass-through (copy, not alias) when the rates match', () => {
    const src = sine(64, 440, 44100);
    const out = resample(src, 44100, 44100);
    expect(Array.from(out)).toEqual(Array.from(src));
    out[0] = 999;
    expect(src[0]).not.toBe(999); // a copy, so a caller cannot mutate the input
  });

  it('produces the expected output length', () => {
    expect(resample(sine(1000, 440, 44100), 44100, 22050).length).toBe(500);
    expect(resample(sine(1000, 440, 22050), 22050, 44100).length).toBe(2000);
    expect(resample(new Float32Array(0), 44100, 32000).length).toBe(0);
  });

  it('preserves a sine through 44100 -> 32000 with low error', () => {
    const inRate = 44100;
    const outRate = 32000;
    const freq = 440;
    const src = sine(8820, freq, inRate); // 200 ms
    const out = resample(src, inRate, outRate);

    // Compare against an ideal sine at the new rate, ignoring the kernel-truncated edges.
    const ideal = sine(out.length, freq, outRate);
    const skip = DEFAULT_HALF_WIDTH * 2;
    let err = 0;
    let sig = 0;
    for (let i = skip; i < out.length - skip; i++) {
      const d = out[i]! - ideal[i]!;
      err += d * d;
      sig += ideal[i]! * ideal[i]!;
    }
    const snrDb = 10 * Math.log10(sig / err);
    expect(snrDb).toBeGreaterThan(70);
  });

  it('ANTI-ALIASES on the way down: content above the new Nyquist is rejected, not folded', () => {
    // A 15 kHz tone downsampled 44100 -> 32000 is above the 16 kHz output Nyquist? No —
    // 15 kHz is below it and must SURVIVE. A 20 kHz tone is above it and must be
    // attenuated rather than folding back to 12 kHz, which is what naive decimation does
    // and which would put an audible inharmonic whistle in every bright sample.
    const inRate = 44100;
    const outRate = 32000;
    const keep = resample(sine(8820, 15000, inRate), inRate, outRate);
    const fold = resample(sine(8820, 20000, inRate), inRate, outRate);
    const skip = DEFAULT_HALF_WIDTH * 2;
    const rms = (a: Float32Array) => {
      let s = 0;
      let n = 0;
      for (let i = skip; i < a.length - skip; i++) {
        s += a[i]! * a[i]!;
        n++;
      }
      return Math.sqrt(s / n);
    };
    expect(rms(keep)).toBeGreaterThan(0.3); // below the new Nyquist: passes
    expect(rms(fold)).toBeLessThan(0.02); // above it: rejected, not folded back
  });

  it('rejects nonsense arguments rather than producing quiet garbage', () => {
    const src = sine(100, 440, 44100);
    expect(() => resample(src, 0, 32000)).toThrow(/positive/);
    expect(() => resample(src, 44100, -1)).toThrow(/positive/);
    expect(() => resample(src, 44100, 32000, 0)).toThrow(/halfWidth/);
    expect(() => resample(src, 44100, 32000, 1.5)).toThrow(/halfWidth/);
  });
});

describe('scaleLoop', () => {
  it('scales the LENGTH, not the end point', () => {
    // 1000..1301 is 301 long. At ratio 0.5 the start rounds to 500 and the length to 151,
    // so the end is 651. Rounding the end independently would give round(650.5) = 651 too
    // here, but the two disagree as soon as the fractions differ - see the next case.
    expect(scaleLoop(1000, 1301, 0.5)).toEqual({ loopStart: 500, loopEnd: 651 });
  });

  it('keeps the loop length exact where independent rounding would drift', () => {
    // Swept rather than pinned to one lucky pair: the two forms agree on most inputs and
    // differ on a minority, so a single hand-picked case proves nothing either way.
    const ratio = 32000 / 44100;
    let drifted = 0;
    for (let start = 1000; start < 1400; start++) {
      for (const length of [99, 100, 137, 211]) {
        const end = start + length;
        const got = scaleLoop(start, end, ratio);
        // INVARIANT: the scaled length is always exactly the scaled length. Always.
        expect(got.loopEnd - got.loopStart).toBe(Math.round(length * ratio));
        // the naive form (round both ends) drifts by a sample on some of these
        if (Math.round(end * ratio) - got.loopStart !== got.loopEnd - got.loopStart) drifted++;
      }
    }
    // ...and it does drift, often enough that ignoring it would detune real loops.
    // One sample on a ~72-sample loop is roughly 8 cents, on the sustain only.
    expect(drifted).toBeGreaterThan(100);
  });

  it('never collapses a loop to zero length', () => {
    expect(scaleLoop(0, 1, 0.001).loopEnd).toBe(1);
  });
});

// ---- crossfade --------------------------------------------------------------------------

describe('bakeLoopCrossfade', () => {
  it('is bounded by the pre-loop material and by the loop length', () => {
    expect(maxCrossfade({ loopStart: 100, loopEnd: 1000 })).toBe(100); // pre-loop binds
    expect(maxCrossfade({ loopStart: 5000, loopEnd: 5050 })).toBe(50); // loop length binds
    expect(maxCrossfade({ loopStart: 0, loopEnd: 1000 })).toBe(0); // nothing before the loop
  });

  it('applies no fade when there is no room, and reports 0', () => {
    const data = sine(1000, 220, 32000);
    const before = Float32Array.from(data);
    expect(bakeLoopCrossfade(data, { loopStart: 0, loopEnd: 900 }, 128)).toBe(0);
    expect(Array.from(data)).toEqual(Array.from(before));
  });

  it('leaves the attack and the head of the loop untouched', () => {
    const data = sine(2000, 220, 32000);
    const before = Float32Array.from(data);
    const region = { loopStart: 800, loopEnd: 1600 };
    const xf = bakeLoopCrossfade(data, region, 128);
    expect(xf).toBe(128);
    for (let i = 0; i < region.loopEnd - xf; i++) {
      expect(data[i], `sample ${i} outside the fade was modified`).toBe(before[i]);
    }
  });

  it('ends the fade ON the pre-loop material, which is what makes the wrap continuous', () => {
    const data = sine(2000, 220, 32000);
    const region = { loopStart: 800, loopEnd: 1600 };
    const pre = data[region.loopStart - 1]!; // the sample the wrap must continue from
    bakeLoopCrossfade(data, region, 128);
    expect(data[region.loopEnd - 1]!).toBeCloseTo(pre, 6);
  });

  it('does not smear when the fade is as long as the whole loop', () => {
    // Read and write regions overlap completely here; blending from already-blended
    // samples would feed the fade its own output.
    const data = sine(2000, 220, 32000);
    const region = { loopStart: 400, loopEnd: 800 };
    const pre = data[region.loopStart - 1]!;
    const xf = bakeLoopCrossfade(data, region, 400);
    expect(xf).toBe(400);
    expect(data[region.loopEnd - 1]!).toBeCloseTo(pre, 6);
  });

  it('holds the level flat across the fade for correlated material (equal-GAIN)', () => {
    // The two blended regions are the same tone a loop-period apart, so they correlate.
    // An equal-POWER (sin/cos) pair would bulge up to +3 dB through the middle, heard as
    // a swell at exactly the loop rate.
    const rate = 32000;
    const freq = 200;
    const period = rate / freq; // exactly 160 samples
    const data = sine(4000, freq, rate, 0.5);
    const region = { loopStart: Math.round(period * 4), loopEnd: Math.round(period * 12) };
    bakeLoopCrossfade(data, region, Math.round(period * 4));
    let maxAbs = 0;
    for (let i = region.loopStart; i < region.loopEnd; i++) {
      maxAbs = Math.max(maxAbs, Math.abs(data[i]!));
    }
    expect(maxAbs).toBeLessThan(0.55); // no bulge above the source amplitude
  });
});

// ---- guard region -----------------------------------------------------------------------

describe('truncateWithGuard', () => {
  it('cuts at loopEnd and appends exactly 4 guard samples', () => {
    const data = Float32Array.from({ length: 100 }, (_, i) => i / 100);
    const out = truncateWithGuard(data, { loopStart: 40, loopEnd: 80 });
    expect(out.length).toBe(80 + LOOP_GUARD_SAMPLES);
    expect(LOOP_GUARD_SAMPLES).toBe(4);
  });

  it('fills the guard with the samples the 4-point interpolator needs after the wrap', () => {
    const data = Float32Array.from({ length: 100 }, (_, i) => i);
    const region = { loopStart: 40, loopEnd: 80 };
    const out = truncateWithGuard(data, region);
    // reading past loopEnd must yield the start of the loop, not the discarded tail
    expect(out[80]).toBe(40);
    expect(out[81]).toBe(41);
    expect(out[82]).toBe(42);
    expect(out[83]).toBe(43);
    expect(out[79]).toBe(79); // last real loop sample untouched
  });

  it('wraps the guard modulo the loop length for a loop shorter than the guard', () => {
    const data = Float32Array.from({ length: 20 }, (_, i) => i);
    const out = truncateWithGuard(data, { loopStart: 10, loopEnd: 13 }); // length 3
    expect(out[13]).toBe(10);
    expect(out[14]).toBe(11);
    expect(out[15]).toBe(12);
    expect(out[16]).toBe(10); // wrapped, not read past the loop end
  });

  it('discards the release tail past loopEnd', () => {
    const data = Float32Array.from({ length: 1000 }, (_, i) => (i < 500 ? 0.5 : 0.9));
    const out = truncateWithGuard(data, { loopStart: 100, loopEnd: 300 });
    expect(out.length).toBe(304);
    for (const v of out) expect(v).toBe(0.5); // nothing from the 0.9 tail survived
  });
});

// ---- PCM --------------------------------------------------------------------------------

describe('pcmCore', () => {
  it('scales by 32767, not 32768 — the asymmetric-range clip trap', () => {
    // Scaling by 32768 makes +1.0 land on a code that does not exist; it wraps to -32768,
    // inverting a full-scale positive peak into a full-scale negative one. Loudest
    // possible click, on exactly the samples most likely to reach 1.0.
    expect(INT16_SCALE).toBe(32767);
    expect(floatToInt16(Float32Array.from([1.0]))[0]).toBe(32767);
    expect(floatToInt16(Float32Array.from([-1.0]))[0]).toBe(-32767);
    expect(floatToInt16(Float32Array.from([0]))[0]).toBe(0);
  });

  it('clamps rather than wrapping on out-of-range input', () => {
    const out = floatToInt16(Float32Array.from([2, -2, 1.5, -1.5]));
    expect(Array.from(out)).toEqual([32767, -32768, 32767, -32768]);
  });

  it('round-trips within one quantisation step', () => {
    const rng = mulberry32(12345);
    const src = Float32Array.from({ length: 2000 }, () => rng() * 2 - 1);
    const back = int16ToFloat(floatToInt16(src));
    for (let i = 0; i < src.length; i++) {
      expect(Math.abs(back[i]! - src[i]!)).toBeLessThan(1 / INT16_SCALE);
    }
  });

  it('normalizes to the target peak and no-ops on silence', () => {
    const data = Float32Array.from([0.1, -0.2, 0.05]);
    normalizeInPlace(data, 0.99);
    expect(peak(data)).toBeCloseTo(0.99, 6);
    const silent = new Float32Array(10);
    normalizeInPlace(silent, 0.99);
    expect(peak(silent)).toBe(0);
  });
});

// ---- the composed pipeline ---------------------------------------------------------------

describe('bakeSample', () => {
  const raw = (over: Partial<RawSample> = {}): RawSample => {
    const rate = 44100;
    const { data, loopStart, loopEnd } = badLoopSample(rate);
    return {
      data,
      sampleRate: rate,
      dwStart: 0,
      dwStartloop: loopStart,
      dwEndloop: loopEnd,
      looped: true,
      ...over,
    };
  };

  it('resamples to the bank rate and reports it', () => {
    const out = bakeSample(raw());
    expect(out.sampleRate).toBe(DEFAULT_BANK_RATE);
    expect(DEFAULT_BANK_RATE).toBe(32000);
  });

  it('emits Int16 with a loop and a 4-sample guard', () => {
    const out = bakeSample(raw());
    expect(out.pcm).toBeInstanceOf(Int16Array);
    expect(out.guard).toBe(4);
    expect(out.loopStart).toBeGreaterThan(0);
    expect(out.loopEnd).toBeGreaterThan(out.loopStart);
    expect(out.pcm.length).toBe(out.loopEnd + 4);
    expect(out.crossfadeApplied).toBeGreaterThan(0);
  });

  it('treats a one-shot as a one-shot: no loop, no fade, no guard', () => {
    const out = bakeSample(raw({ looped: false }));
    expect(out.loopStart).toBe(-1);
    expect(out.loopEnd).toBe(-1);
    expect(out.guard).toBe(0);
    expect(out.crossfadeApplied).toBe(0);
  });

  it('falls back to a one-shot when the loop region is invalid', () => {
    // A sample whose rebased region lands outside the data must not produce a loop the
    // engine would then read out of bounds.
    const out = bakeSample(raw({ dwStart: 999999 }));
    expect(out.loopStart).toBe(-1);
    expect(out.guard).toBe(0);
  });

  it('rebases through the full pipeline (absolute offsets in, correct loop out)', () => {
    const base = raw();
    const shifted = raw({
      dwStart: 500000,
      dwStartloop: 500000 + base.dwStartloop,
      dwEndloop: 500000 + base.dwEndloop,
    });
    expect(bakeSample(shifted).loopStart).toBe(bakeSample(base).loopStart);
    expect(bakeSample(shifted).loopEnd).toBe(bakeSample(base).loopEnd);
  });

  it('honours an explicit target rate', () => {
    const out = bakeSample(raw(), { targetRate: 22050 });
    expect(out.sampleRate).toBe(22050);
  });

  it('normalizes by default and can be told not to', () => {
    const quiet = sine(4000, 220, 44100, 0.05);
    const on = bakeSample(raw({ data: quiet }));
    const off = bakeSample(raw({ data: quiet }), { normalizeTo: null });
    const peakOf = (p: Int16Array) => Math.max(...Array.from(p).map(Math.abs));
    expect(peakOf(on.pcm)).toBeGreaterThan(30000);
    expect(peakOf(off.pcm)).toBeLessThan(3000);
  });
});

// ---- THE PHASE 1 GATE ---------------------------------------------------------------------

describe('GATE: loop-seam continuity', () => {
  /** Measure the wrap on a BAKED sample, reading it back the way the engine will. */
  function seamOf(out: { pcm: Int16Array; loopStart: number; loopEnd: number }): number {
    return loopSeamDiscontinuity(int16ToFloat(out.pcm), {
      loopStart: out.loopStart,
      loopEnd: out.loopEnd,
    });
  }

  it('the measurement itself separates a clean wrap from a real step', () => {
    // Guard the guard: a metric that always returned "fine" would make every test below
    // vacuous. Note a perfect loop scores ~1, not 0 — the wrap still advances one sample,
    // and on a cycle-aligned sine it does so at the zero crossing, the steepest point.
    const rate = 32000;
    const clean = sine(2000, 200, rate); // 160-sample period, loop on exact cycles
    const cleanScore = loopSeamDiscontinuity(clean, { loopStart: 320, loopEnd: 1280 });
    expect(cleanScore).toBeGreaterThan(0.5);
    expect(cleanScore).toBeLessThan(1.5);

    const cut = badLoopSample(rate);
    expect(loopSeamDiscontinuity(cut.data, cut)).toBeGreaterThan(5);
  });

  it('a deliberately mis-cut loop wraps cleanly AFTER baking', () => {
    const rate = 44100;
    const { data, loopStart, loopEnd } = badLoopSample(rate);
    const beforeSeam = loopSeamDiscontinuity(data, { loopStart, loopEnd });
    expect(beforeSeam).toBeGreaterThan(5); // the input really is broken

    const out = bakeSample({
      data,
      sampleRate: rate,
      dwStart: 0,
      dwStartloop: loopStart,
      dwEndloop: loopEnd,
      looped: true,
    });
    expect(seamOf(out)).toBeLessThan(1.5);
  });

  it('holds across rates, frequencies and loop placements', () => {
    // The real bank is 63 sourced multisounds across many zones; sweep the parameter
    // space the build script will actually hit rather than trusting one example.
    const rng = mulberry32(0xb0c1);
    for (const inRate of [22050, 32000, 44100, 48000]) {
      for (const freq of [55, 220, 880, 3000]) {
        const data = sine(6000, freq, inRate, 0.7);
        const period = inRate / freq;
        // deliberately off-cycle loop points, jittered
        const loopStart = Math.round(period * 3 + rng() * period);
        const loopEnd = Math.round(loopStart + period * 8 + rng() * period);
        if (loopEnd >= data.length) continue;
        const out = bakeSample({
          data,
          sampleRate: inRate,
          dwStart: 0,
          dwStartloop: loopStart,
          dwEndloop: loopEnd,
          looped: true,
        });
        expect(out.loopStart).toBeGreaterThan(0);
        expect(
          seamOf(out),
          `seam at inRate=${inRate} freq=${freq} loop=${loopStart}..${loopEnd}`,
        ).toBeLessThan(2);
      }
    }
  });

  it('the guard region continues the waveform rather than repeating the seam', () => {
    // A guard filled from the wrong place is invisible to a seam check but makes the
    // interpolator read garbage for the 4 samples straddling every wrap.
    const rate = 44100;
    const { data, loopStart, loopEnd } = badLoopSample(rate);
    const out = bakeSample({
      data,
      sampleRate: rate,
      dwStart: 0,
      dwStartloop: loopStart,
      dwEndloop: loopEnd,
      looped: true,
    });
    const f = int16ToFloat(out.pcm);
    for (let i = 0; i < LOOP_GUARD_SAMPLES; i++) {
      expect(f[out.loopEnd + i]!).toBeCloseTo(f[out.loopStart + i]!, 4);
    }
  });

  it('every baked sample ends with a guard exactly LOOP_GUARD_SAMPLES long', () => {
    const rate = 44100;
    const { data, loopStart, loopEnd } = badLoopSample(rate);
    const out = bakeSample({
      data,
      sampleRate: rate,
      dwStart: 0,
      dwStartloop: loopStart,
      dwEndloop: loopEnd,
      looped: true,
    });
    expect(out.pcm.length - out.loopEnd).toBe(LOOP_GUARD_SAMPLES);
  });
});
