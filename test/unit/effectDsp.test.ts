/**
 * The effect DSP — the nine blocks, the two-slot matrix, and the routing.
 *
 * The centrepiece is the AUDIBILITY SWEEP, which is the same instrument Phase 3 used on the
 * program layer and which caught three dead parameters there. Phase 4's version has more to
 * catch, because an effect parameter can die in one more place: the table can declare it, the
 * codec can encode it, and `EffectSlot.set` can simply never read it out of the params bag.
 * Nothing else in the project would notice — the parameter would be editable on the panel,
 * round-trip through the state tree, and do nothing.
 *
 * So: for every one of the 33 algorithms, set all of its parameters live, then change ONE and
 * require the rendered audio to differ.
 */

import { describe, expect, it } from 'vitest';
import {
  defaultEffectParams,
  defaultEffectsState,
  EFFECT_ALGORITHMS,
  type EffectAlgorithm,
  type EffectCodecName,
  type EffectSlotState,
  type EffectsState,
} from '../../data/effectParams';
import { DacQuantizer, EffectChain, EffectSlot, MAX_FX_BLOCK } from '../../src/engine/dsp/fx/effectChainCore';
import { rms } from '../helpers/spectral';

const SR = 32000;
/** Long enough for a reverb difference to show, short enough to run 130 times. */
const FRAMES = SR;

// ---- the probe signal ---------------------------------------------------------------------

/**
 * A quarter-second decaying tone burst, then silence.
 *
 * MONO IN BOTH CHANNELS, deliberately: that is exactly what the voice engine delivers (it
 * sums every slot to mono because the M1's stereo image comes from this section). A probe
 * that fed the two channels differently would let a broken stereo effect look like a working
 * one.
 *
 * The silent tail is what makes reverb and delay parameters measurable at all.
 */
function probeInput(): [Float32Array, Float32Array] {
  const l = new Float32Array(FRAMES);
  const r = new Float32Array(FRAMES);
  const burst = Math.floor(SR * 0.25);
  for (let i = 0; i < burst; i++) {
    const t = i / SR;
    const attack = Math.min(1, i / (SR * 0.004));
    const env = attack * Math.exp(-t * 4);
    l[i] =
      (env * (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 440 * t) + 0.25 * Math.sin(2 * Math.PI * 1320 * t))) /
      1.75;
    r[i] = l[i]!;
  }
  return [l, r];
}

const [IN_L, IN_R] = probeInput();

/** Render the whole probe through one slot, in control-block-sized chunks as the worklet does. */
function renderSlot(state: EffectSlotState): [Float32Array, Float32Array] {
  const slot = new EffectSlot(SR);
  slot.set(state);
  const outL = new Float32Array(FRAMES);
  const outR = new Float32Array(FRAMES);
  const bl = new Float32Array(64);
  const br = new Float32Array(64);
  for (let off = 0; off < FRAMES; off += 64) {
    const n = Math.min(64, FRAMES - off);
    slot.process(IN_L.subarray(off, off + n), IN_R.subarray(off, off + n), bl, br, n);
    outL.set(bl.subarray(0, n), off);
    outR.set(br.subarray(0, n), off);
  }
  return [outL, outR];
}

/** Render through the whole chain, which is what actually ships. */
function renderChain(effects: EffectsState): [Float32Array, Float32Array] {
  const chain = new EffectChain(SR);
  chain.set(effects);
  chain.setDacModel(false); // measure the DSP, not the output stage
  const outL = new Float32Array(IN_L);
  const outR = new Float32Array(IN_R);
  for (let off = 0; off < FRAMES; off += 64) {
    const n = Math.min(64, FRAMES - off);
    chain.process(outL.subarray(off, off + n), outR.subarray(off, off + n), n);
  }
  return [outL, outR];
}

function allFinite(buf: Float32Array): boolean {
  for (const v of buf) if (!Number.isFinite(v)) return false;
  return true;
}

/** Two renders differ if any sample moves by more than a whisker. */
function differs(a: Float32Array, b: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > 1e-6) return true;
  return false;
}

// ---- probe values -------------------------------------------------------------------------

/** A live, non-neutral value for each codec — the sweep's baseline. */
const PROBE: Record<EffectCodecName, number | string> = {
  u99: 60,
  s99: 40,
  s12: 6,
  s10: 4,
  balance: 70,
  revTime9: 3.0,
  revTime5: 2.0,
  erTime800: 300,
  erTime400: 200,
  preDelay200: 40,
  preDelay150: 40,
  delayTime: 120,
  chorusDelay: 20,
  flangerDelay: 10,
  lfoRate: 2.01,
  emphatic: 5,
  eqLowFc: 500,
  eqMidFc: 1000,
  eqHighFc: 2000,
  mgWave: 'SIN',
  mgPhase: '0',
  pan: 50,
};

