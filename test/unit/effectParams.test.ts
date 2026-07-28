/**
 * The effect parameter table — the 25-byte block, all 33 algorithms, and the grids.
 *
 * The equivalent of `programParams.test.ts` for Phase 4, and it carries one extra job: the
 * factory preload that settled several of these questions is NOT in the repo (it is Korg's
 * copyrighted bank), so the blocks that decided them are copied in here as fixtures. Without
 * that, the evidence for "the type byte is the effect number minus one" would live only in a
 * script that cannot run on a clean checkout.
 */

import { describe, expect, it } from 'vitest';
import {
  allowedTypesAgainst,
  coalesceEffectParams,
  coalesceEffectsState,
  decodeEffectParams,
  decodeEffects,
  defaultEffectParams,
  defaultEffectsState,
  effectAlgorithm,
  effectPairAllowed,
  encodeEffectParams,
  encodeEffects,
  EFFECT_ALGORITHMS,
  EFFECT_BLOCK_BYTES,
  EFFECT_BLOCK_START,
  EFFECT_COUNT,
  EFFECT_NAMES,
  EFFECT_PARAM_BYTES,
  EFFECT_THROUGH_BYTE,
  hzToLfoRate,
  LFO_RATE_MAX_BYTE,
  lfoRateToHz,
  snapEffectParam,
  snapEffectValue,
  type EffectsState,
} from '../../data/effectParams';
import { PROGRAM_RECORD_BYTES } from '../../data/programParams';
import { M1Store } from '../../src/state/m1State';

// ---- fixtures from Korg's factory preload ------------------------------------------------
//
// Each is the 25-byte effect block of a real factory program, lifted verbatim by
// `scripts/probeEffects.ts`. They are here because they are EVIDENCE: PLAN.md describes
// these three patches from an independent source, and the fact that the table decodes them
// to exactly those descriptions is what proves the byte layout is right.

/** I17 `Organ 2` — PLAN.md: "Stereo Chorus 1 at depth 99 with EQ +12/+12, into a 3.5 s Hall". */
const I17_ORGAN2 = [
  11, 0, 60, 60, 18, 18, 0, 0, 31,
  99, 9, 3, 0, 0, 0, 12, 12,
  33, 0, 20, 5, 50, 0, 0, 6,
];

/** I00 `Universe` — PLAN.md: "asymmetric 247/414 ms delay". */
const I00_UNIVERSE = [
  5, 9, 20, 20, 50, 50, 22, 0, 63,
  22, 0, 0, 20, 60, 0, 3, 3,
  247, 0, 80, 0, 158, 1, 3, 0,
];

/** I01 `Piano 16'` — PLAN.md: "the 5/10 ms full-wet doubler". */
const I01_PIANO16 = [
  9, 1, 100, 100, 19, 19, 0, 0, 31,
  10, 0, 48, 14, 5, 0, 3, 4,
  26, 0, 40, 30, 46, 0, 0, 253,
];

function recordWith(block: number[]): Uint8Array {
  const r = new Uint8Array(PROGRAM_RECORD_BYTES);
  r.set(block, EFFECT_BLOCK_START);
  return r;
}

// ---- structure ---------------------------------------------------------------------------

