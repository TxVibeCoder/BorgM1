/**
 * The DSP cores: envelope, filter, sample player, keymap.
 *
 * Two of Phase 2's three named click sources are pinned here (the ~5 ms minimum release
 * clamp and the loop seam under real playback); the third, the 4 ms steal fade, lives with
 * the allocator. The golden-buffer gate is in goldenBuffer.test.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  ampEgConfig,
  EG_TIME_MAX_S,
  EG_TIME_MIN_S,
  egTimeToSeconds,
  filterEgConfig,
  makeEgState,
  MIN_RELEASE_S,
  noteOff,
  noteOn,
  PITCH_EG_MAX_SEMITONES,
  pitchEgConfig,
  process,
} from '../../src/engine/dsp/levelTimeEgCore';
import {
  cutoffCoefficient,
  keyboardTrackingRatio,
  makeLowpassState,
  MIN_CUTOFF_HZ,
  processBlock,
  processSample,
} from '../../src/engine/dsp/lowpassCore';
import {
  hasGuard,
  hermite,
  incrementFor,
  makePlayerState,
  renderInto,
  startPlayer,
  type SampleRef,
} from '../../src/engine/dsp/samplePlayerCore';
import {
  buildKeymap,
  keyRange,
  keySounds,
  KEYMAP_ENTRIES,
  lookup,
  NO_SAMPLE,
} from '../../src/engine/voice/keymapCore';
import { bakeSample } from '../../src/engine/sample/bakeCore';
import { int16ToFloat } from '../../src/engine/sample/pcmCore';

// ---- envelope ---------------------------------------------------------------------------

describe('levelTimeEgCore — ONE envelope, three configurations', () => {
  const run = (st: ReturnType<typeof makeEgState>, cfg: ReturnType<typeof ampEgConfig>, seconds: number, dt = 1 / 32000) => {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) process(st, cfg, dt);
    return st.level;
  };

  it('egTimeToSeconds is monotonic across the whole 0..99 range', () => {
    expect(egTimeToSeconds(0)).toBeCloseTo(EG_TIME_MIN_S, 6);
    expect(egTimeToSeconds(99)).toBeCloseTo(EG_TIME_MAX_S, 6);
    for (let v = 1; v <= 99; v++) {
      expect(egTimeToSeconds(v)).toBeGreaterThan(egTimeToSeconds(v - 1));
    }
  });

  it('clamps an out-of-range time parameter rather than producing a negative duration', () => {
    expect(egTimeToSeconds(-10)).toBe(egTimeToSeconds(0));
    expect(egTimeToSeconds(200)).toBe(egTimeToSeconds(99));
  });

  it('AMP: reaches the sustain level and HOLDS there until note-off', () => {
    const cfg = ampEgConfig({
      attackTime: 0, attackLevel: 1, decayTime: 0, breakPoint: 0.8,
      slopeTime: 0, sustainLevel: 0.5, releaseTime: 20,
    });
    const st = makeEgState();
    noteOn(st, cfg);
    run(st, cfg, 0.5);
    expect(st.phase).toBe('sustain');
    expect(st.level).toBeCloseTo(0.5, 5);
    run(st, cfg, 5); // still held
    expect(st.level).toBeCloseTo(0.5, 5);
  });

  it('AMP: releases to ZERO — there is no release level', () => {
    const cfg = ampEgConfig({
      attackTime: 0, attackLevel: 1, decayTime: 0, breakPoint: 1,
      slopeTime: 0, sustainLevel: 1, releaseTime: 20,
    });
    expect(cfg.release.level).toBe(0);
    const st = makeEgState();
    noteOn(st, cfg);
    run(st, cfg, 0.2);
    noteOff(st, cfg);
    run(st, cfg, 5);
    expect(st.level).toBe(0);
    expect(st.phase).toBe('done');
  });

  it('FILTER: releases to a LEVEL, and that asymmetry is the point', () => {
    const cfg = filterEgConfig({
      attackTime: 0, attackLevel: 1, decayTime: 0, breakPoint: 1,
      slopeTime: 0, sustainLevel: 1, releaseTime: 10, releaseLevel: -0.4,
    });
    const st = makeEgState();
    noteOn(st, cfg);
    run(st, cfg, 0.2);
    noteOff(st, cfg);
    run(st, cfg, 5);
    expect(st.level).toBeCloseTo(-0.4, 5);
  });

  it('FILTER: is signed — it swings both ways around the cutoff', () => {
    const cfg = filterEgConfig({
      attackTime: 0, attackLevel: -1, decayTime: 0, breakPoint: -0.5,
      slopeTime: 0, sustainLevel: -0.5, releaseTime: 0, releaseLevel: 0,
    });
    const st = makeEgState();
    noteOn(st, cfg);
    run(st, cfg, 0.5);
    expect(st.level).toBeLessThan(0);
  });

  it('PITCH: has no sustain — it completes without waiting for the key', () => {
    const cfg = pitchEgConfig({
      startLevel: 12, attackTime: 0, attackLevel: 0, decayTime: 0,
      releaseTime: 0, releaseLevel: 0,
    });
    expect(cfg.sustainStage).toBe(-1);
    const st = makeEgState();
    noteOn(st, cfg);
    expect(st.level).toBeCloseTo(12, 5); // starts displaced
    run(st, cfg, 1);
    expect(st.phase).toBe('done');
    expect(st.level).toBeCloseTo(0, 5);
  });

  it('PITCH: clamps to +/-1 octave', () => {
    const cfg = pitchEgConfig({
      startLevel: 99, attackTime: 10, attackLevel: -99, decayTime: 10,
      releaseTime: 0, releaseLevel: 99,
    });
    expect(cfg.startLevel).toBe(PITCH_EG_MAX_SEMITONES);
    expect(cfg.stages[0]!.level).toBe(-PITCH_EG_MAX_SEMITONES);
    expect(cfg.release.level).toBe(PITCH_EG_MAX_SEMITONES);
  });

  it('CLICK SOURCE 2: release is clamped to a ~5 ms floor', () => {
    // A release time of 0 is a reachable parameter value, not an edge case, and an
    // instantaneous drop to zero is a step discontinuity — i.e. a click on every note-off.
    const cfg = ampEgConfig({
      attackTime: 0, attackLevel: 1, decayTime: 0, breakPoint: 1,
      slopeTime: 0, sustainLevel: 1, releaseTime: 0,
    });
    const st = makeEgState();
    noteOn(st, cfg);
    run(st, cfg, 0.2);
    expect(st.level).toBeCloseTo(1, 5);
    noteOff(st, cfg);
    // after HALF the minimum release, the level must be part-way down, not already 0
    const dt = 1 / 32000;
    for (let i = 0; i < Math.round((MIN_RELEASE_S / 2) / dt); i++) process(st, cfg, dt);
    expect(st.level).toBeGreaterThan(0.2);
    expect(st.level).toBeLessThan(0.8);
    expect(MIN_RELEASE_S).toBe(0.005);
  });

  it('does not lose stages when a block spans several of them', () => {
    // A 128-sample block at 32 kHz is 4 ms; several EG stages can be shorter than that, and
    // skipping one turns a fast attack into a slow one.
    const cfg = ampEgConfig({
      attackTime: 0, attackLevel: 1, decayTime: 0, breakPoint: 0.5,
      slopeTime: 0, sustainLevel: 0.25, releaseTime: 30,
    });
    const st = makeEgState();
    noteOn(st, cfg);
    process(st, cfg, 0.5); // one huge step across every stage at once
    expect(st.phase).toBe('sustain');
    expect(st.level).toBeCloseTo(0.25, 5);
  });

  it('note-off before the envelope even starts is a no-op', () => {
    const cfg = ampEgConfig({
      attackTime: 10, attackLevel: 1, decayTime: 10, breakPoint: 1,
      slopeTime: 10, sustainLevel: 1, releaseTime: 10,
    });
    const st = makeEgState();
    noteOff(st, cfg);
    expect(st.phase).toBe('idle');
  });
});

// ---- filter -----------------------------------------------------------------------------

describe('lowpassCore', () => {
  const SR = 32000;

  it('clamps the cutoff below Nyquist — an EG WILL push it there', () => {
    // tan() diverges approaching pi/2; an un-clamped cutoff at Nyquist yields an infinite
    // coefficient and silences the voice for good.
    const c = cutoffCoefficient(1e9, SR);
    expect(Number.isFinite(c)).toBe(true);
    expect(c).toBeLessThan(1);
    expect(cutoffCoefficient(0, SR)).toBe(cutoffCoefficient(MIN_CUTOFF_HZ, SR));
  });

  it('passes DC and attenuates above the cutoff', () => {
    const st = makeLowpassState();
    const c = cutoffCoefficient(1000, SR);
    let dc = 0;
    for (let i = 0; i < 4000; i++) dc = processSample(st, 1, c);
    expect(dc).toBeCloseTo(1, 3);

    const rms = (freq: number) => {
      const s = makeLowpassState();
      let acc = 0;
      let n = 0;
      for (let i = 0; i < 8000; i++) {
        const y = processSample(s, Math.sin((2 * Math.PI * freq * i) / SR), c);
        if (i > 4000) {
          acc += y * y;
          n++;
        }
      }
      return Math.sqrt(acc / n);
    };
    expect(rms(200)).toBeGreaterThan(0.6);
    expect(rms(8000)).toBeLessThan(rms(1000));
    expect(rms(8000)).toBeLessThan(0.1);
  });

  it('is NON-RESONANT by default — no peak at the cutoff', () => {
    // The hardware filter has no resonance. Resonance is a plugin-era extension and must
    // default off, or the Phase 4 fidelity gate cannot pass.
    const c = cutoffCoefficient(1000, SR);
    const rmsAt = (freq: number, res: number) => {
      const s = makeLowpassState();
      let acc = 0;
      let n = 0;
      for (let i = 0; i < 8000; i++) {
        const y = processSample(s, Math.sin((2 * Math.PI * freq * i) / SR), c, res);
        if (i > 4000) {
          acc += y * y;
          n++;
        }
      }
      return Math.sqrt(acc / n);
    };
    // no resonance: response at cutoff is below the passband, never above it
    expect(rmsAt(1000, 0)).toBeLessThan(rmsAt(100, 0));
    // with the extension on, the cutoff region rises — proving the default really is off
    expect(rmsAt(1000, 0.6)).toBeGreaterThan(rmsAt(1000, 0));
  });

  it('interpolates the coefficient across a block rather than stepping it', () => {
    const a = makeLowpassState();
    const b = makeLowpassState();
    const buf1 = new Float32Array(128).fill(1);
    const buf2 = new Float32Array(128).fill(1);
    const c0 = cutoffCoefficient(200, SR);
    const c1 = cutoffCoefficient(8000, SR);
    processBlock(a, buf1, 0, 128, c0, c1);
    processBlock(b, buf2, 0, 128, c1, c1); // stepped straight to the end value
    expect(buf1[0]).not.toBeCloseTo(buf2[0]!, 6);
    expect(buf1[127]).toBeCloseTo(buf2[127]!, 1);
  });

  it('TRAP: keyboard tracking of 0 means 100% tracking, not none', () => {
    // Negative values are what give you NO tracking. This silently affects every patch.
    expect(keyboardTrackingRatio(0, 72)).toBeCloseTo(2, 6); // an octave up doubles the cutoff
    expect(keyboardTrackingRatio(0, 48)).toBeCloseTo(0.5, 6);
    expect(keyboardTrackingRatio(-99, 72)).toBeCloseTo(1, 6); // fully off
    expect(keyboardTrackingRatio(0, 60)).toBeCloseTo(1, 6);
  });
});

// ---- sample player ------------------------------------------------------------------------

describe('samplePlayerCore', () => {
  const ramp = (n: number) => Float32Array.from({ length: n }, (_, i) => i);

  it('hermite passes through its control points', () => {
    expect(hermite(0, 1, 2, 3, 0)).toBeCloseTo(1, 10);
    expect(hermite(0, 1, 2, 3, 1)).toBeCloseTo(2, 10);
  });

  it('hermite reproduces a straight line exactly', () => {
    for (const t of [0, 0.25, 0.5, 0.75]) {
      expect(hermite(0, 1, 2, 3, t)).toBeCloseTo(1 + t, 10);
    }
  });

  it('plays a one-shot and stops, without reading past the end', () => {
    const ref: SampleRef = { data: ramp(64), loopStart: -1, loopEnd: -1 };
    const st = makePlayerState();
    startPlayer(st);
    const out = new Float32Array(256);
    const written = renderInto(out, 0, 256, ref, st, 1, 1, 1, 1);
    expect(st.active).toBe(false);
    expect(written).toBeLessThan(256);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('wraps a loop and keeps going indefinitely', () => {
    const data = new Float32Array(100);
    for (let i = 0; i < 100; i++) data[i] = Math.sin((2 * Math.PI * i) / 40);
    const ref: SampleRef = { data, loopStart: 20, loopEnd: 60 };
    const st = makePlayerState();
    startPlayer(st, 20);
    const out = new Float32Array(4000);
    const written = renderInto(out, 0, 4000, ref, st, 1, 1, 1, 1);
    expect(written).toBe(4000);
    expect(st.active).toBe(true);
    expect(st.phase).toBeGreaterThanOrEqual(20);
    expect(st.phase).toBeLessThan(60);
  });

  it('handles an increment that crosses the loop more than once per sample', () => {
    // Playing a low sample high up the keyboard. A single `if` instead of a `while` reads
    // past loopEnd here, into the guard and then out of bounds.
    const data = new Float32Array(64);
    const ref: SampleRef = { data, loopStart: 8, loopEnd: 12 }; // 4-sample loop
    const st = makePlayerState();
    startPlayer(st, 8);
    const out = new Float32Array(64);
    renderInto(out, 0, 64, ref, st, 9, 9, 1, 1); // increment > loop length
    expect(st.phase).toBeGreaterThanOrEqual(8);
    expect(st.phase).toBeLessThan(12);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('reads the LOOP END as the predecessor at loopStart, not the file order', () => {
    // The guard covers the interpolator's forward reach; this is the backward one. For a
    // loopStart of 0 there is no data[-1] at all.
    const data = Float32Array.from({ length: 8 }, (_, i) => i + 1);
    const ref: SampleRef = { data, loopStart: 0, loopEnd: 4 };
    const st = makePlayerState();
    startPlayer(st, 0);
    const out = new Float32Array(16);
    renderInto(out, 0, 16, ref, st, 1, 1, 1, 1);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
    // exactly on a sample, hermite returns the control point regardless of its neighbours
    expect(out[0]).toBeCloseTo(1, 6);
  });

  it('ADDS into the output so oscillators can be summed', () => {
    const ref: SampleRef = { data: new Float32Array(64).fill(0.25), loopStart: 8, loopEnd: 40 };
    const out = new Float32Array(16).fill(0.5);
    const st = makePlayerState();
    startPlayer(st, 8);
    renderInto(out, 0, 16, ref, st, 1, 1, 1, 1);
    expect(out[0]).toBeCloseTo(0.75, 5);
  });

  it('INTERPOLATES the increment across the block instead of stepping it', () => {
    // A fast pitch EG steps audibly otherwise — and fast transient bends are exactly what
    // the M1's pitch EG is for.
    const data = Float32Array.from({ length: 4096 }, (_, i) => i);
    const ref: SampleRef = { data, loopStart: -1, loopEnd: -1 };

    const a = makePlayerState();
    startPlayer(a, 0);
    renderInto(new Float32Array(128), 0, 128, ref, a, 1, 3, 1, 1);

    const b = makePlayerState();
    startPlayer(b, 0);
    renderInto(new Float32Array(128), 0, 128, ref, b, 3, 3, 1, 1);

    // ramping 1->3 must land between holding 1 and holding 3
    expect(a.phase).toBeGreaterThan(128 * 1);
    expect(a.phase).toBeLessThan(b.phase);
  });

  it('incrementFor maps note, root and detune to a playback ratio', () => {
    expect(incrementFor(60, 60, 0, 32000, 32000)).toBeCloseTo(1, 10);
    expect(incrementFor(72, 60, 0, 32000, 32000)).toBeCloseTo(2, 10);
    expect(incrementFor(48, 60, 0, 32000, 32000)).toBeCloseTo(0.5, 10);
    // rate conversion: a 32k sample played at 48k output runs slower per output sample
    expect(incrementFor(60, 60, 0, 32000, 48000)).toBeCloseTo(32000 / 48000, 10);
    // +100 cents == +1 semitone
    expect(incrementFor(60, 60, 100, 32000, 32000)).toBeCloseTo(Math.pow(2, 1 / 12), 10);
    // pitch EG offset is additive in semitones
    expect(incrementFor(60, 60, 0, 32000, 32000, 12)).toBeCloseTo(2, 10);
  });

  it('hasGuard rejects a sample whose guard region is missing', () => {
    expect(hasGuard({ data: new Float32Array(100), loopStart: 20, loopEnd: 60 })).toBe(true);
    expect(hasGuard({ data: new Float32Array(62), loopStart: 20, loopEnd: 60 })).toBe(false);
    expect(hasGuard({ data: new Float32Array(64), loopStart: 20, loopEnd: 60 })).toBe(true);
  });
});

// ---- the loop seam, under real playback ---------------------------------------------------

describe('CLICK SOURCE 1: the loop seam survives actual playback', () => {
  it('a baked sample loops for seconds with no step at any wrap', () => {
    // The bake's seam metric checks the data. This checks what the PLAYER produces, which
    // is the thing anyone actually hears — interpolation across the wrap included.
    const rate = 44100;
    const src = new Float32Array(4000);
    for (let i = 0; i < src.length; i++) src[i] = 0.8 * Math.sin((2 * Math.PI * 220 * i) / rate);
    const period = rate / 220;
    const baked = bakeSample({
      data: src,
      sampleRate: rate,
      dwStart: 0,
      dwStartloop: Math.round(period * 4),
      dwEndloop: Math.round(period * 12 + period / 3), // deliberately off-cycle
      looped: true,
    });

    const ref: SampleRef = {
      data: int16ToFloat(baked.pcm),
      loopStart: baked.loopStart,
      loopEnd: baked.loopEnd,
    };
    const st = makePlayerState();
    startPlayer(st, ref.loopStart);
    const out = new Float32Array(64000); // 2 s at 32 kHz, many hundreds of wraps
    renderInto(out, 0, out.length, ref, st, 1, 1, 1, 1);

    // No output step may exceed the largest step the waveform itself makes.
    let maxStep = 0;
    for (let i = 1; i < out.length; i++) maxStep = Math.max(maxStep, Math.abs(out[i]! - out[i - 1]!));
    const expectedStep = 0.8 * 2 * Math.PI * (220 / 32000); // ~ derivative of the sine per sample
    expect(maxStep).toBeLessThan(expectedStep * 2.5);
  });
});

// ---- keymap --------------------------------------------------------------------------------

describe('keymapCore', () => {
  it('is 128x128 = 32 KB of uint16 per oscillator', () => {
    const t = buildKeymap([]);
    expect(t).toBeInstanceOf(Uint16Array);
    expect(t.length).toBe(KEYMAP_ENTRIES);
    expect(KEYMAP_ENTRIES).toBe(16384);
    expect(t.byteLength).toBe(32768);
  });

  it('defaults to NO_SAMPLE everywhere', () => {
    const t = buildKeymap([]);
    expect(lookup(t, 60, 100)).toBe(NO_SAMPLE);
    expect(keyRange(t)).toEqual([-1, -1]);
  });

  it('maps key zones across the full velocity range by default', () => {
    // A multisound has NO velocity zones — architecturally, not by omission.
    const t = buildKeymap([
      { keyLow: 0, keyHigh: 59, sampleIndex: 0 },
      { keyLow: 60, keyHigh: 127, sampleIndex: 1 },
    ]);
    for (const v of [1, 64, 127]) {
      expect(lookup(t, 59, v)).toBe(0);
      expect(lookup(t, 60, v)).toBe(1);
    }
  });

  it('supports velocity windows, for Combi velocity switches and drum kits', () => {
    const t = buildKeymap([
      { keyLow: 60, keyHigh: 60, sampleIndex: 0, velLow: 1, velHigh: 63 },
      { keyLow: 60, keyHigh: 60, sampleIndex: 1, velLow: 64, velHigh: 127 },
    ]);
    expect(lookup(t, 60, 40)).toBe(0);
    expect(lookup(t, 60, 100)).toBe(1);
  });

  it('reports the sounding key range — multisounds do not all span the keyboard', () => {
    const t = buildKeymap([{ keyLow: 24, keyHigh: 96, sampleIndex: 3 }]);
    expect(keyRange(t)).toEqual([24, 96]);
    expect(keySounds(t, 23)).toBe(false);
    expect(keySounds(t, 24)).toBe(true);
    expect(keySounds(t, 97)).toBe(false);
  });

  it('clamps out-of-range zone bounds instead of writing out of the table', () => {
    const t = buildKeymap([{ keyLow: -50, keyHigh: 500, sampleIndex: 7 }]);
    expect(lookup(t, 0, 0)).toBe(7);
    expect(lookup(t, 127, 127)).toBe(7);
    expect(keyRange(t)).toEqual([0, 127]);
  });

  it('ignores an inverted zone rather than writing nothing and reporting success', () => {
    const t = buildKeymap([{ keyLow: 90, keyHigh: 10, sampleIndex: 1 }]);
    expect(keyRange(t)).toEqual([-1, -1]);
  });

  it('lookup masks its inputs, so a transposed key cannot read out of bounds', () => {
    const t = buildKeymap([{ keyLow: 0, keyHigh: 127, sampleIndex: 2 }]);
    expect(lookup(t, 200, 300)).toBe(2);
    expect(Number.isFinite(lookup(t, -5, -5))).toBe(true);
  });
});
