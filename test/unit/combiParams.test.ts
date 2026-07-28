/**
 * The 124-byte Combination table, pinned the way Phase 3 pinned the program table.
 *
 * The table is a transcription of a scanned 1988 manual (p.128 TABLE 2, cross-checked against
 * p.131 TABLE 6), so the risk is not a design mistake but a typo nobody notices until a
 * factory combination loads the wrong byte. Every assertion below is a transcription guard,
 * and the strongest are the ones that check the table against something OTHER than itself:
 * full byte accounting, the 11-byte timbre stride, and three real factory records.
 *
 * THE THREE RECORDS ARE THE POINT. `npm run probe:combis` round-trips all 100 of Korg's
 * combinations byte-exactly, but the preload is not vendored, so the findings that probe
 * settled are pinned here against records copied into this file. Each one carries a finding
 * the manual got wrong or left open — see the comments at `FACTORY`.
 */

import { describe, expect, it } from 'vitest';
import { validateControlDefs } from '../../data/schema';
import {
  coalesceCombiParams,
  COMBI_CONTROL_DEFS,
  COMBI_EFFECT_BLOCK_START,
  COMBI_NAME_BYTES,
  COMBI_PARAMS,
  COMBI_RECORD_BYTES,
  COMBI_TYPES,
  COMBI_TYPE_OFFSET,
  combiParam,
  CONTROL_FILTER_BITS,
  decodeCombi,
  decodeCombiName,
  decodeCombiParam,
  defaultCombiParams,
  encodeCombi,
  encodeCombiName,
  encodeCombiParam,
  PANPOT_CENTRE,
  PANPOT_POSITIONS,
  panpotGains,
  panpotIsCd,
  programIndexToRef,
  programRefToIndex,
  readSplitPoint,
  readVelSwitchPoint,
  TIMBRE_BLOCK_BASE,
  TIMBRE_BLOCK_BYTES,
  TIMBRE_COUNT,
  TIMBRE_ON_BIT,
  timbreParams,
  timbresInType,
  writeSplitPoint,
  writeVelSwitchPoint,
  type CombiParamDef,
} from '../../data/combiParams';
import { EFFECT_BLOCK_BYTES } from '../../data/effectParams';

const NAME_BYTES = new Set(Array.from({ length: COMBI_NAME_BYTES }, (_, i) => i));
const EFFECT_BYTES = new Set(
  Array.from({ length: EFFECT_BLOCK_BYTES }, (_, i) => COMBI_EFFECT_BLOCK_START + i),
);

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Three of Korg's own factory combinations, verbatim.
 *
 *  - `FilmScore` is MULTI, and carries the TIMBRE OFF question: its unused timbres set BOTH
 *    the program byte to 00H and byte+10 bit4.
 *  - `Pankala` is LAYER, and carries the undocumented nibble: its CONTROL FILTER bytes are
 *    0xFF, not 0x0F, so the top nibble p.128 does not describe is real data.
 *  - `Bass&Reed` is SPLIT, and is the record that refutes TABLE 6's footnote *14. Read as a
 *    byte offset, *14 = 68 gives a split point of 16; the key windows give 70, contiguous.
 */
const FACTORY = {
  FilmScore:
    '46696c6d53636f7265200401161616323265011f1a000f1e2e0000fd320100000000060617460000037f007f' +
    '01ff002d0a0c000c3c007f01ff001b14f400077f007f01ff00011900000c3c007f01ff0000630000057f007f' +
    '01ff1000630000057f007f01ff1000630000057f007f01ff1000630000057f007f01ff10',
  Pankala:
    '50616e6b616c61202020010b0044441a1a00001f6309030002000b061e000a5c300001fb0a410000057f007f' +
    '01ff002b1e0000057f007f01ff0000630000057f000001ff1000630000057f000001ff1000630000057f0000' +
    '01ff1000630000057f000001ff1000630000057f000001ff1000630000057f000001ff10',
  BassAndReed:
    '42617373265265656420020b013232181865011f630c0300040009081a001a1e2e0000fd063d00000545007f' +
    '01ff00203500000c7f467f01ff0000630000057f000001ff1000630000057f000001ff1000630000057f0000' +
    '01ff1000630000057f000001ff1000630000057f000001ff1000630000057f000001ff10',
} as const;