describe('effect catalogue — structure', () => {
  it('has 33 algorithms plus NO EFFECT', () => {
    expect(EFFECT_COUNT).toBe(33);
    expect(EFFECT_NAMES).toHaveLength(34);
    expect(EFFECT_NAMES[0]).toBe('NO EFFECT');
  });

  it('indexes algorithms by their 1-based hardware number', () => {
    EFFECT_ALGORITHMS.forEach((a, i) => expect(a.index).toBe(i + 1));
    expect(effectAlgorithm(1)?.name).toBe('HALL');
    expect(effectAlgorithm(12)?.name).toBe('STEREO CHORUS 1');
    expect(effectAlgorithm(33)?.name).toBe('DELAY/TREMOLO');
    expect(effectAlgorithm(0)).toBeNull();
    expect(effectAlgorithm(34)).toBeNull();
  });

  it('gives every parameter an offset inside the 8-byte block', () => {
    for (const a of EFFECT_ALGORITHMS) {
      for (const p of a.params) {
        expect(p.offset, `${a.name}.${p.id}`).toBeGreaterThanOrEqual(0);
        expect(p.offset, `${a.name}.${p.id}`).toBeLessThan(EFFECT_PARAM_BYTES);
      }
    }
  });

  it('never gives one algorithm two parameters on the same byte unless they are bits', () => {
    for (const a of EFFECT_ALGORITHMS) {
      const seen = new Map<number, string>();
      for (const p of a.params) {
        // WAVEFORM and PHASE deliberately share the MG Status byte; they are separate bits.
        const shared = p.id === 'PHASE' || p.id === 'WAVEFORM';
        const prev = seen.get(p.offset);
        if (prev && !shared) {
          expect.fail(`${a.name}: ${prev} and ${p.id} both claim offset ${p.offset}`);
        }
        seen.set(p.offset, p.id);
      }
    }
  });

  it('marks exactly the algorithms the default-values chart asterisks', () => {
    // M1R manual pp.56-57. The modulation family plus the two DSP-hungry ones.
    const expected = [12, 13, 14, 15, 16, 17, 18, 19, 24, 25, 30, 31, 32, 33];
    const actual = EFFECT_ALGORITHMS.filter((a) => a.asterisked).map((a) => a.index);
    expect(actual).toEqual(expected);
  });

  it('marks 26-33 as dual and nothing else', () => {
    const dual = EFFECT_ALGORITHMS.filter((a) => a.dual).map((a) => a.index);
    expect(dual).toEqual([26, 27, 28, 29, 30, 31, 32, 33]);
  });

  it('mono-sums the algorithms BRIEF.md names and no others', () => {
    // "Reverbs, Early Reflections, Overdrive, Distortion, Symphonic and Rotary."
    const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9, 21, 22, 24, 25];
    expect(EFFECT_ALGORITHMS.filter((a) => a.monoSum).map((a) => a.index)).toEqual(expected);
  });

  it('gives DISTORTION three parameters and no EQ HIGH', () => {
    // p.129 and the default-values chart independently list EQ Low alone. Over Drive has both.
    const d = effectAlgorithm(22)!;
    expect(d.params.map((p) => p.id)).toEqual(['DISTORTION', 'LEVEL', 'EQ_LOW']);
    expect(effectAlgorithm(21)!.params.some((p) => p.id === 'EQ_HIGH')).toBe(true);
  });

  it('gives chorus no feedback and flanger feedback', () => {
    // p.129 parenthesises `( Feed Back )` for the chorus/flanger table — the flanger's alone.
    expect(effectAlgorithm(12)!.params.some((p) => p.id === 'FEEDBACK')).toBe(false);
    expect(effectAlgorithm(14)!.params.some((p) => p.id === 'FEEDBACK')).toBe(true);
  });

  it('gives the chorus a 200 ms delay range and the flanger 50', () => {
    // p.129: `0~C8(32) : 0~200(50)`.
    const delayOf = (n: number) => effectAlgorithm(n)!.params.find((p) => p.id === 'DELAY_TIME')!;
    expect(delayOf(12).codec).toBe('chorusDelay');
    expect(delayOf(14).codec).toBe('flangerDelay');
  });
});

// ---- the quantization grids ---------------------------------------------------------------