/** A clearly different value, for the parameter under test. */
const ALT: Record<EffectCodecName, number | string> = {
  u99: 15,
  s99: -75,
  s12: -10,
  s10: -8,
  balance: 25,
  revTime9: 8.0,
  revTime5: 4.5,
  erTime800: 700,
  erTime400: 380,
  preDelay200: 190,
  preDelay150: 140,
  delayTime: 420,
  chorusDelay: 160,
  flangerDelay: 45,
  lfoRate: 7.02,
  emphatic: 10,
  eqLowFc: 1000,
  eqMidFc: 2000,
  eqHighFc: 4000,
  mgWave: 'TRI',
  mgPhase: '180',
  pan: 90,
};

/** Every parameter of an algorithm at its probe value — nothing left neutral. */
function probeSlot(algo: EffectAlgorithm): EffectSlotState {
  const params: Record<string, number | string> = { ...defaultEffectParams(algo.index) };
  for (const p of algo.params) params[p.id] = PROBE[p.codec]!;
  return { type: algo.index, balanceA: 70, balanceB: 70, params };
}

// ---- the sweep ------------------------------------------------------------------------------

describe('audibility sweep — every effect parameter reaches the DSP', () => {
  for (const algo of EFFECT_ALGORITHMS) {
    describe(`#${algo.index} ${algo.name}`, () => {
      const base = renderSlot(probeSlot(algo));

      it('renders finite, non-trivial audio', () => {
        expect(allFinite(base[0]), 'left channel went non-finite').toBe(true);
        expect(allFinite(base[1]), 'right channel went non-finite').toBe(true);
        expect(rms(base[0])).toBeGreaterThan(1e-4);
      });

      for (const p of algo.params) {
        it(`${p.id} changes the rendered audio`, () => {
          const state = probeSlot(algo);
          state.params[p.id] = ALT[p.codec]!;
          const changed = renderSlot(state);
          expect(allFinite(changed[0]) && allFinite(changed[1])).toBe(true);
          expect(
            differs(base[0], changed[0]) || differs(base[1], changed[1]),
            `${algo.name}.${p.id} is in the table but never reaches the DSP`,
          ).toBe(true);
        });
      }

      it('balance A changes the rendered audio', () => {
        const state = probeSlot(algo);
        state.balanceA = 20;
        expect(differs(base[0], renderSlot(state)[0])).toBe(true);
      });

      it('balance B changes the rendered audio', () => {
        const state = probeSlot(algo);
        state.balanceB = 20;
        const changed = renderSlot(state);
        // For the dual algorithms B is the SECOND STAGE's balance, so it moves both channels;
        // for the stereo ones it is the right channel's.
        expect(differs(base[1], changed[1])).toBe(true);
      });
    });
  }
});

// ---- the behaviours the sweep cannot see ------------------------------------------------------

describe('mono-sum in, stereo out', () => {
  it('makes the reverbs produce a genuinely stereo field from a mono source', () => {
    const [l, r] = renderSlot({ ...probeSlot(effect(1)), balanceA: 100, balanceB: 100 });
    expect(differs(l, r)).toBe(true);
    // Both channels carry comparable energy — decorrelated, not one-sided.
    expect(rms(l)).toBeGreaterThan(1e-4);
    expect(Math.abs(rms(l) - rms(r)) / rms(l)).toBeLessThan(0.5);
  });

  it('collapses the image for the drive algorithms, as BRIEF.md says it must', () => {
    for (const n of [21, 22]) {
      const [l, r] = renderSlot({ ...probeSlot(effect(n)), balanceA: 100, balanceB: 100 });
      // A mono-summed drive with no stereo stage after it returns identical channels.
      expect(differs(l, r), `#${n} should be mono-sum in`).toBe(false);
    }
  });
});

describe('the `I`/`II` variants really are one block and a phase bit', () => {
  it('separates the channels when PHASE is 180 and not when it is 0', () => {
    const inverted = renderSlot({
      ...probeSlot(effect(12)),
      params: { ...probeSlot(effect(12)).params, PHASE: '180' },
    });
    const inPhase = renderSlot({
      ...probeSlot(effect(12)),
      params: { ...probeSlot(effect(12)).params, PHASE: '0' },
    });
    // With a mono input and no phase offset the two channels stay identical; with 180 they
    // separate. That IS the difference between Stereo Chorus 1 and Stereo Chorus 2.
    expect(differs(inPhase[0], inPhase[1])).toBe(false);
    expect(differs(inverted[0], inverted[1])).toBe(true);
  });
});