describe('combination parameter table — structure', () => {
  it('describes a 124-byte record', () => {
    expect(COMBI_RECORD_BYTES).toBe(124);
    expect(COMBI_NAME_BYTES).toBe(10);
    expect(COMBI_TYPE_OFFSET).toBe(10);
    expect(COMBI_EFFECT_BLOCK_START).toBe(11);
    expect(TIMBRE_BLOCK_BASE).toBe(36);
    expect(TIMBRE_BLOCK_BYTES).toBe(11);
    expect(TIMBRE_COUNT).toBe(8);
  });

  /**
   * The whole record must be accounted for exactly once: name, type, effect block, timbres.
   * This is the check that catches an off-by-one in the stride, because the last timbre byte
   * has to land on 123 with nothing over and nothing short.
   */
  it('accounts for every byte, with no gap and no overlap', () => {
    const owner = new Map<number, string>();
    const claim = (byte: number, by: string): void => {
      expect(owner.has(byte), `byte ${byte} claimed by ${owner.get(byte)} and ${by}`).toBe(false);
      owner.set(byte, by);
    };
    for (const b of NAME_BYTES) claim(b, 'name');
    claim(COMBI_TYPE_OFFSET, 'type');
    for (const b of EFFECT_BYTES) claim(b, 'effects');
    // Parameters may SHARE a byte (panpot with pan source, filters with each other), so the
    // timbre blocks are claimed by extent rather than per parameter.
    for (let t = 0; t < TIMBRE_COUNT; t++) {
      for (let k = 0; k < TIMBRE_BLOCK_BYTES; k++) {
        claim(TIMBRE_BLOCK_BASE + t * TIMBRE_BLOCK_BYTES + k, `timbre ${t + 1}`);
      }
    }
    expect(owner.size).toBe(COMBI_RECORD_BYTES);
    expect(Math.max(...owner.keys())).toBe(COMBI_RECORD_BYTES - 1);
  });

  /**
   * TABLE 6 prints all eight bases explicitly — 36, 47, 58, 69, 80, 91, 102, 113 — so this is
   * the manual checking itself, the same way Phase 3 used the OSC-2 = OSC-1 + 40 invariant.
   */
  it('places the eight timbre blocks on TABLE 6’s printed offsets', () => {
    const bases = [36, 47, 58, 69, 80, 91, 102, 113];
    for (let t = 1; t <= TIMBRE_COUNT; t++) {
      expect(combiParam(`T${t}_PROGRAM`).offset).toBe(bases[t - 1]);
      // TABLE 6's MIDI CHANNEL row: 46 57 68 79 90 101 112 123.
      expect(combiParam(`T${t}_CHANNEL`).offset).toBe(bases[t - 1]! + 10);
      // ...and its K. WINDOW TOP row: 41 52 63 74 85 96 107 118.
      expect(combiParam(`T${t}_KEY_TOP`).offset).toBe(bases[t - 1]! + 5);
    }
  });

  it('gives every timbre the same parameters at the same relative offsets', () => {
    const shape = (t: number): string[] =>
      timbreParams(t).map(
        (p) => `${p.id.replace(/^T\d_/, '')}@${p.offset - combiParam(`T${t}_PROGRAM`).offset}` +
          `${p.bit === undefined ? '' : `.${p.bit}`}:${p.codec}`,
      );
    const first = shape(1);
    expect(first.length).toBeGreaterThan(0);
    for (let t = 2; t <= TIMBRE_COUNT; t++) expect(shape(t)).toEqual(first);
  });

  it('has five types, and only MULTI uses all eight timbres', () => {
    expect([...COMBI_TYPES]).toEqual(['SINGLE', 'LAYER', 'SPLIT', 'VELOCITY SWITCH', 'MULTI']);
    expect(timbresInType('SINGLE')).toBe(1);
    expect(timbresInType('LAYER')).toBe(2);
    expect(timbresInType('SPLIT')).toBe(2);
    expect(timbresInType('VELOCITY SWITCH')).toBe(2);
    expect(timbresInType('MULTI')).toBe(8);
  });

  it('passes the shared ControlDef validator', () => {
    expect(validateControlDefs('combi', COMBI_CONTROL_DEFS)).toEqual([]);
  });

  it('has a default for every parameter, and every default is in range', () => {
    const d = defaultCombiParams();
    expect(Object.keys(d).length).toBe(COMBI_PARAMS.length);
    expect(coalesceCombiParams(d)).toEqual(d);
  });
});