describe('quantization grids — reproduced, not smoothed', () => {
  it('walks the LFO rate through its three documented segments', () => {
    // p.129 note *11-3-2, verbatim.
    expect(lfoRateToHz(0x00)).toBeCloseTo(0.03, 6);
    expect(lfoRateToHz(0x63)).toBeCloseTo(3.0, 6);
    expect(lfoRateToHz(0x64)).toBeCloseTo(3.1, 6);
    expect(lfoRateToHz(0xc7)).toBeCloseTo(13.0, 6);
    expect(lfoRateToHz(0xc8)).toBe(14);
    expect(lfoRateToHz(LFO_RATE_MAX_BYTE)).toBe(30);
  });

  it('steps by 0.03, then 0.1, then 1', () => {
    expect(lfoRateToHz(1) - lfoRateToHz(0)).toBeCloseTo(0.03, 6);
    expect(lfoRateToHz(0x65) - lfoRateToHz(0x64)).toBeCloseTo(0.1, 6);
    expect(lfoRateToHz(0xc9) - lfoRateToHz(0xc8)).toBe(1);
  });

  it('is a bijection across its whole domain', () => {
    for (let b = 0; b <= LFO_RATE_MAX_BYTE; b++) expect(hzToLfoRate(lfoRateToHz(b))).toBe(b);
  });

  it('puts the gate patch on 0.30 Hz, the chart default, from its factory byte', () => {
    // Independent confirmation of the (data+1)*0.03 offset: the chart says STEREO CHORUS 1
    // defaults to 0.30 Hz, and I17 Organ 2's factory byte is 9.
    expect(lfoRateToHz(9)).toBeCloseTo(0.3, 6);
  });

  it('snaps reverb time to 0.1 s and clamps Room at 4.9', () => {
    const hall = effectAlgorithm(1)!;
    const room = effectAlgorithm(4)!;
    const timeCodec = (a: typeof hall) => a.params.find((p) => p.id === 'REVERB_TIME')!.codec;
    expect(timeCodec(hall)).toBe('revTime9');
    expect(timeCodec(room)).toBe('revTime5');

    const b = new Uint8Array(8);
    encodeEffectParams(1, { ...defaultEffectParams(1), REVERB_TIME: 3.54 }, b);
    expect(decodeEffectParams(1, b)['REVERB_TIME']).toBeCloseTo(3.5, 6);
    encodeEffectParams(4, { ...defaultEffectParams(4), REVERB_TIME: 9.9 }, b);
    expect(decodeEffectParams(4, b)['REVERB_TIME']).toBeCloseTo(4.9, 6);
  });

  it('snaps E/R time to 10 ms', () => {
    const b = new Uint8Array(8);
    encodeEffectParams(7, { ...defaultEffectParams(7), ER_TIME: 174 }, b);
    expect(decodeEffectParams(7, b)['ER_TIME']).toBe(170);
    encodeEffectParams(7, { ...defaultEffectParams(7), ER_TIME: 9999 }, b);
    expect(decodeEffectParams(7, b)['ER_TIME']).toBe(800);
  });

  it('carries delay time across two bytes, little-endian', () => {
    const b = new Uint8Array(8);
    encodeEffectParams(10, { ...defaultEffectParams(10), DELAY_TIME_L: 414 }, b);
    expect(b[0]).toBe(414 & 0xff);
    expect(b[1]).toBe(414 >> 8);
    expect(decodeEffectParams(10, b)['DELAY_TIME_L']).toBe(414);
  });
});

// ---- the pairing restriction ---------------------------------------------------------------

describe('pairing restriction — enforced, not fixed', () => {
  it('bars Symphonic Ensemble opposite an asterisked effect', () => {
    // M1R p.57 verbatim.
    expect(effectPairAllowed(24, 12)).toBe(false);
    expect(effectPairAllowed(12, 24)).toBe(false);
    expect(effectPairAllowed(25, 33)).toBe(false);
  });

  it('bars #24 and #25 from each other, since both are asterisked', () => {
    expect(effectPairAllowed(24, 25)).toBe(false);
  });

  it('allows two asterisked effects that are not #24 or #25', () => {
    expect(effectPairAllowed(12, 14)).toBe(true);
    expect(effectPairAllowed(16, 18)).toBe(true);
  });

  it('allows #24 and #25 opposite a plain effect or nothing', () => {
    expect(effectPairAllowed(24, 1)).toBe(true);
    expect(effectPairAllowed(24, 26)).toBe(true);
    expect(effectPairAllowed(25, 0)).toBe(true);
  });

  it('reports the whole allowed set for a UI to grey out', () => {
    const against24 = allowedTypesAgainst(24);
    expect(against24).not.toContain(12);
    expect(against24).not.toContain(25);
    expect(against24).toContain(0);
    expect(against24).toContain(1);
    // Nothing is barred when the other slot is empty.
    expect(allowedTypesAgainst(0)).toHaveLength(EFFECT_COUNT + 1);
  });
});

