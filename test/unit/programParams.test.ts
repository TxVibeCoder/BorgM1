/**
 * PHASE 3'S GATE (docs/PLAN.md): a data-driven test asserting every parameter's range and
 * default against the 143-byte SysEx table — the equivalent of SynthStack's moduleData test.
 *
 * The table is a transcription of a scanned 1988 manual (p.127 TABLE 1, cross-checked
 * against p.130 TABLE 5), so the risk here is not a design mistake but a typo nobody
 * notices until a patch loads the wrong byte. Every assertion below is a transcription
 * guard, and the strongest of them are the two that check the table against ITSELF from a
 * different direction: full byte accounting, and the OSC-2 = OSC-1 + 40 invariant.
 */

import { describe, expect, it } from 'vitest';
import { validateControlDefs } from '../../data/schema';
import {
  codecSpec,
  coalesceProgramParams,
  decodeParam,
  decodeProgram,
  defaultProgramParams,
  EFFECT_BLOCK_BYTES,
  EFFECT_BLOCK_START,
  encodeParam,
  encodeProgram,
  EG_SEGMENTS,
  OSC2_BLOCK_BASE,
  OSC_BLOCK_BASE,
  OSC_BLOCK_BYTES,
  PROGRAM_CONTROL_DEFS,
  PROGRAM_NAME_BYTES,
  PROGRAM_PARAMS,
  PROGRAM_RECORD_BYTES,
  programParam,
  type ProgramParamDef,
} from '../../data/programParams';

/** Every byte of the record, and what is meant to own it. */
const NAME_BYTES = new Set(Array.from({ length: PROGRAM_NAME_BYTES }, (_, i) => i));
const EFFECT_BYTES = new Set(
  Array.from({ length: EFFECT_BLOCK_BYTES }, (_, i) => EFFECT_BLOCK_START + i),
);