describe('combination parameter table — the two polarity traps', () => {
  /**
   * The four MIDI filter bits are `0:DIS, 1:ENA`, so a SET bit RECEIVES. MEASURED: across
   * Korg's 800 factory timbres these bits are set 96-99% of the time, which is what an
   * authored bank looks like under this reading and absurd under the other.
   */
  it('reads a SET control-filter bit as ENA (receive)', () => {
    const rec = new Uint8Array(COMBI_RECORD_BYTES);
    const def = combiParam('T1_FILTER_DAMPER');
    expect(def.bit).toBe(CONTROL_FILTER_BITS.damper);
    rec[def.offset] = 0;
    expect(decodeCombiParam(def, rec, false)).toBe('DIS');
    rec[def.offset] = 1 << CONTROL_FILTER_BITS.damper;
    expect(decodeCombiParam(def, rec, false)).toBe('ENA');
  });

  /** ...and the timbre bit four positions away in the next byte means the OPPOSITE. */
  it('reads a SET timbre bit as OFF (silent) — the inverted one', () => {
    const rec = new Uint8Array(COMBI_RECORD_BYTES);
    const def = combiParam('T1_TIMBRE_OFF');
    expect(def.bit).toBe(TIMBRE_ON_BIT);
    rec[def.offset] = 0;
    expect(decodeCombiParam(def, rec, false)).toBe('ON');
    rec[def.offset] = 1 << TIMBRE_ON_BIT;
    expect(decodeCombiParam(def, rec, false)).toBe('OFF');
  });

  /**
   * A fresh timbre must be born with all four filters ENABLED. A cleared byte would block the
   * damper pedal on every new combination and read as a sustain bug in the engine.
   */
  it('defaults every MIDI filter to ENA and the timbre to ON', () => {
    const d = defaultCombiParams();
    for (let t = 1; t <= TIMBRE_COUNT; t++) {
      expect(d[`T${t}_FILTER_PROGRAM_CHANGE`]).toBe('ENA');
      expect(d[`T${t}_FILTER_DAMPER`]).toBe('ENA');
      expect(d[`T${t}_FILTER_AFTER_TOUCH`]).toBe('ENA');
      expect(d[`T${t}_FILTER_CONTROL_CHANGE`]).toBe('ENA');
      expect(d[`T${t}_TIMBRE_OFF`]).toBe('ON');
    }
  });
});

describe('combination parameter table — the program pointer', () => {
  it('maps I00..I99 then C00..C99 onto 0..199', () => {
    expect(programRefToIndex('I00')).toBe(0);
    expect(programRefToIndex('I99')).toBe(99);
    expect(programRefToIndex('C00')).toBe(100);
    expect(programRefToIndex('C99')).toBe(199);
    expect(programIndexToRef(0)).toBe('I00');
    expect(programIndexToRef(199)).toBe('C99');
    expect(programIndexToRef(200)).toBeNull();
    for (let i = 0; i < 200; i++) expect(programRefToIndex(programIndexToRef(i))).toBe(i);
  });

  /**
   * Note *12: the mapping SHIFTS BY ONE in MULTI, where 00H is TIMBRE OFF. This is the only
   * context-dependent field in the record, and getting it wrong is off-by-one on every
   * program in every MULTI combination.
   */
  it('shifts the whole map by one in MULTI, where 00H is TIMBRE OFF', () => {
    const rec = new Uint8Array(COMBI_RECORD_BYTES);
    const def = combiParam('T1_PROGRAM');
    rec[def.offset] = 0;
    expect(decodeCombiParam(def, rec, false)).toBe('I00');
    expect(decodeCombiParam(def, rec, true)).toBe('OFF');
    rec[def.offset] = 1;
    expect(decodeCombiParam(def, rec, false)).toBe('I01');
    expect(decodeCombiParam(def, rec, true)).toBe('I00');
    // The field's own range in TABLE 2 is 00~C7. p.128 also prints "C8H = C99" for the
    // non-MULTI case, which cannot be right and which the factory bank never exercises.
    rec[def.offset] = 0xc7;
    expect(decodeCombiParam(def, rec, false)).toBe('C99');
  });

  it('round-trips every program reference in both contexts', () => {
    const rec = new Uint8Array(COMBI_RECORD_BYTES);
    const def = combiParam('T1_PROGRAM');
    for (const isMulti of [false, true]) {
      for (let i = 0; i < 200; i++) {
        const ref = programIndexToRef(i)!;
        encodeCombiParam(def, ref, rec, isMulti);
        expect(decodeCombiParam(def, rec, isMulti)).toBe(ref);
      }
    }
    encodeCombiParam(def, 'OFF', rec, true);
    expect(decodeCombiParam(def, rec, true)).toBe('OFF');
  });
});