// ---- the 25-byte block ----------------------------------------------------------------------

describe('the 25-byte block', () => {
  it('reserves exactly the bytes programParams.ts leaves alone', () => {
    expect(EFFECT_BLOCK_START).toBe(38);
    expect(EFFECT_BLOCK_BYTES).toBe(25);
    expect(EFFECT_BLOCK_START + EFFECT_BLOCK_BYTES).toBe(63);
  });

  it('maps the type byte to the effect number MINUS ONE, with 0x21 meaning Through', () => {
    const r = recordWith(I17_ORGAN2);
    expect(r[EFFECT_BLOCK_START]).toBe(11);
    expect(decodeEffects(r).slots[0].type).toBe(12);

    const off = new Uint8Array(PROGRAM_RECORD_BYTES);
    encodeEffects({ ...defaultEffectsState() }, off);
    expect(off[EFFECT_BLOCK_START]).toBe(EFFECT_THROUGH_BYTE);
    expect(decodeEffects(off).slots[0].type).toBe(0);
  });

  it('decodes I17 Organ 2 to exactly what PLAN.md describes', () => {
    const s = decodeEffects(recordWith(I17_ORGAN2));
    expect(effectAlgorithm(s.slots[0].type)!.name).toBe('STEREO CHORUS 1');
    expect(s.slots[0].params['DEPTH']).toBe(99);
    expect(s.slots[0].params['EQ_HIGH']).toBe(12);
    expect(s.slots[0].params['EQ_LOW']).toBe(12);
    expect(s.slots[0].params['SPEED']).toBeCloseTo(0.3, 6);
    expect(effectAlgorithm(s.slots[1].type)!.name).toBe('HALL');
    expect(s.slots[1].params['REVERB_TIME']).toBeCloseTo(3.5, 6);
    // "into a ... Hall" — serial, or the chorus would never reach it.
    expect(s.serial).toBe(true);
    expect(s.slots[1].balanceA).toBe(18);
  });

  it('decodes I00 Universe to the asymmetric 247/414 ms delay PLAN.md names', () => {
    const s = decodeEffects(recordWith(I00_UNIVERSE));
    expect(effectAlgorithm(s.slots[1].type)!.name).toBe('STEREO DELAY');
    expect(s.slots[1].params['DELAY_TIME_L']).toBe(247);
    expect(s.slots[1].params['DELAY_TIME_R']).toBe(414);
  });

  it('decodes I01 Piano 16 to the 5/10 ms full-wet doubler PLAN.md names', () => {
    const s = decodeEffects(recordWith(I01_PIANO16));
    expect(effectAlgorithm(s.slots[0].type)!.name).toBe('STEREO DELAY');
    expect(s.slots[0].params['DELAY_TIME_L']).toBe(10);
    expect(s.slots[0].params['DELAY_TIME_R']).toBe(5);
    expect(s.slots[0].balanceA).toBe(100);
  });

  it('round-trips all three factory blocks byte-for-byte', () => {
    for (const [name, block] of [
      ['I17', I17_ORGAN2],
      ['I00', I00_UNIVERSE],
      ['I01', I01_PIANO16],
    ] as const) {
      const src = recordWith(block);
      const out = new Uint8Array(PROGRAM_RECORD_BYTES);
      encodeEffects(decodeEffects(src), out);
      for (let i = 0; i < EFFECT_BLOCK_BYTES; i++) {
        const o = EFFECT_BLOCK_START + i;
        expect(out[o], `${name} block byte ${i}`).toBe(src[o]);
      }
    }
  });

  it('preserves the undocumented I/O bits rather than dropping them', () => {
    // I00 Universe's I/O byte is 63 = 0b111111: the five documented bits plus a bit 5 that
    // p.129 does not define but 33 of 100 factory programs set.
    const s = decodeEffects(recordWith(I00_UNIVERSE));
    expect(s.ioReserved).toBe(0b100000);
    expect(s.serial).toBe(true);
    const out = new Uint8Array(PROGRAM_RECORD_BYTES);
    encodeEffects(s, out);
    expect(out[EFFECT_BLOCK_START + 8]).toBe(63);
  });

  it('reads the routing bit and the four channel enables', () => {
    const r = recordWith(I17_ORGAN2);
    const s = decodeEffects(r);
    expect(s.serial).toBe(true);
    expect([s.fx1L, s.fx1R, s.fx2L, s.fx2R]).toEqual([true, true, true, true]);

    r[EFFECT_BLOCK_START + 8] = 0b00011; // effect 1 both channels, effect 2 off, PARALLEL
    const p = decodeEffects(r);
    expect(p.serial).toBe(false);
    expect([p.fx1L, p.fx1R, p.fx2L, p.fx2R]).toEqual([true, true, false, false]);
  });
});