describe('reverb time is a decay time, not a level', () => {
  it('leaves more energy late in the tail as the time grows', () => {
    const late = (t: number): number => {
      const s = probeSlot(effect(1));
      s.params['REVERB_TIME'] = t;
      s.balanceA = 100;
      s.balanceB = 100;
      const [l] = renderSlot(s);
      return rms(l.subarray(Math.floor(SR * 0.7)));
    };
    const short = late(0.5);
    const long = late(8.0);
    expect(long).toBeGreaterThan(short * 2);
  });
});

describe('the dry/wet law is a crossfade, not a send', () => {
  it('returns the dry signal exactly at balance 0', () => {
    const s = probeSlot(effect(1));
    s.balanceA = 0;
    s.balanceB = 0;
    const [l] = renderSlot(s);
    for (let i = 0; i < FRAMES; i += 97) expect(l[i]!).toBeCloseTo(IN_L[i]!, 6);
  });

  it('drops the dry entirely at balance 100', () => {
    // A reverb at 100% wet has no direct sound, so the burst's leading edge is gone.
    const s = probeSlot(effect(1));
    s.params['PRE_DELAY'] = 50;
    s.balanceA = 100;
    s.balanceB = 100;
    const [l] = renderSlot(s);
    expect(rms(l.subarray(0, Math.floor(SR * 0.01)))).toBeLessThan(rms(IN_L.subarray(0, Math.floor(SR * 0.01))) * 0.1);
  });

  it('sits between the two at an intermediate balance', () => {
    const at = (w: number): number => {
      const s = probeSlot(effect(1));
      s.balanceA = w;
      s.balanceB = w;
      return rms(renderSlot(s)[0].subarray(0, Math.floor(SR * 0.05)));
    };
    const dry = at(0);
    const mid = at(50);
    const wet = at(100);
    expect(mid).toBeLessThan(dry);
    expect(mid).toBeGreaterThan(wet);
  });
});

// ---- routing ------------------------------------------------------------------------------

describe('routing — 4 buses and a 2-effect matrix', () => {
  function chainWith(over: Partial<EffectsState>): EffectsState {
    const base = defaultEffectsState();
    return { ...base, ...over };
  }

  const chorus = (): EffectSlotState => probeSlot(effect(12));
  const hall = (): EffectSlotState => probeSlot(effect(1));

  it('passes the signal through untouched when both slots are NO EFFECT', () => {
    const [l, r] = renderChain(defaultEffectsState());
    expect(differs(l, IN_L)).toBe(false);
    expect(differs(r, IN_R)).toBe(false);
  });

  it('runs effect 1 into effect 2 in SERIAL', () => {
    const serial = renderChain(chainWith({ slots: [chorus(), hall()], serial: true }));
    const onlyOne = renderChain(chainWith({ slots: [chorus(), defaultEffectsState().slots[1]], serial: true }));
    expect(differs(serial[0], onlyOne[0])).toBe(true);
    // The reverb tail exists only in the serial render.
    const tail = (b: Float32Array) => rms(b.subarray(Math.floor(SR * 0.6)));
    expect(tail(serial[0])).toBeGreaterThan(tail(onlyOne[0]) * 5);
  });

  it('SILENCES effect 2 in PARALLEL, because a Program cannot reach the C/D buses', () => {
    // Not a bug: Program mode has no panpot page, so a program is hard-wired 5:5 into A/B,
    // and in PARALLEL the A/B path stops at effect 1. BRIEF.md and the manual's own routing
    // diagram both say so. Phase 5's Combinations get a panpot and can feed C/D.
    const parallel = renderChain(chainWith({ slots: [chorus(), hall()], serial: false }));
    const onlyOne = renderChain(chainWith({ slots: [chorus(), defaultEffectsState().slots[1]], serial: false }));
    expect(differs(parallel[0], onlyOne[0])).toBe(false);
  });

  it('bypasses one channel when its effect I/O bit is clear', () => {
    const both = renderChain(chainWith({ slots: [chorus(), defaultEffectsState().slots[1]] }));
    const leftOff = renderChain(
      chainWith({ slots: [chorus(), defaultEffectsState().slots[1]], fx1L: false }),
    );
    expect(differs(leftOff[0], IN_L)).toBe(false); // left is dry
    expect(differs(leftOff[1], both[1])).toBe(false); // right is untouched
  });

  it('never produces a non-finite sample, whatever the pair', () => {
    for (const a of EFFECT_ALGORITHMS) {
      const state = chainWith({ slots: [probeSlot(a), hall()], serial: true });
      const [l, r] = renderChain(state);
      expect(allFinite(l), `#${a.index} ${a.name} left`).toBe(true);
      expect(allFinite(r), `#${a.index} ${a.name} right`).toBe(true);
    }
  });

  it('keeps every algorithm inside a sane level, so nothing runs away', () => {
    for (const a of EFFECT_ALGORITHMS) {
      const [l, r] = renderChain(chainWith({ slots: [probeSlot(a), defaultEffectsState().slots[1]] }));
      let peak = 0;
      for (let i = 0; i < FRAMES; i++) peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!));
      expect(peak, `#${a.index} ${a.name} peaked at ${peak.toFixed(2)}`).toBeLessThan(8);
    }
  });
});