describe('combination parameter table — the panpot', () => {
  it('has fourteen positions, A through D', () => {
    expect(PANPOT_POSITIONS.length).toBe(14);
    expect(PANPOT_POSITIONS[0]).toBe('A');
    expect(PANPOT_POSITIONS[PANPOT_CENTRE]).toBe('5:5');
    expect(PANPOT_POSITIONS[10]).toBe('B');
    expect([...PANPOT_POSITIONS].slice(11)).toEqual(['C', 'C+D', 'D']);
  });

  it('routes only the last three positions to buses C/D', () => {
    for (let p = 0; p < 14; p++) expect(panpotIsCd(p)).toBe(p >= 11);
  });

  /**
   * Peak-normalised: the louder bus is always at unity and nothing ever exceeds it. THE
   * CENTRE BEING UNITY IS THE MEASURED CONSTRAINT — Program mode is documented as 5:5, so a
   * centred Combination timbre has to match a Program exactly. See `panpotGains`.
   */
  it('never exceeds unity, and puts the louder bus AT unity', () => {
    for (let p = 0; p < 14; p++) {
      const g = panpotGains(p);
      expect(Math.max(...g), `position ${p}`).toBe(1);
      for (const v of g) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  /** The two halves stand in exactly the ratio the display prints. */
  it('keeps the printed ratio exactly', () => {
    const ratios: [number, number][] = [
      [10, 0], [9, 1], [8, 2], [7, 3], [6, 4], [5, 5],
      [4, 6], [3, 7], [2, 8], [1, 9], [0, 10],
    ];
    ratios.forEach(([a, b], p) => {
      const g = panpotGains(p);
      // a : b === g[0] : g[1], compared by cross-multiplication so 0 halves are safe.
      expect(a * g[1]!, `position ${p} (${a}:${b})`).toBeCloseTo(b * g[0]!, 10);
    });
  });

  it('places A, centre, B, C, C+D and D on the right buses', () => {
    expect(panpotGains(0)).toEqual([1, 0, 0, 0]);
    expect(panpotGains(PANPOT_CENTRE)).toEqual([1, 1, 0, 0]);
    expect(panpotGains(10)).toEqual([0, 1, 0, 0]);
    expect(panpotGains(11)).toEqual([0, 0, 1, 0]);
    expect(panpotGains(12)).toEqual([0, 0, 1, 1]);
    expect(panpotGains(13)).toEqual([0, 0, 0, 1]);
  });

  it('keeps the pan source out of the pan nibble — they share a byte', () => {
    const rec = new Uint8Array(COMBI_RECORD_BYTES);
    const pan = combiParam('T1_PAN');
    const src = combiParam('T1_PAN_SOURCE');
    expect(pan.offset).toBe(src.offset);
    encodeCombiParam(src, 'INSTRUMENT', rec, false);
    encodeCombiParam(pan, 'C+D', rec, false);
    expect(decodeCombiParam(pan, rec, false)).toBe('C+D');
    expect(decodeCombiParam(src, rec, false)).toBe('INSTRUMENT');
  });
});

describe('combination parameter table — the derived split and velocity points', () => {
  /**
   * TABLE 6's footnote *14 reads as byte 68 and is not one. Byte 68 is timbre 3's on/off byte;
   * the split point is the pair of contiguous key windows. Pinned by `Bass&Reed` below.
   */
  it('derives the split point from the key windows, and writes both edges', () => {
    let p = writeSplitPoint(defaultCombiParams(), 60);
    expect(readSplitPoint(p)).toBe(60);
    expect(p['T1_KEY_TOP']).toBe(59);
    expect(p['T2_KEY_BOTTOM']).toBe(60);
    expect(p['T1_KEY_BOTTOM']).toBe(0);
    expect(p['T2_KEY_TOP']).toBe(127);
    // Idempotent, and the windows stay contiguous however far it moves.
    for (const point of [1, 36, 64, 108, 127]) {
      p = writeSplitPoint(p, point);
      expect(readSplitPoint(p)).toBe(point);
      expect(Number(p['T1_KEY_TOP']) + 1).toBe(point);
    }
    // Point 0 is the one place contiguity cannot hold: KEY TOP's range is 00~7F, so the lower
    // half clamps to the single key 0 rather than becoming empty. The velocity twin CAN go
    // empty, because VEL TOP reaches 0 while VEL BOTTOM starts at 1.
    p = writeSplitPoint(p, 0);
    expect(readSplitPoint(p)).toBe(0);
    expect(p['T1_KEY_TOP']).toBe(0);
  });

  /**
   * Manual p.70: "If the Velocity SW point is set to 1, the soft Program will not sound." An
   * empty window is the mechanism — `T1_VEL_TOP` becomes 0, which is exactly the value the
   * factory bank writes on unused timbres.
   */
  it('derives the velocity switch point, and point 1 silences the soft half', () => {
    const p = writeVelSwitchPoint(defaultCombiParams(), 64);
    expect(readVelSwitchPoint(p)).toBe(64);
    expect(p['T1_VEL_TOP']).toBe(63);
    expect(p['T2_VEL_BOTTOM']).toBe(64);
    const one = writeVelSwitchPoint(defaultCombiParams(), 1);
    expect(one['T1_VEL_TOP']).toBe(0);
    expect(Number(one['T1_VEL_TOP'])).toBeLessThan(Number(one['T1_VEL_BOTTOM']));
  });
});

describe('combination parameter table — against Korg’s own records', () => {
  /**
   * THE STRONGEST TEST HERE. `npm run probe:combis` round-trips all 100 factory combinations
   * byte-exactly across bytes 10..123; these three carry the findings that mattered.
   */
  it.each(Object.entries(FACTORY))('round-trips %s byte-exactly', (_name, hex) => {
    const rec = fromHex(hex);
    expect(rec.length).toBe(COMBI_RECORD_BYTES);
    const out = encodeCombi(decodeCombi(rec));
    // The effect block is Phase 4's and is measured by its own probe; the name is a display
    // string. This measures the type byte and the eight timbre blocks, which this table owns.
    for (let k = COMBI_TYPE_OFFSET; k < COMBI_RECORD_BYTES; k++) {
      if (EFFECT_BYTES.has(k)) continue;
      expect(out[k], `byte ${k}`).toBe(rec[k]);
    }
  });

  it('decodes FilmScore as a MULTI with the expected timbres', () => {
    const rec = fromHex(FACTORY.FilmScore);
    expect(decodeCombiName(rec)).toBe('FilmScore');
    const p = decodeCombi(rec);
    expect(p['COMBI_TYPE']).toBe('MULTI');
    // Four sounding timbres, four OFF — and the OFF ones use BOTH mechanisms at once.
    expect(p['T1_PROGRAM']).not.toBe('OFF');
    expect(p['T5_PROGRAM']).toBe('OFF');
    expect(p['T5_TIMBRE_OFF']).toBe('OFF');
    // The panpot routes two timbres to C+D — this is the half of the effect matrix that
    // Program mode cannot reach at all.
    expect(p['T2_PAN']).toBe('C+D');
    expect(p['T4_PAN']).toBe('C+D');
  });

  it('decodes Pankala as a LAYER whose filter bytes carry the undocumented nibble', () => {
    const rec = fromHex(FACTORY.Pankala);
    const p = decodeCombi(rec);
    expect(p['COMBI_TYPE']).toBe('LAYER');
    expect(p['T1_FILTER_DAMPER']).toBe('ENA');
    // p.128 documents bit3~0 of this byte. The factory value is 0xFF, so the top nibble is
    // real data and has to survive a round trip — see FILTER_RESERVED.
    expect(p['T1_FILTER_RESERVED']).toBe(0xf0);
    expect(rec[combiParam('T1_FILTER_RESERVED').offset]).toBe(0xff);
  });

  /** The record that refutes TABLE 6's *14. */
  it('decodes Bass&Reed as a SPLIT at key 70, not at byte 68’s value of 16', () => {
    const rec = fromHex(FACTORY.BassAndReed);
    expect(decodeCombiName(rec)).toBe('Bass&Reed');
    const p = decodeCombi(rec);
    expect(p['COMBI_TYPE']).toBe('SPLIT');
    expect(rec[68]).toBe(16); // timbre 3's TIMBRE OFF bit, not a split point
    expect(readSplitPoint(p)).toBe(70);
    expect(p['T1_KEY_TOP']).toBe(69);
    expect(p['T2_KEY_BOTTOM']).toBe(70);
  });

  it('round-trips the name field', () => {
    const rec = new Uint8Array(COMBI_RECORD_BYTES);
    encodeCombiName('Bass&Reed', rec);
    expect(decodeCombiName(rec)).toBe('Bass&Reed');
    encodeCombiName('WAY TOO LONG A NAME', rec);
    expect(decodeCombiName(rec).length).toBeLessThanOrEqual(COMBI_NAME_BYTES);
  });
});

describe('combination parameter table — coalescing', () => {
  it('heals junk, drops unknown keys, and never emits a non-finite number', () => {
    const healed = coalesceCombiParams({
      T1_LEVEL: Number.NaN,
      T2_LEVEL: 1e9,
      T3_TRANSPOSE: -400,
      T1_PAN: 'sideways',
      T1_PROGRAM: 'Z42',
      COMBI_TYPE: 'QUADRUPLE',
      NOT_A_PARAM: 7,
    });
    expect(healed['T1_LEVEL']).toBe(combiParam('T1_LEVEL').default);
    expect(healed['T2_LEVEL']).toBe(99);
    expect(healed['T3_TRANSPOSE']).toBe(-12);
    expect(healed['T1_PAN']).toBe('5:5');
    expect(healed['T1_PROGRAM']).toBe('I00');
    expect(healed['COMBI_TYPE']).toBe('SINGLE');
    expect('NOT_A_PARAM' in healed).toBe(false);
    for (const v of Object.values(healed)) {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    }
  });

  /** Every parameter, every codec: encode -> decode is the identity and is idempotent. */
  it('round-trips every parameter through its own byte', () => {
    const rec = new Uint8Array(COMBI_RECORD_BYTES);
    const sample = (p: CombiParamDef): (number | string)[] => {
      const def = COMBI_CONTROL_DEFS.find((c) => c.id === p.id)!;
      if (def.positions) return [...def.positions];
      const lo = def.min ?? 0;
      const hi = def.max ?? 127;
      return [lo, Math.round((lo + hi) / 2), hi];
    };
    for (const p of COMBI_PARAMS) {
      for (const v of sample(p)) {
        // `reserved` only owns the top nibble, so feed it values on that grid.
        const value = p.codec === 'reserved' ? Number(v) & 0xf0 : v;
        // OFF is expressible only in MULTI (note *12) — outside it there is no byte for it,
        // which is the whole reason the codec takes the type.
        const isMulti = value === 'OFF';
        encodeCombiParam(p, value, rec, isMulti);
        const back = decodeCombiParam(p, rec, isMulti);
        expect(back, `${p.id} = ${String(value)}`).toBe(value);
        encodeCombiParam(p, back, rec, isMulti);
        expect(decodeCombiParam(p, rec, isMulti), `${p.id} idempotent`).toBe(value);
      }
    }
  });
});