// ---- defaults and coalescing ----------------------------------------------------------------

describe('defaults come from the M1R default-values chart', () => {
  it('gives HALL the chart\'s 3.5 s / 55 ms / 46 / 40%', () => {
    const d = defaultEffectParams(1);
    expect(d['REVERB_TIME']).toBe(3.5);
    expect(d['PRE_DELAY']).toBe(55);
    expect(d['ER_LEVEL']).toBe(46);
    expect(d['HIGH_DAMP']).toBe(40);
    expect(d['EQ_LOW']).toBe(-5);
  });

  it('gives the `I` variants a 180 degree phase and the `II` variants 0', () => {
    // The manual's prose, and MEASURED across the factory bank: bit1 set on 51 of 54 `I`
    // slots and clear on all 3 `II` slots.
    expect(defaultEffectParams(12)['PHASE']).toBe('180');
    expect(defaultEffectParams(13)['PHASE']).toBe('0');
    expect(defaultEffectParams(16)['PHASE']).toBe('180');
    expect(defaultEffectParams(17)['PHASE']).toBe('0');
    expect(defaultEffectParams(18)['PHASE']).toBe('180');
    expect(defaultEffectParams(19)['PHASE']).toBe('0');
  });

  it('gives every algorithm a default for every parameter it declares', () => {
    for (const a of EFFECT_ALGORITHMS) {
      const d = defaultEffectParams(a.index);
      for (const p of a.params) {
        expect(d[p.id], `${a.name}.${p.id}`).toBeDefined();
      }
    }
  });

  it('round-trips every algorithm\'s defaults through its 8 bytes', () => {
    for (const a of EFFECT_ALGORITHMS) {
      const b = new Uint8Array(8);
      const d = defaultEffectParams(a.index);
      encodeEffectParams(a.index, d, b);
      const back = decodeEffectParams(a.index, b);
      for (const p of a.params) {
        expect(back[p.id], `${a.name}.${p.id}`).toBe(d[p.id]);
      }
    }
  });
});

/**
 * Grid-snapping must be IDENTITY on a value that is already on the grid.
 *
 * This is the general form of a bug that shipped and was caught only by driving the app:
 * `encodeValue` returned the bare bit VALUE for the sub-byte codecs while `decodeValue` read
 * a bit POSITION, so round-tripping a value through both — which is exactly what snapping
 * does — rewrote PHASE '180' to '0'. That silently turned every `I` variant into its `II`,
 * which is the single most load-bearing bit in the effect section.
 *
 * Asserting idempotence over EVERY parameter of EVERY algorithm catches the whole class,
 * rather than the one instance that happened to be noticed.
 */