describe('program parameter table — structure', () => {
  it('describes a 143-byte record', () => {
    expect(PROGRAM_RECORD_BYTES).toBe(143);
    expect(OSC_BLOCK_BASE).toBe(63);
    expect(OSC2_BLOCK_BASE).toBe(103);
    expect(OSC_BLOCK_BYTES).toBe(40);
    // The two oscillator blocks are adjacent and end exactly at the record's last byte.
    expect(OSC_BLOCK_BASE + OSC_BLOCK_BYTES).toBe(OSC2_BLOCK_BASE);
    expect(OSC2_BLOCK_BASE + OSC_BLOCK_BYTES).toBe(PROGRAM_RECORD_BYTES);
  });

  it('accounts for all 143 bytes — every byte is a parameter, the name, or the effect block', () => {
    // The whole point of this assertion: a parameter dropped in transcription leaves a hole,
    // and a hole is invisible in any test that only walks the parameters that ARE declared.
    const owned = new Set<number>([...NAME_BYTES, ...EFFECT_BYTES]);
    for (const p of PROGRAM_PARAMS) owned.add(p.offset);
    const missing = [];
    for (let i = 0; i < PROGRAM_RECORD_BYTES; i++) if (!owned.has(i)) missing.push(i);
    expect(missing, `unaccounted-for bytes: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no parameter pointing outside the record or into the name/effect blocks', () => {
    for (const p of PROGRAM_PARAMS) {
      expect(p.offset, p.id).toBeGreaterThanOrEqual(0);
      expect(p.offset, p.id).toBeLessThan(PROGRAM_RECORD_BYTES);
      expect(NAME_BYTES.has(p.offset), `${p.id} lands in the name field`).toBe(false);
      expect(EFFECT_BYTES.has(p.offset), `${p.id} lands in the effect block`).toBe(false);
    }
  });

  it('has 139 parameters and no duplicate ids', () => {
    // 143 BYTES, 139 PARAMETERS. The gap is the 10-byte name (1 field), the 25-byte effect
    // block, and six bytes that pack several parameters each. Pinned so "143 parameters"
    // in the plan is never quietly taken as the control count.
    expect(PROGRAM_PARAMS).toHaveLength(139);
    const ids = PROGRAM_PARAMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never gives two parameters the same (offset, bit) slot', () => {
    const seen = new Map<string, string>();
    for (const p of PROGRAM_PARAMS) {
      // Whole-byte codecs own the byte; bit codecs own one bit of it.
      const key = p.bit === undefined ? `${p.offset}` : `${p.offset}:${p.bit}`;
      const prev = seen.get(key);
      expect(prev, `${p.id} collides with ${prev} at ${key}`).toBeUndefined();
      seen.set(key, p.id);
    }
  });
});

describe('program parameter table — ranges and defaults', () => {
  it('gives every parameter a default that is legal for its codec', () => {
    for (const p of PROGRAM_PARAMS) {
      const spec = codecSpec(p.codec);
      if (spec.positions) {
        expect(typeof p.default, `${p.id} default`).toBe('string');
        expect(spec.positions, `${p.id} default '${p.default}'`).toContain(p.default);
      } else {
        expect(typeof p.default, `${p.id} default`).toBe('number');
        expect(p.default as number, `${p.id} default`).toBeGreaterThanOrEqual(spec.min!);
        expect(p.default as number, `${p.id} default`).toBeLessThanOrEqual(spec.max!);
      }
    }
  });

  /**
   * The hex ranges printed in TABLE 1, transcribed independently of the codec table so the
   * two have to agree. `00~63` is 0..99 DECIMAL written in hex; `9D~63` is -99..99 as a
   * two's-complement byte. Getting this backwards would silently divide every range by 1.56.
   */
  it('matches the hex ranges printed in TABLE 1', () => {
    const expected: Record<string, [number, number]> = {
      u99: [0, 99], // 00~63
      u3: [0, 3], // 00~03
      s99: [-99, 99], // 9D~63
      s12: [-12, 12], // F4~0C
      s50: [-50, 50], // CE~32
      key: [0, 127], // 00~7F : C-1~G9
      multisound: [0, 99], // 00~63 : Int.
    };
    for (const [codec, [min, max]] of Object.entries(expected)) {
      const spec = codecSpec(codec as never);
      expect(spec.min, codec).toBe(min);
      expect(spec.max, codec).toBe(max);
    }
  });

  it('passes the shared ControlDef validator', () => {
    expect(validateControlDefs('program', PROGRAM_CONTROL_DEFS)).toEqual([]);
  });
});

describe('the 1/2 rule, as data', () => {
  it('makes oscillator 2 exactly oscillator 1 + 40, parameter for parameter', () => {
    // Manual p.127: "103  SAME AS OSC-1(63~102)". If the two halves ever drift, the panel
    // built from one component instantiated twice will address the wrong bytes for OSC 2.
    const osc1 = PROGRAM_PARAMS.filter((p) => p.id.startsWith('OSC1_'));
    const osc2 = PROGRAM_PARAMS.filter((p) => p.id.startsWith('OSC2_'));
    expect(osc1.length).toBe(osc2.length);
    expect(osc1.filter((p) => p.offset >= OSC_BLOCK_BASE)).toHaveLength(52);

    for (const a of osc1) {
      const b = programParam(a.id.replace('OSC1_', 'OSC2_'));
      // Only the 63..102 block is mirrored at +40. MULTISOUND and OCTAVE are per-oscillator
      // parameters that live in the COMMON block and are spaced differently — see below.
      if (a.offset >= OSC_BLOCK_BASE) {
        expect(b.offset - a.offset, `${a.id} -> ${b.id}`).toBe(OSC_BLOCK_BYTES);
      }
      expect(b.bit, a.id).toBe(a.bit);
      expect(b.codec, a.id).toBe(a.codec);
      expect(b.default, a.id).toEqual(a.default);
      expect(b.label, a.id).toBe(a.label);
    }
  });

  it('keeps MULTISOUND and OCTAVE in the common block, interleaved rather than +40', () => {
    // Bytes 12,13 are OSC-1's and 14,15 are OSC-2's (manual p.127). They are per-oscillator
    // controls that do NOT live in the mirrored block, so the +40 rule does not reach them.
    // Applying it here would read the pitch EG as a multisound number.
    expect(programParam('OSC1_MULTISOUND').offset).toBe(12);
    expect(programParam('OSC1_OCTAVE').offset).toBe(13);
    expect(programParam('OSC2_MULTISOUND').offset).toBe(14);
    expect(programParam('OSC2_OCTAVE').offset).toBe(15);
  });

  it('puts every parameter in the 63..142 span on exactly one oscillator', () => {
    for (const p of PROGRAM_PARAMS) {
      if (p.offset < OSC_BLOCK_BASE) continue;
      const expectedOsc = p.offset < OSC2_BLOCK_BASE ? 1 : 2;
      expect(p.osc, `${p.id} at byte ${p.offset}`).toBe(expectedOsc);
    }
  });
});

describe('the EG-time SW & POLARITY bitfields (bytes 99-102)', () => {
  // The trap: enable and polarity are SEPARATE bits four apart (manual p.127 note *1), so
  // '0' genuinely means disabled. Modelling this as a signed depth would make a third of
  // the envelopes subtly wrong in a way that reads as a DSP bug.
  const swPolBytes = [99, 100, 101, 102];

  it('packs four three-state switches into each of the four bytes', () => {
    for (const offset of swPolBytes) {
      const here = PROGRAM_PARAMS.filter((p) => p.offset === offset);
      expect(here, `byte ${offset}`).toHaveLength(4);
      expect(here.map((p) => p.bit)).toEqual([0, 1, 2, 3]);
      expect(here.map((p) => p.label)).toEqual([...EG_SEGMENTS]);
      for (const p of here) expect(p.codec).toBe('swpol');
    }
  });

  it('round-trips all three states, and 0 clears the enable bit regardless of polarity', () => {
    for (const offset of swPolBytes) {
      for (const p of PROGRAM_PARAMS.filter((q) => q.offset === offset)) {
        const bit = p.bit!;
        for (const value of ['-', '0', '+'] as const) {
          const record = new Uint8Array(PROGRAM_RECORD_BYTES);
          // Pre-set polarity so we can prove '0' does not depend on clearing it.
          record[offset] = 0xff;
          encodeParam(p, value, record);
          expect(decodeParam(p, record), `${p.id} = ${value}`).toBe(value);
          expect((record[offset]! >> bit) & 1, `${p.id} enable bit`).toBe(value === '0' ? 0 : 1);
        }
      }
    }
  });

  it('keeps the four switches in one byte independent', () => {
    // Setting RELEASE must not disturb ATTACK — they are bits 3 and 0 of the same byte.
    const record = new Uint8Array(PROGRAM_RECORD_BYTES);
    const attack = programParam('OSC1_VDF_EGT_TRACK_ATTACK');
    const release = programParam('OSC1_VDF_EGT_TRACK_RELEASE');
    encodeParam(attack, '+', record);
    encodeParam(release, '-', record);
    expect(decodeParam(attack, record)).toBe('+');
    expect(decodeParam(release, record)).toBe('-');
    expect(decodeParam(programParam('OSC1_VDF_EGT_TRACK_DECAY'), record)).toBe('0');
  });
});

describe('byte codec round-trip', () => {
  it('round-trips every legal value of every parameter', () => {
    // Exhaustive rather than sampled: the ranges are small (<= 199 values) and the failure
    // this catches — one codec with an off-by-one at a range end — is exactly the kind that
    // survives spot checks.
    for (const p of PROGRAM_PARAMS) {
      const spec = codecSpec(p.codec);
      const values: (number | string)[] = spec.positions
        ? [...spec.positions]
        : Array.from({ length: spec.max! - spec.min! + 1 }, (_, i) => spec.min! + i);
      for (const v of values) {
        const record = new Uint8Array(PROGRAM_RECORD_BYTES);
        encodeParam(p, v, record);
        expect(decodeParam(p, record), `${p.id} = ${v}`).toEqual(v);
      }
    }
  });

  it('round-trips a whole program through bytes and back', () => {
    const params = defaultProgramParams();
    expect(decodeProgram(encodeProgram(params))).toEqual(params);
  });

  it('writes a 143-byte record and leaves the name and effect blocks alone', () => {
    const record = encodeProgram(defaultProgramParams());
    expect(record).toHaveLength(PROGRAM_RECORD_BYTES);
    for (const i of NAME_BYTES) expect(record[i], `name byte ${i}`).toBe(0);
    for (const i of EFFECT_BYTES) expect(record[i], `effect byte ${i}`).toBe(0);
  });

  it('preserves parameters that share a byte', () => {
    // Byte 19 holds the pitch-MG waveform (bits 0-1) plus three flags (bits 5, 6, 7).
    const record = new Uint8Array(PROGRAM_RECORD_BYTES);
    encodeParam(programParam('PMG_WAVE'), 'RECTANGLE', record);
    encodeParam(programParam('PMG_OSC1_ENABLE'), 'ON', record);
    encodeParam(programParam('PMG_KEY_SYNC'), 'ON', record);
    expect(decodeParam(programParam('PMG_WAVE'), record)).toBe('RECTANGLE');
    expect(decodeParam(programParam('PMG_OSC1_ENABLE'), record)).toBe('ON');
    expect(decodeParam(programParam('PMG_OSC2_ENABLE'), record)).toBe('OFF');
    expect(decodeParam(programParam('PMG_KEY_SYNC'), record)).toBe('ON');

    // Byte 11 holds ASSIGN (bit 0) and HOLD (bit 1).
    const r2 = new Uint8Array(PROGRAM_RECORD_BYTES);
    encodeParam(programParam('ASSIGN'), 'MONO', r2);
    expect(decodeParam(programParam('HOLD'), r2)).toBe('OFF');
    encodeParam(programParam('HOLD'), 'ON', r2);
    expect(decodeParam(programParam('ASSIGN'), r2)).toBe('MONO');
    expect(r2[11]).toBe(0b11);
  });

  it("encodes OCTAVE as FF~01, the manual's 16'~4'", () => {
    const record = new Uint8Array(PROGRAM_RECORD_BYTES);
    const oct = programParam('OSC1_OCTAVE');
    encodeParam(oct, "16'", record);
    expect(record[13]).toBe(0xff);
    encodeParam(oct, "8'", record);
    expect(record[13]).toBe(0x00);
    encodeParam(oct, "4'", record);
    expect(record[13]).toBe(0x01);
  });

  it('encodes signed ranges as two\'s complement, so -99 is 0x9D', () => {
    const record = new Uint8Array(PROGRAM_RECORD_BYTES);
    encodeParam(programParam('OSC1_VDF_CUTOFF_TRACK'), -99, record);
    expect(record[73]).toBe(0x9d);
    encodeParam(programParam('OSC1_VDF_CUTOFF_TRACK'), 99, record);
    expect(record[73]).toBe(0x63);
    encodeParam(programParam('INTERVAL'), -12, record);
    expect(record[16]).toBe(0xf4);
    encodeParam(programParam('DETUNE'), -50, record);
    expect(record[17]).toBe(0xce);
  });
});

describe('coalesce — a loaded bundle is untrusted input', () => {
  it('fills every missing parameter from its default', () => {
    expect(coalesceProgramParams({})).toEqual(defaultProgramParams());
    expect(coalesceProgramParams(undefined)).toEqual(defaultProgramParams());
  });

  it('clamps out-of-range numbers and rejects illegal positions', () => {
    const healed = coalesceProgramParams({
      OSC1_VDF_CUTOFF: 5000,
      OSC1_VDF_CUTOFF_TRACK: -5000,
      OSC_MODE: 'QUADRUPLE',
      OSC1_VDF_EGT_TRACK_ATTACK: 'sometimes',
    });
    expect(healed.OSC1_VDF_CUTOFF).toBe(99);
    expect(healed.OSC1_VDF_CUTOFF_TRACK).toBe(-99);
    expect(healed.OSC_MODE).toBe('SINGLE');
    expect(healed.OSC1_VDF_EGT_TRACK_ATTACK).toBe('0');
  });

  it('drops non-finite numbers rather than carrying them into the state tree', () => {
    // NaN/Infinity would survive in memory and become null on the JSON round trip, which is
    // the invariant m1State exists to protect.
    const healed = coalesceProgramParams({ OSC1_VDF_CUTOFF: NaN, OSC1_VDF_EG_INT: Infinity });
    expect(healed.OSC1_VDF_CUTOFF).toBe(programParam('OSC1_VDF_CUTOFF').default);
    expect(healed.OSC1_VDF_EG_INT).toBe(programParam('OSC1_VDF_EG_INT').default);
    expect(JSON.parse(JSON.stringify(healed))).toEqual(healed);
  });

  it('ignores unknown parameters instead of letting them into the tree', () => {
    const healed = coalesceProgramParams({ NOT_A_PARAM: 42 } as Record<string, number>);
    expect(healed.NOT_A_PARAM).toBeUndefined();
  });
});

describe('the defaults describe a flat, audible, hardware-faithful program', () => {
  const d = defaultProgramParams();

  it('opens the filter and defeats its EG, so the sample is what you hear', () => {
    expect(d.OSC1_VDF_CUTOFF).toBe(99);
    expect(d.OSC1_VDF_EG_INT).toBe(0);
  });

  it('holds the amp EG flat at full level with a short release', () => {
    expect(d.OSC1_VDA_EG_AT).toBe(0);
    expect(d.OSC1_VDA_EG_AL).toBe(99);
    expect(d.OSC1_VDA_EG_SL).toBe(99);
    expect(d.OSC1_VDA_EG_RT).toBeGreaterThan(0); // never a hard cut
  });

  it('defaults cutoff keyboard tracking to -99, NOT 0', () => {
    // 0 would mean 100% tracking (manual p.27), which is emphatically not a neutral
    // default however much it looks like one. This assertion is the guard on that trap.
    expect(d.OSC1_VDF_CUTOFF_TRACK).toBe(-99);
    expect(d.OSC2_VDF_CUTOFF_TRACK).toBe(-99);
  });

  it('leaves every modulation source off', () => {
    expect(d.PMG_INTENSITY).toBe(0);
    expect(d.FMG_INTENSITY).toBe(0);
    expect(d.PMG_OSC1_ENABLE).toBe('OFF');
    expect(d.FMG_OSC1_ENABLE).toBe('OFF');
    expect(d.AT_VDF_CUTOFF).toBe(0);
    expect(d.AT_VDA_AMP).toBe(0);
    for (const p of PROGRAM_PARAMS.filter((q) => q.codec === 'swpol')) {
      expect(d[p.id], p.id).toBe('0');
    }
  });

  it('starts in SINGLE mode', () => {
    expect(d.OSC_MODE).toBe('SINGLE');
  });
});

describe('nomenclature', () => {
  it("never puts Korg's VDF/VDA on a panel label", () => {
    // CLAUDE.md: say FILTER and AMP in the UI; keep VDF/VDA internally where they match the
    // SysEx model. `sysexName` is allowed to say VDF — it is the join key to the manual.
    for (const p of PROGRAM_PARAMS) {
      expect(p.label, p.id).not.toMatch(/\bVD[FA]\b/);
    }
  });

  it('keeps the manual wording available for every parameter', () => {
    for (const p of PROGRAM_PARAMS) {
      expect(p.sysexName.length, p.id).toBeGreaterThan(0);
      expect(p.label.length, p.id).toBeGreaterThan(0);
    }
  });
});

/**
 * A spot-check against Korg's own factory data, decoded independently in the research
 * payload (`preload/final.py`, validated 20/20 on predicted multisamples). These are the
 * offsets that decoder reads, asserted here against the table so the two agree.
 */
describe('agrees with the independently-validated factory-preload decoder', () => {
  const cases: [string, number][] = [
    ['OSC_MODE', 10],
    ['OSC1_MULTISOUND', 12],
    ['OSC1_OCTAVE', 13],
    ['OSC2_MULTISOUND', 14],
    ['OSC2_OCTAVE', 15],
    ['INTERVAL', 16],
    ['DETUNE', 17],
    ['DELAY_START', 18],
    ['OSC1_VDF_CUTOFF', 71],
    ['OSC1_VDF_TRACK_CENTER', 72],
    ['OSC1_VDF_CUTOFF_TRACK', 73],
    ['OSC1_VDF_EG_INT', 74],
    ['OSC1_VDF_EG_AT', 78],
    ['OSC1_VDA_LEVEL', 86],
    ['OSC1_VDA_EG_AT', 92],
    ['OSC2_VDF_CUTOFF', 111],
    ['OSC2_VDA_LEVEL', 126],
  ];
  for (const [id, offset] of cases) {
    it(`${id} is byte ${offset}`, () => {
      expect(programParam(id).offset).toBe(offset);
    });
  }
});

describe('parameter groups', () => {
  it('assigns every parameter to a group', () => {
    const groups = new Map<string, ProgramParamDef[]>();
    for (const p of PROGRAM_PARAMS) {
      expect(p.group, p.id).toBeTruthy();
      const list = groups.get(p.group) ?? [];
      list.push(p);
      groups.set(p.group, list);
    }
    // Every group must actually be populated, or the panel renders an empty section.
    for (const [group, list] of groups) expect(list.length, group).toBeGreaterThan(0);
  });
});