// ---- the output stage -------------------------------------------------------------------------

describe('the gain-ranged DAC model', () => {
  it('is deterministic — the same input twice gives byte-identical output', () => {
    const run = (): Float32Array => {
      const q = new DacQuantizer();
      const l = new Float32Array(IN_L);
      const r = new Float32Array(IN_R);
      for (let off = 0; off < FRAMES; off += 128) {
        const n = Math.min(128, FRAMES - off);
        q.process(l.subarray(off, off + n), r.subarray(off, off + n), n);
      }
      return l;
    };
    const a = run();
    const b = run();
    for (let i = 0; i < FRAMES; i++) expect(a[i]).toBe(b[i]);
  });

  it('quantizes — the output lands on a 16-bit grid, not between codes', () => {
    const q = new DacQuantizer();
    const l = new Float32Array([0.5, 0.123456789, -0.987654321, 0.0001]);
    const r = new Float32Array(l);
    q.process(l, r, 4);
    for (const v of l) {
      // At range 0 the step is 1/32768; every output must be an exact multiple of some
      // 2^-k/32768, which is what "quantized" means here.
      const scaled = v * 32768;
      expect(Math.abs(scaled - Math.round(scaled * 128) / 128)).toBeLessThan(1e-9);
    }
  });

  it('can be switched off, and then changes nothing at all', () => {
    const q = new DacQuantizer();
    q.enabled = false;
    const l = new Float32Array([0.123456789, -0.5555555]);
    const before = new Float32Array(l);
    q.process(l, new Float32Array(2), 2);
    expect(l[0]).toBe(before[0]);
    expect(l[1]).toBe(before[1]);
  });

  it('uses no randomness — quantization error IS the noise, exactly as on the hardware', () => {
    // CLAUDE.md forbids a PRNG in the signal path; its absence is what makes byte-exact
    // golden-buffer tests possible. Two fresh quantizers must agree sample for sample.
    const one = new DacQuantizer();
    const two = new DacQuantizer();
    const a = new Float32Array([0.4, 0.2, 0.1, 0.05, 0.02]);
    const b = new Float32Array(a);
    one.process(a, new Float32Array(5), 5);
    two.process(b, new Float32Array(5), 5);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('block-size independence', () => {
  it('renders the same audio at 32, 64 and 128 frames per call', () => {
    const render = (block: number): Float32Array => {
      const chain = new EffectChain(SR);
      chain.set({ ...defaultEffectsState(), slots: [probeSlot(effect(12)), probeSlot(effect(1))] });
      chain.setDacModel(false);
      const l = new Float32Array(IN_L);
      const r = new Float32Array(IN_R);
      for (let off = 0; off < FRAMES; off += block) {
        const n = Math.min(block, FRAMES - off);
        chain.process(l.subarray(off, off + n), r.subarray(off, off + n), n);
      }
      return l;
    };
    const a = render(32);
    const b = render(64);
    const c = render(128);
    // The LFO is evaluated once per call and interpolated, so block size shifts its phase
    // slightly; what must NOT happen is a gross divergence.
    const near = (x: Float32Array, y: Float32Array): number => {
      let worst = 0;
      for (let i = 0; i < FRAMES; i++) worst = Math.max(worst, Math.abs(x[i]! - y[i]!));
      return worst;
    };
    expect(near(a, b)).toBeLessThan(0.05);
    expect(near(b, c)).toBeLessThan(0.05);
  });

  it('accepts the largest block the worklet will ever hand it', () => {
    const chain = new EffectChain(SR);
    chain.set({ ...defaultEffectsState(), slots: [probeSlot(effect(1)), defaultEffectsState().slots[1]] });
    const l = new Float32Array(MAX_FX_BLOCK);
    const r = new Float32Array(MAX_FX_BLOCK);
    l.fill(0.3);
    r.fill(0.3);
    chain.process(l, r, MAX_FX_BLOCK);
    expect(allFinite(l) && allFinite(r)).toBe(true);
  });
});

function effect(index: number): EffectAlgorithm {
  const a = EFFECT_ALGORITHMS[index - 1];
  if (!a) throw new Error(`no effect ${index}`);
  return a;
}