describe('snapping is identity on values already on the grid', () => {
  it('leaves every algorithm\'s defaults untouched', () => {
    for (const a of EFFECT_ALGORITHMS) {
      const d = defaultEffectParams(a.index);
      for (const p of a.params) {
        expect(snapEffectValue(p.codec, d[p.id]!), `${a.name}.${p.id}`).toBe(d[p.id]);
        expect(snapEffectParam(a.index, p.id, d[p.id]!), `${a.name}.${p.id}`).toBe(d[p.id]);
      }
    }
  });

  it('preserves both positions of every enumerated parameter', () => {
    // The failure was asymmetric — WAVEFORM survived (bit 0, no shift) and PHASE did not
    // (bit 1). So both positions of both are checked explicitly.
    for (const [codec, positions] of [
      ['mgWave', ['SIN', 'TRI']],
      ['mgPhase', ['0', '180']],
    ] as const) {
      for (const pos of positions) {
        expect(snapEffectValue(codec, pos), `${codec} ${pos}`).toBe(pos);
      }
    }
  });

  it('is idempotent — snapping twice is the same as snapping once', () => {
    for (const a of EFFECT_ALGORITHMS) {
      for (const p of a.params) {
        for (const probe of [0, 1, 7, 42.7, -13.3, 99, 250, 501]) {
          const once = snapEffectValue(p.codec, probe);
          expect(snapEffectValue(p.codec, once), `${a.name}.${p.id} @ ${probe}`).toBe(once);
        }
      }
    }
  });

  it('survives the store path a knob actually takes', () => {
    // setEffectType then setEffectParam is what the panel does; the bug lived in the second.
    const store = new M1Store();
    store.setEffectType(1, 12);
    store.setEffectParam(1, 'PHASE', '180');
    expect(store.getEffectParam(1, 'PHASE')).toBe('180');
    store.setEffectParam(1, 'WAVEFORM', 'TRI');
    expect(store.getEffectParam(1, 'WAVEFORM')).toBe('TRI');
    store.setEffectParam(1, 'DEPTH', 99);
    expect(store.getEffectParam(1, 'DEPTH')).toBe(99);
  });

  it('keeps WAVEFORM and PHASE from clobbering each other in their shared byte', () => {
    const b = new Uint8Array(8);
    encodeEffectParams(12, { ...defaultEffectParams(12), WAVEFORM: 'TRI', PHASE: '180' }, b);
    const back = decodeEffectParams(12, b);
    expect(back['WAVEFORM']).toBe('TRI');
    expect(back['PHASE']).toBe('180');
    expect(b[2]! & 0b11).toBe(0b11);
  });
});

describe('coalescing — a loaded bundle is untrusted input', () => {
  it('defaults both slots to NO EFFECT, so an INIT program is the dry path', () => {
    const d = defaultEffectsState();
    expect(d.slots[0].type).toBe(0);
    expect(d.slots[1].type).toBe(0);
  });

  it('drops parameters that do not belong to the selected algorithm', () => {
    const p = coalesceEffectParams(1, { REVERB_TIME: 2, NOT_A_PARAM: 5, DEPTH: 99 });
    expect(p['NOT_A_PARAM']).toBeUndefined();
    expect(p['DEPTH']).toBeUndefined();
    expect(p['REVERB_TIME']).toBe(2);
  });

  it('snaps an off-grid value onto the hardware grid', () => {
    const p = coalesceEffectParams(1, { REVERB_TIME: 3.4712 });
    expect(p['REVERB_TIME']).toBeCloseTo(3.5, 6);
  });

  it('replaces a non-finite or wrong-typed value with the default', () => {
    const p = coalesceEffectParams(12, { DEPTH: Number.NaN, WAVEFORM: 'SQUARE' });
    expect(p['DEPTH']).toBe(60);
    expect(p['WAVEFORM']).toBe('TRI');
  });

  it('clears slot 2 rather than shipping an illegal pair', () => {
    const s = coalesceEffectsState({
      slots: [
        { type: 24, balanceA: 50, balanceB: 50, params: {} },
        { type: 12, balanceA: 50, balanceB: 50, params: {} },
      ],
    } as Partial<EffectsState>);
    expect(s.slots[0].type).toBe(24);
    expect(s.slots[1].type).toBe(0);
  });

  it('survives a JSON round trip, which is the state tree\'s standing invariant', () => {
    const s = decodeEffects(recordWith(I17_ORGAN2));
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
