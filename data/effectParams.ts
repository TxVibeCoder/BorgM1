/**
 * The M1 effect section — 33 algorithms plus Through, as typed data.
 *
 * SOURCES, all three cross-checked against each other and against Korg's own factory bank:
 *
 *  - **Owner's Manual p.129, `*11 EFFECT PARAMETER`** (`pg/p129.png`) — the 25-byte block
 *    layout, every algorithm's 8-byte parameter block, and the quantization grids. This is
 *    the authority for the DATA LAYOUT. Read from the image; the OCR interleaves columns.
 *  - **M1R Owner's Manual pp.56-57, "EFFECT PARAMETERS DEFAULT VALUES CHART"**
 *    (`pages/b056.png`, `b057.png`) — the official effect NAMES, every algorithm's DEFAULT
 *    values, and the asterisks that drive the pairing restriction. Note its A..H columns are
 *    the hardware's eight DISPLAY positions, NOT byte offsets — the two orders differ, e.g. a
 *    reverb shows Reverb Time / Pre Delay / E/R Level / High Damp for bytes 00 / 03 / 04 / 02.
 *  - **The factory preload** (`preload/x/M1preld.syx.unpacked`) — 100 programs whose effect
 *    blocks were histogrammed to settle the questions the documents left ambiguous. Every
 *    claim marked MEASURED below was decided that way and is pinned by `effectParams.test.ts`.
 *
 * THREE THINGS THE DOCUMENTS GOT AMBIGUOUS AND THE DATA SETTLED:
 *
 *  1. **The type byte is effect number MINUS ONE.** `0~20, 21 : 1~33, Tru` on p.129 reads as
 *     data 0..0x20 -> effects 1..33 and data 0x21 -> Through. Two decoders in the research
 *     payload disagree about this. Confirmed decisively: I17 `Organ 2` has byte38=11, which
 *     under this reading is #12 Stereo Chorus 1 with depth 99 and EQ +12/+12, and byte39=0 =
 *     #1 Hall at 3.5 s — the exact patch PLAN.md describes from a separate source. I00
 *     `Universe` likewise decodes to a 247/414 ms Stereo Delay, PLAN.md's other stated figure.
 *     The rival reading puts 8 of 12 Early Reflection times out of their documented range.
 *  2. **MG Status bit1 (phase) is a real editable parameter, and the `I`/`II` variants are
 *     its two settings.** The operation manual says "Stereo ChorusI ... phase inversion of the
 *     two circuits. Stereo ChorusII has no phase inversion", and likewise for Phaser and
 *     Tremolo. MEASURED: bit1 is set on 51 of 54 `I`-variant slots and clear on all 3
 *     `II`-variant slots, and it varies WITHIN one effect number — so it is data, not a
 *     constant implied by the algorithm. p.129's per-cell arrow notes read the other way
 *     round; the prose and the data agree with each other and outvote them.
 *  3. **For effects 26-33 the slot's two balance bytes are the two HALVES' dry/wet, not a
 *     left/right pair.** Those algorithms are "dual" — the quick reference lists two separate
 *     `Dry:EFF` controls and pp.56-57 give two separate defaults. MEASURED, and it is a clean
 *     split: across the factory bank the two bytes are EQUAL in 196 of 196 slots holding
 *     effects 1-25, and UNEQUAL in 4 of 4 slots holding effects 26-33.
 *
 * VALUES HERE ARE DISPLAY VALUES, NOT BYTES — same contract as `programParams.ts`. The table
 * owns `encodeEffectParam`/`decodeEffectParam`, so the byte layout lives in one place and
 * Phase 6's factory importer comes for free.
 *
 * SELECTING AN ALGORITHM RESETS ITS PARAMETERS. Manual p.56: "When selecting the effect type
 * again, effect parameters will be set to the default value." That is why a slot only ever
 * holds the CURRENT algorithm's parameters, which is what keeps the state tree finite.
 */

/** Bytes 38..62 of the program record. Mirrors `programParams.ts`'s reservation. */
export const EFFECT_BLOCK_START = 38;
export const EFFECT_BLOCK_BYTES = 25;
/** Each slot's parameter block is 8 bytes: block offsets 09-16 and 17-24. */
export const EFFECT_PARAM_BYTES = 8;

/** Offsets WITHIN the 25-byte block. p.129's `No.` column. */
export const BLOCK = {
  type1: 0,
  type2: 1,
  balance1A: 2,
  balance1B: 3,
  balance2A: 4,
  balance2B: 5,
  out3Pan: 6,
  out4Pan: 7,
  io: 8,
  params1: 9,
  params2: 17,
} as const;

/**
 * The `Effect I/O` byte (block offset 08, record byte 46). p.129 note `*11-2`.
 * bit4 is the one that changes the topology; bits 0-3 are per-channel effect enables.
 */
export const IO_BITS = {
  fx1L: 0,
  fx1R: 1,
  fx2L: 2,
  fx2R: 3,
  /** 0 = PARALLEL, 1 = SERIAL. */
  serial: 4,
} as const;

/** Data value that means "no effect". p.129: `21 : ... Tru` (Through). */
export const EFFECT_THROUGH_BYTE = 33;

// ---- the catalogue ----------------------------------------------------------------------

/**
 * Which DSP block an algorithm is built from. Thirty-three algorithms collapse into nine
 * blocks — that collapse is the whole reason this phase is tractable, and it is Korg's own
 * structure rather than a simplification: the manual's `Delay/X` family is literally a delay
 * feeding one of the others.
 */
export type EffectKind =
  | 'reverb'
  | 'earlyReflection'
  | 'delay'
  | 'modulation'
  | 'eq'
  | 'drive'
  | 'exciter'
  | 'symphonic'
  | 'rotary'
  | 'delayPlus';

/** Which modulation topology the `modulation` block runs. */
export type ModShape = 'chorus' | 'flanger' | 'phaser' | 'tremolo';

/** Which block a `delayPlus` algorithm's second half runs. */
export type DelayPlusTail =
  | 'hall'
  | 'room'
  | 'earlyReflection'
  | 'delay'
  | 'chorus'
  | 'flanger'
  | 'phaser'
  | 'tremolo';

// ---- codecs -----------------------------------------------------------------------------

/**
 * THE QUANTIZATION GRIDS ARE THE POINT, NOT AN IMPLEMENTATION DETAIL.
 *
 * PLAN.md: "Reproduce the quantization grids; do not smooth them." Reverb time moves in
 * 0.1 s steps, E/R time in 10 ms, EQ in 1 dB, and the LFO rate on a PIECEWISE grid. A
 * continuous float sounds wrong on every sweep, because the hardware's steps are coarse
 * enough to hear. Each codec below therefore converts byte <-> DISPLAY VALUE, and the
 * display value is already on the grid — there is nowhere for a smooth value to enter.
 */
export type EffectCodecName =
  | 'u99' // 00~63 : 0..99
  | 's99' // 9D~63 : -99..99
  | 's12' // F4~0C : -12..12 dB
  | 's10' // F6~0A : -10..10
  | 'balance' // 00~64 : 0..100 (wet percent)
  | 'revTime9' // 00~61 : 0.2..9.9 s, 0.1 steps
  | 'revTime5' // 00~2F : 0.2..4.9 s, 0.1 steps
  | 'erTime800' // 00~46 : 100..800 ms, 10 ms steps
  | 'erTime400' // 00~1E : 100..400 ms, 10 ms steps
  | 'preDelay200' // 00~C8 : 0..200 ms
  | 'preDelay150' // 00~96 : 0..150 ms
  | 'delayTime' // two bytes little-endian, 0..500 ms
  | 'chorusDelay' // 00~C8 : 0..200 ms
  | 'flangerDelay' // 00~32 : 0..50 ms
  | 'lfoRate' // 00~D8 : 0.03..30 Hz, PIECEWISE
  | 'emphatic' // 00~09 : 1..10
  | 'eqLowFc' // 0,1,2 : 250/500/1000 Hz
  | 'eqMidFc' // 0,1,2 : 500/1000/2000 Hz
  | 'eqHighFc' // 0,1,2 : 1000/2000/4000 Hz
  | 'mgWave' // bit0 : SIN / TRI
  | 'mgPhase' // bit1 : 0 deg / 180 deg
  | 'pan'; // 00 Off, 01 R, 02..64 ratio, 65 L

export const MG_WAVES = ['SIN', 'TRI'] as const;
export const MG_PHASES = ['0', '180'] as const;
export const EQ_LOW_FC = [250, 500, 1000] as const;
export const EQ_MID_FC = [500, 1000, 2000] as const;
export const EQ_HIGH_FC = [1000, 2000, 4000] as const;

/**
 * The LFO rate grid. p.129 note `*11-3-2`, verbatim:
 *   `00~63  0.03~3.00 (0.03 step)` · `64~C7  3.1~13.0 (0.1 step)` · `C8~D8  14~30.0 (1 step)`
 *
 * Note the FIRST segment starts at 0.03 for data 0, so the map is `(data+1) * 0.03`, not
 * `data * 0.03`. Confirmed twice: the stated endpoints require it (data 0x63 = 99 must give
 * 3.00), and the default chart's 0.30 Hz for Stereo Chorus 1 lands on the factory bank's
 * actual byte value of 9.
 */
export const LFO_RATE_MAX_BYTE = 0xd8;

export function lfoRateToHz(byte: number): number {
  const b = clampInt(byte, 0, LFO_RATE_MAX_BYTE);
  if (b <= 0x63) return round2((b + 1) * 0.03);
  if (b <= 0xc7) return round2(3.1 + (b - 0x64) * 0.1);
  return 14 + (b - 0xc8);
}

export function hzToLfoRate(hz: number): number {
  if (!Number.isFinite(hz)) return 0;
  if (hz <= 3.0) return clampInt(Math.round(hz / 0.03) - 1, 0, 0x63);
  if (hz <= 13.0) return clampInt(0x64 + Math.round((hz - 3.1) / 0.1), 0x64, 0xc7);
  return clampInt(0xc8 + Math.round(hz - 14), 0xc8, LFO_RATE_MAX_BYTE);
}

/** Every rate the hardware can express, in order. The UI steps through this, not through Hz. */
export function lfoRateSteps(): number[] {
  const out: number[] = [];
  for (let b = 0; b <= LFO_RATE_MAX_BYTE; b++) out.push(lfoRateToHz(b));
  return out;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

function toSigned(byte: number): number {
  return byte > 127 ? byte - 256 : byte;
}

function fromSigned(v: number): number {
  return v < 0 ? v + 256 : v;
}

interface CodecSpec {
  /** Inclusive display range, for numeric codecs. */
  min?: number;
  max?: number;
  /** Display step, so the UI can move on the hardware's grid rather than by 1. */
  step?: number;
  /** Position list, for enumerated codecs. */
  positions?: readonly string[];
  /** Numeric position values, for the frequency selectors. */
  choices?: readonly number[];
  unit?: string;
  /** Spans two bytes (`offset` and `offset+1`), little-endian. */
  wide?: boolean;
  /** Sub-byte codecs read/write this bit of their byte. */
  bit?: number;
}

const CODECS: Record<EffectCodecName, CodecSpec> = {
  u99: { min: 0, max: 99, step: 1 },
  s99: { min: -99, max: 99, step: 1 },
  s12: { min: -12, max: 12, step: 1, unit: 'dB' },
  s10: { min: -10, max: 10, step: 1 },
  balance: { min: 0, max: 100, step: 1, unit: '%' },
  revTime9: { min: 0.2, max: 9.9, step: 0.1, unit: 's' },
  revTime5: { min: 0.2, max: 4.9, step: 0.1, unit: 's' },
  erTime800: { min: 100, max: 800, step: 10, unit: 'ms' },
  erTime400: { min: 100, max: 400, step: 10, unit: 'ms' },
  preDelay200: { min: 0, max: 200, step: 1, unit: 'ms' },
  preDelay150: { min: 0, max: 150, step: 1, unit: 'ms' },
  delayTime: { min: 0, max: 500, step: 1, unit: 'ms', wide: true },
  chorusDelay: { min: 0, max: 200, step: 1, unit: 'ms' },
  flangerDelay: { min: 0, max: 50, step: 1, unit: 'ms' },
  lfoRate: { min: 0.03, max: 30, unit: 'Hz' },
  emphatic: { min: 1, max: 10, step: 1 },
  eqLowFc: { choices: EQ_LOW_FC, unit: 'Hz' },
  eqMidFc: { choices: EQ_MID_FC, unit: 'Hz' },
  eqHighFc: { choices: EQ_HIGH_FC, unit: 'Hz' },
  mgWave: { positions: MG_WAVES, bit: 0 },
  mgPhase: { positions: MG_PHASES, bit: 1 },
  pan: { min: 0, max: 101, step: 1 },
};

export function effectCodecSpec(codec: EffectCodecName): CodecSpec {
  return CODECS[codec];
}

/** Byte -> display value, for one codec. */
export function decodeValue(codec: EffectCodecName, byte: number, hiByte = 0): number | string {
  switch (codec) {
    case 'u99':
      return clampInt(byte, 0, 99);
    case 's99':
      return clampInt(toSigned(byte), -99, 99);
    case 's12':
      return clampInt(toSigned(byte), -12, 12);
    case 's10':
      return clampInt(toSigned(byte), -10, 10);
    case 'balance':
      return clampInt(byte, 0, 100);
    case 'revTime9':
      return round2(0.2 + clampInt(byte, 0, 0x61) * 0.1);
    case 'revTime5':
      return round2(0.2 + clampInt(byte, 0, 0x2f) * 0.1);
    case 'erTime800':
      return 100 + clampInt(byte, 0, 0x46) * 10;
    case 'erTime400':
      return 100 + clampInt(byte, 0, 0x1e) * 10;
    case 'preDelay200':
      return clampInt(byte, 0, 200);
    case 'preDelay150':
      return clampInt(byte, 0, 150);
    case 'delayTime':
      return clampInt(((hiByte & 0xff) << 8) | (byte & 0xff), 0, 500);
    case 'chorusDelay':
      return clampInt(byte, 0, 200);
    case 'flangerDelay':
      return clampInt(byte, 0, 50);
    case 'lfoRate':
      return lfoRateToHz(byte);
    case 'emphatic':
      return clampInt(byte, 0, 9) + 1;
    case 'eqLowFc':
      return EQ_LOW_FC[clampInt(byte, 0, 2)]!;
    case 'eqMidFc':
      return EQ_MID_FC[clampInt(byte, 0, 2)]!;
    case 'eqHighFc':
      return EQ_HIGH_FC[clampInt(byte, 0, 2)]!;
    case 'mgWave':
      return MG_WAVES[(byte >> 0) & 1]!;
    case 'mgPhase':
      return MG_PHASES[(byte >> 1) & 1]!;
    case 'pan':
      return clampInt(byte, 0, 101);
  }
}

/**
 * Display value -> byte. Returns `[lo, hi]`; `hi` is only meaningful for the wide codecs.
 * Sub-byte codecs return the bit MASK and VALUE via `encodeBit` instead — see below.
 */
export function encodeValue(codec: EffectCodecName, value: number | string): [number, number] {
  const n = typeof value === 'number' ? value : Number(value);
  switch (codec) {
    case 'u99':
      return [clampInt(n, 0, 99), 0];
    case 's99':
      return [fromSigned(clampInt(n, -99, 99)), 0];
    case 's12':
      return [fromSigned(clampInt(n, -12, 12)), 0];
    case 's10':
      return [fromSigned(clampInt(n, -10, 10)), 0];
    case 'balance':
      return [clampInt(n, 0, 100), 0];
    case 'revTime9':
      return [clampInt((n - 0.2) / 0.1, 0, 0x61), 0];
    case 'revTime5':
      return [clampInt((n - 0.2) / 0.1, 0, 0x2f), 0];
    case 'erTime800':
      return [clampInt((n - 100) / 10, 0, 0x46), 0];
    case 'erTime400':
      return [clampInt((n - 100) / 10, 0, 0x1e), 0];
    case 'preDelay200':
      return [clampInt(n, 0, 200), 0];
    case 'preDelay150':
      return [clampInt(n, 0, 150), 0];
    case 'delayTime': {
      const ms = clampInt(n, 0, 500);
      return [ms & 0xff, (ms >> 8) & 0xff];
    }
    case 'chorusDelay':
      return [clampInt(n, 0, 200), 0];
    case 'flangerDelay':
      return [clampInt(n, 0, 50), 0];
    case 'lfoRate':
      return [hzToLfoRate(n), 0];
    case 'emphatic':
      return [clampInt(n - 1, 0, 9), 0];
    case 'eqLowFc':
      return [nearestChoice(EQ_LOW_FC, n), 0];
    case 'eqMidFc':
      return [nearestChoice(EQ_MID_FC, n), 0];
    case 'eqHighFc':
      return [nearestChoice(EQ_HIGH_FC, n), 0];
    // SHIFTED INTO POSITION, so encode is the exact inverse of decode. Returning the bare
    // bit VALUE here while `decodeValue` reads a bit POSITION was a real bug: it made
    // `snapEffectValue` — which round-trips a value through both — silently rewrite PHASE
    // '180' to '0', i.e. turn every `I` variant into its `II`. Found by driving the app.
    case 'mgWave':
      return [Math.max(0, MG_WAVES.indexOf(value as (typeof MG_WAVES)[number])) << 0, 0];
    case 'mgPhase':
      return [Math.max(0, MG_PHASES.indexOf(value as (typeof MG_PHASES)[number])) << 1, 0];
    case 'pan':
      return [clampInt(n, 0, 101), 0];
  }
}

function nearestChoice(choices: readonly number[], v: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < choices.length; i++) {
    const d = Math.abs(choices[i]! - v);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Legal display values for an enumerated codec, or null if it is numeric. */
export function codecPositions(codec: EffectCodecName): (number | string)[] | null {
  const spec = CODECS[codec];
  if (spec.positions) return [...spec.positions];
  if (spec.choices) return [...spec.choices];
  return null;
}

// ---- per-algorithm parameter tables ------------------------------------------------------

export interface EffectParamDef {
  /** Stable id WITHIN its algorithm. Slot-qualified ids are built by `effectParamKey`. */
  id: string;
  /** Byte offset 0..7 inside the algorithm's 8-byte block. */
  offset: number;
  label: string;
  codec: EffectCodecName;
  unit?: string;
}

type P = EffectParamDef;

const p = (id: string, offset: number, label: string, codec: EffectCodecName): P => ({
  id,
  offset,
  label,
  codec,
  unit: CODECS[codec].unit,
});

/**
 * `EQ HIGH`/`EQ LOW` at offsets 06/07 — shared by nearly every algorithm.
 *
 * PLAN.md's warning applies here: "most effects leave their EQ in circuit even when switched
 * off". These are not bypassed at 0 dB by the hardware; they are a shelving pair that is
 * always in the signal path, which is part of why the M1 sounds the way it does.
 */
const EQ_HI_LO: P[] = [
  p('EQ_HIGH', 6, 'EQ HIGH', 's12'),
  p('EQ_LOW', 7, 'EQ LOW', 's12'),
];

/** Offsets 00-03 of every `Delay/X`. p.129 note `*11-3-1`: "Same as 26-(00)~(03)". */
const DELAY_HEAD: P[] = [
  p('DELAY_TIME', 0, 'DELAY TIME', 'delayTime'), // spans 00 and 01
  p('FEEDBACK', 2, 'FEEDBACK', 's99'),
  p('HIGH_DAMP', 3, 'HIGH DAMP', 'u99'),
];

const REVERB_PARAMS = (time: 'revTime9' | 'revTime5'): P[] => [
  p('REVERB_TIME', 0, 'REVERB TIME', time),
  p('HIGH_DAMP', 2, 'HIGH DAMP', 'u99'),
  p('PRE_DELAY', 3, 'PRE DELAY', 'preDelay200'),
  p('ER_LEVEL', 4, 'E/R LEVEL', 'u99'),
  ...EQ_HI_LO,
];

const ER_PARAMS: P[] = [
  p('ER_TIME', 0, 'E/R TIME', 'erTime800'),
  p('PRE_DELAY', 1, 'PRE DELAY', 'preDelay200'),
  ...EQ_HI_LO,
];

const DELAY_PARAMS: P[] = [
  p('DELAY_TIME_L', 0, 'DELAY L', 'delayTime'), // 00, 01
  p('FEEDBACK', 2, 'FEEDBACK', 's99'),
  p('HIGH_DAMP', 3, 'HIGH DAMP', 'u99'),
  p('DELAY_TIME_R', 4, 'DELAY R', 'delayTime'), // 04, 05
  ...EQ_HI_LO,
];

/**
 * Chorus and Flanger share one block. They differ in exactly two things — the delay range
 * (200 ms vs 50 ms) and whether Feedback is in circuit — which is what "four fewer
 * implementations than it looks" means in practice.
 */
const CHORUS_PARAMS = (flanger: boolean): P[] => [
  p('DEPTH', 0, 'DEPTH', 'u99'),
  p('SPEED', 1, 'SPEED', 'lfoRate'),
  p('WAVEFORM', 2, 'WAVEFORM', 'mgWave'),
  p('PHASE', 2, 'PHASE', 'mgPhase'),
  ...(flanger ? [p('FEEDBACK', 3, 'FEEDBACK', 's99')] : []),
  p('DELAY_TIME', 4, 'DELAY TIME', flanger ? 'flangerDelay' : 'chorusDelay'),
  ...EQ_HI_LO,
];

const PHASER_PARAMS: P[] = [
  p('DEPTH', 0, 'DEPTH', 'u99'),
  p('SPEED', 1, 'SPEED', 'lfoRate'),
  p('WAVEFORM', 2, 'WAVEFORM', 'mgWave'),
  p('PHASE', 2, 'PHASE', 'mgPhase'),
  p('FEEDBACK', 3, 'FEEDBACK', 's99'),
  p('MANUAL', 4, 'MANUAL', 'u99'),
];

const TREMOLO_PARAMS: P[] = [
  p('DEPTH', 0, 'DEPTH', 'u99'),
  p('SPEED', 1, 'SPEED', 'lfoRate'),
  p('WAVEFORM', 2, 'WAVEFORM', 'mgWave'),
  p('PHASE', 2, 'PHASE', 'mgPhase'),
  p('SHAPE', 3, 'SHAPE', 's99'),
  ...EQ_HI_LO,
];

export interface EffectAlgorithm {
  /** 1..33, as the hardware numbers them. Data byte is this MINUS ONE. */
  index: number;
  /** Official name, M1R manual pp.56-57. */
  name: string;
  kind: EffectKind;
  params: P[];
  /**
   * Marked `*` on the default-values chart. p.57, verbatim: "When using an effect marked with
   * an asterisk (*) for one of the effects, neither #24 SYMPHONIC ENS nor #25 ROTARY SPEAKER
   * can be selected for the other one." The hardware ran out of DSP; enforce it, don't fix it.
   */
  asterisked: boolean;
  /**
   * Mono-sums its input before processing and returns a stereo field. BRIEF.md: "Reverbs,
   * Early Reflections, Overdrive, Distortion, Symphonic and Rotary are mono-sum in, stereo
   * out. That is why M1 reverb sits so centred."
   */
  monoSum: boolean;
  /**
   * One of the "dual" algorithms 26-33, where the slot's two balance bytes are the two
   * halves' dry/wet rather than a left/right pair. MEASURED — see the header.
   */
  dual: boolean;
  /** For `modulation`, which topology. */
  modShape?: ModShape;
  /** For `delayPlus`, what the second half runs. */
  tail?: DelayPlusTail;
  /** Default display values, M1R manual pp.56-57. Anything absent falls back to the codec. */
  defaults: Record<string, number | string>;
  /** Default wet percent for the A-D half and the E-H half (the chart's two `DRY:EFF`). */
  defaultBalance: [number, number];
  notes?: string;
}

/** Defaults shared by every `Delay/X` head: 250 ms, +50%, 10%, and a 70:30 dry:eff. */
const DELAY_HEAD_DEFAULTS = { DELAY_TIME: 250, FEEDBACK: 50, HIGH_DAMP: 10 };

/**
 * All 33 algorithms. Order is the hardware's, so `EFFECT_ALGORITHMS[n-1].index === n`.
 *
 * `defaults` are transcribed from the chart's A..H DISPLAY columns and mapped back onto byte
 * offsets — those two orders are NOT the same, and conflating them is the easiest mistake to
 * make here. A reverb's chart row reads Reverb Time / Pre Delay / E/R Level / High Damp,
 * which is bytes 00 / 03 / 04 / 02; a phaser's reads Manual / Speed / Mod Depth / Feedback,
 * which is bytes 04 / 01 / 00 / 03.
 */
export const EFFECT_ALGORITHMS: EffectAlgorithm[] = [
  // ---- 1-6 reverbs. Mono-sum in, stereo out. -------------------------------------------
  {
    index: 1, name: 'HALL', kind: 'reverb', params: REVERB_PARAMS('revTime9'),
    asterisked: false, monoSum: true, dual: false,
    defaults: { REVERB_TIME: 3.5, PRE_DELAY: 55, ER_LEVEL: 46, HIGH_DAMP: 40, EQ_LOW: -5, EQ_HIGH: 0 },
    defaultBalance: [40, 40],
    notes: 'The Phase 4 fidelity gate\'s reverb. I17 Organ 2 uses it at its default 3.5 s.',
  },
  {
    index: 2, name: 'ENSEMBLE HALL', kind: 'reverb', params: REVERB_PARAMS('revTime9'),
    asterisked: false, monoSum: true, dual: false,
    defaults: { REVERB_TIME: 2.8, PRE_DELAY: 30, ER_LEVEL: 46, HIGH_DAMP: 40, EQ_LOW: -3, EQ_HIGH: 0 },
    defaultBalance: [40, 40],
  },
  {
    index: 3, name: 'CONCERT HALL', kind: 'reverb', params: REVERB_PARAMS('revTime9'),
    asterisked: false, monoSum: true, dual: false,
    defaults: { REVERB_TIME: 3.8, PRE_DELAY: 120, ER_LEVEL: 46, HIGH_DAMP: 40, EQ_LOW: 0, EQ_HIGH: -2 },
    defaultBalance: [40, 40],
    notes: 'Manual: "similar to Hall but has emphasis on early reflections".',
  },
  {
    index: 4, name: 'ROOM', kind: 'reverb', params: REVERB_PARAMS('revTime5'),
    asterisked: false, monoSum: true, dual: false,
    defaults: { REVERB_TIME: 0.5, PRE_DELAY: 22, ER_LEVEL: 76, HIGH_DAMP: 10, EQ_LOW: 1, EQ_HIGH: 0 },
    defaultBalance: [60, 60],
  },
  {
    index: 5, name: 'LARGE ROOM', kind: 'reverb', params: REVERB_PARAMS('revTime5'),
    asterisked: false, monoSum: true, dual: false,
    defaults: { REVERB_TIME: 1.5, PRE_DELAY: 30, ER_LEVEL: 76, HIGH_DAMP: 30, EQ_LOW: 2, EQ_HIGH: 4 },
    defaultBalance: [40, 40],
    notes: 'Manual: "gating can be achieved when reverb time is 0.5 sec".',
  },
  {
    index: 6, name: 'LIVE STAGE', kind: 'reverb', params: REVERB_PARAMS('revTime9'),
    asterisked: false, monoSum: true, dual: false,
    defaults: { REVERB_TIME: 2.0, PRE_DELAY: 20, ER_LEVEL: 60, HIGH_DAMP: 20, EQ_LOW: 3, EQ_HIGH: 0 },
    defaultBalance: [40, 40],
    notes:
      'p.129 groups it apart from Room, so it gets the full 9.9 s range rather than 4.9 — ' +
      'the manual calls it "reverberation of a very large room", which agrees.',
  },

  // ---- 7-9 early reflections ------------------------------------------------------------
  {
    index: 7, name: 'EARLY REF 1', kind: 'earlyReflection', params: ER_PARAMS,
    asterisked: false, monoSum: true, dual: false,
    defaults: { ER_TIME: 170, PRE_DELAY: 30, EQ_LOW: 0, EQ_HIGH: 0 },
    defaultBalance: [40, 40],
  },
  {
    index: 8, name: 'EARLY REF 2', kind: 'earlyReflection', params: ER_PARAMS,
    asterisked: false, monoSum: true, dual: false,
    defaults: { ER_TIME: 200, PRE_DELAY: 20, EQ_LOW: 0, EQ_HIGH: 0 },
    defaultBalance: [40, 40],
    notes: 'Manual: "reinforces the low frequency range, general purpose gating for drums".',
  },
  {
    index: 9, name: 'EARLY REF 3', kind: 'earlyReflection', params: ER_PARAMS,
    asterisked: false, monoSum: true, dual: false,
    defaults: { ER_TIME: 190, PRE_DELAY: 10, EQ_LOW: 0, EQ_HIGH: 0 },
    defaultBalance: [40, 40],
    notes: 'Manual: "uses a REVERSE envelope on the early reflections" — the tap gains ramp up.',
  },

  // ---- 10-11 delays ---------------------------------------------------------------------
  {
    index: 10, name: 'STEREO DELAY', kind: 'delay', params: DELAY_PARAMS,
    asterisked: false, monoSum: false, dual: false,
    defaults: { DELAY_TIME_L: 250, DELAY_TIME_R: 260, FEEDBACK: 50, HIGH_DAMP: 10, EQ_LOW: 0, EQ_HIGH: 0 },
    defaultBalance: [30, 30],
  },
  {
    index: 11, name: 'CROSS DELAY', kind: 'delay', params: DELAY_PARAMS,
    asterisked: false, monoSum: false, dual: false,
    defaults: { DELAY_TIME_L: 180, DELAY_TIME_R: 360, FEEDBACK: 80, HIGH_DAMP: 10, EQ_LOW: 0, EQ_HIGH: 0 },
    defaultBalance: [30, 30],
    notes: 'Manual: "sends the feedback signal of each delay over to the other delay".',
  },

  // ---- 12-19 modulation. One block, four topologies, phase in bit1. ---------------------
  {
    index: 12, name: 'STEREO CHORUS 1', kind: 'modulation', modShape: 'chorus',
    params: CHORUS_PARAMS(false), asterisked: true, monoSum: false, dual: false,
    defaults: { DEPTH: 60, SPEED: 0.3, DELAY_TIME: 10, WAVEFORM: 'TRI', PHASE: '180', EQ_LOW: 0, EQ_HIGH: 0 },
    defaultBalance: [40, 40],
    notes: 'The gate\'s chorus. I17 Organ 2 runs it at depth 99, EQ +12/+12, 60% wet.',
  },
  {
    index: 13, name: 'STEREO CHORUS 2', kind: 'modulation', modShape: 'chorus',
    params: CHORUS_PARAMS(false), asterisked: true, monoSum: false, dual: false,
    defaults: { DEPTH: 20, SPEED: 2.4, DELAY_TIME: 5, WAVEFORM: 'SIN', PHASE: '0', EQ_LOW: 0, EQ_HIGH: 0 },
    defaultBalance: [40, 40],
    notes: 'Manual: "Stereo ChorusII has no phase inversion" — hence PHASE 0.',
  },
  {
    index: 14, name: 'STEREO FLANGER', kind: 'modulation', modShape: 'flanger',
    params: CHORUS_PARAMS(true), asterisked: true, monoSum: false, dual: false,
    defaults: { DEPTH: 70, SPEED: 0.18, DELAY_TIME: 0, FEEDBACK: -75, WAVEFORM: 'SIN', PHASE: '180', EQ_LOW: 0, EQ_HIGH: 0 },
    defaultBalance: [60, 60],
  },
  {
    index: 15, name: 'CROSS FLANGER', kind: 'modulation', modShape: 'flanger',
    params: CHORUS_PARAMS(true), asterisked: true, monoSum: false, dual: false,
    defaults: { DEPTH: 37, SPEED: 0.21, DELAY_TIME: 25, FEEDBACK: 80, WAVEFORM: 'SIN', PHASE: '0', EQ_LOW: 0, EQ_HIGH: 0 },
    defaultBalance: [75, 75],
    notes: 'Manual: "sends its feedback signal over to the other flanger".',
  },
  {
    index: 16, name: 'PHASER 1', kind: 'modulation', modShape: 'phaser',
    params: PHASER_PARAMS, asterisked: true, monoSum: false, dual: false,
    defaults: { DEPTH: 60, SPEED: 0.69, FEEDBACK: -75, MANUAL: 99, WAVEFORM: 'SIN', PHASE: '180' },
    defaultBalance: [75, 75],
  },
  {
    index: 17, name: 'PHASER 2', kind: 'modulation', modShape: 'phaser',
    params: PHASER_PARAMS, asterisked: true, monoSum: false, dual: false,
    defaults: { DEPTH: 69, SPEED: 0.57, FEEDBACK: 87, MANUAL: 99, WAVEFORM: 'TRI', PHASE: '0' },
    defaultBalance: [40, 40],
  },
  {
    index: 18, name: 'STEREO TREMOLO 1', kind: 'modulation', modShape: 'tremolo',
    params: TREMOLO_PARAMS, asterisked: true, monoSum: false, dual: false,
    defaults: { DEPTH: 80, SPEED: 1.59, SHAPE: 99, WAVEFORM: 'SIN', PHASE: '180', EQ_LOW: 0, EQ_HIGH: 0 },
    defaultBalance: [100, 100],
    notes: 'Manual: "phase inversion of two tremolo circuits and automatic panning".',
  },
  {
    index: 19, name: 'STEREO TREMOLO 2', kind: 'modulation', modShape: 'tremolo',
    params: TREMOLO_PARAMS, asterisked: true, monoSum: false, dual: false,
    defaults: { DEPTH: 63, SPEED: 4.0, SHAPE: 0, WAVEFORM: 'TRI', PHASE: '0', EQ_LOW: 0, EQ_HIGH: 0 },
    defaultBalance: [100, 100],
  },

  // ---- 20-25 the one-offs ----------------------------------------------------------------
  {
    index: 20, name: 'EQUALIZER', kind: 'eq',
    params: [
      p('MID_FC', 0, 'MID FC', 'eqMidFc'),
      p('MID_GAIN', 1, 'MID GAIN', 's12'),
      p('LOW_FC', 4, 'LOW FC', 'eqLowFc'),
      p('HIGH_FC', 5, 'HIGH FC', 'eqHighFc'),
      p('HIGH_GAIN', 6, 'HIGH GAIN', 's12'),
      p('LOW_GAIN', 7, 'LOW GAIN', 's12'),
    ],
    asterisked: false, monoSum: false, dual: false,
    defaults: { LOW_GAIN: 0, LOW_FC: 500, HIGH_GAIN: 0, HIGH_FC: 2000, MID_GAIN: 0, MID_FC: 1000 },
    defaultBalance: [100, 100],
    notes:
      'p.129 titles it "3 Band EQ" and allocates a MID band the hardware\'s own edit page does ' +
      'not show. The bytes are real, so the band is modelled and exposed; the chart simply ' +
      'only documents Low and High. Mid defaults to 0 dB, i.e. out of circuit.',
  },
  {
    index: 21, name: 'OVER DRIVE', kind: 'drive',
    params: [
      p('EQ_MID_FC', 0, 'MID FC', 'eqMidFc'),
      p('EQ_MID_GAIN', 1, 'MID GAIN', 's12'),
      p('DRIVE', 2, 'DRIVE', 'u99'),
      p('LEVEL', 3, 'LEVEL', 'u99'),
      ...EQ_HI_LO,
    ],
    asterisked: false, monoSum: true, dual: false,
    defaults: { DRIVE: 80, LEVEL: 15, EQ_LOW: 0, EQ_HIGH: 0, EQ_MID_GAIN: 0, EQ_MID_FC: 1000 },
    defaultBalance: [100, 100],
  },
  {
    index: 22, name: 'DISTORTION', kind: 'drive',
    params: [
      p('DISTORTION', 2, 'DISTORTION', 'u99'),
      p('LEVEL', 3, 'LEVEL', 'u99'),
      p('EQ_LOW', 7, 'EQ LOW', 's12'),
    ],
    asterisked: false, monoSum: true, dual: false,
    defaults: { DISTORTION: 80, LEVEL: 20, EQ_LOW: 0 },
    defaultBalance: [100, 100],
    notes:
      'THREE parameters, and the missing EQ HIGH is real rather than a printing omission — ' +
      'p.129 and the default chart independently list Low only. Over Drive has both.',
  },
  {
    index: 23, name: 'EXCITER', kind: 'exciter',
    params: [
      p('BLEND', 0, 'BLEND', 's99'),
      p('EMPHATIC_POINT', 1, 'EMPHATIC PT', 'emphatic'),
      ...EQ_HI_LO,
    ],
    asterisked: false, monoSum: false, dual: false,
    defaults: { BLEND: 99, EMPHATIC_POINT: 5, EQ_LOW: 0, EQ_HIGH: 0 },
    defaultBalance: [100, 100],
  },
  {
    index: 24, name: 'SYMPHONIC ENS', kind: 'symphonic',
    params: [p('DEPTH', 0, 'DEPTH', 'u99'), ...EQ_HI_LO],
    asterisked: true, monoSum: true, dual: false,
    defaults: { DEPTH: 80, EQ_LOW: 0, EQ_HIGH: 0 },
    defaultBalance: [50, 50],
  },
  {
    index: 25, name: 'ROTARY SPEAKER', kind: 'rotary',
    params: [p('DEPTH', 0, 'DEPTH', 'u99'), p('SPEED_RATE', 2, 'SPEED RATE', 's10')],
    asterisked: true, monoSum: true, dual: false,
    defaults: { DEPTH: 62, SPEED_RATE: 5 },
    defaultBalance: [100, 100],
    notes: 'Speed Rate is the ratio of horn to rotor speed, not an absolute rate.',
  },

  // ---- 26-33 the dual `Delay/X` family. Two halves, two dry:wet balances. ---------------
  {
    index: 26, name: 'DELAY/HALL', kind: 'delayPlus', tail: 'hall',
    params: [
      ...DELAY_HEAD,
      p('REVERB_TIME', 4, 'REVERB TIME', 'revTime9'),
      p('REVERB_HIGH_DAMP', 6, 'REV HIGH DAMP', 'u99'),
      p('PRE_DELAY', 7, 'PRE DELAY', 'preDelay150'),
    ],
    asterisked: false, monoSum: false, dual: true,
    defaults: { ...DELAY_HEAD_DEFAULTS, REVERB_TIME: 3.5, PRE_DELAY: 55, REVERB_HIGH_DAMP: 40 },
    defaultBalance: [30, 40],
  },
  {
    index: 27, name: 'DELAY/ROOM', kind: 'delayPlus', tail: 'room',
    params: [
      ...DELAY_HEAD,
      p('REVERB_TIME', 4, 'REVERB TIME', 'revTime5'),
      p('REVERB_HIGH_DAMP', 6, 'REV HIGH DAMP', 'u99'),
      p('PRE_DELAY', 7, 'PRE DELAY', 'preDelay150'),
    ],
    asterisked: false, monoSum: false, dual: true,
    defaults: { ...DELAY_HEAD_DEFAULTS, REVERB_TIME: 1.5, PRE_DELAY: 30, REVERB_HIGH_DAMP: 30 },
    defaultBalance: [30, 40],
  },
  {
    index: 28, name: 'DELAY/E.REF', kind: 'delayPlus', tail: 'earlyReflection',
    params: [
      ...DELAY_HEAD,
      p('ER_TIME', 4, 'E/R TIME', 'erTime400'),
      p('PRE_DELAY', 5, 'PRE DELAY', 'preDelay150'),
    ],
    asterisked: false, monoSum: false, dual: true,
    defaults: { ...DELAY_HEAD_DEFAULTS, ER_TIME: 200, PRE_DELAY: 30 },
    defaultBalance: [30, 40],
  },
  {
    index: 29, name: 'DELAY/DELAY', kind: 'delayPlus', tail: 'delay',
    params: [
      p('DELAY_TIME_L', 0, 'DELAY L', 'delayTime'),
      p('FEEDBACK_L', 2, 'FEEDBACK L', 's99'),
      p('HIGH_DAMP_L', 3, 'HIGH DAMP L', 'u99'),
      p('DELAY_TIME_R', 4, 'DELAY R', 'delayTime'),
      p('FEEDBACK_R', 6, 'FEEDBACK R', 's99'),
      p('HIGH_DAMP_R', 7, 'HIGH DAMP R', 'u99'),
    ],
    asterisked: false, monoSum: false, dual: true,
    defaults: {
      DELAY_TIME_L: 250, FEEDBACK_L: 50, HIGH_DAMP_L: 10,
      DELAY_TIME_R: 260, FEEDBACK_R: 50, HIGH_DAMP_R: 10,
    },
    defaultBalance: [30, 30],
  },
  {
    index: 30, name: 'DELAY/CHORUS', kind: 'delayPlus', tail: 'chorus',
    params: [
      ...DELAY_HEAD,
      p('DEPTH', 4, 'DEPTH', 'u99'),
      p('SPEED', 5, 'SPEED', 'lfoRate'),
      p('WAVEFORM', 6, 'WAVEFORM', 'mgWave'),
    ],
    asterisked: true, monoSum: false, dual: true,
    defaults: { ...DELAY_HEAD_DEFAULTS, DEPTH: 60, SPEED: 0.3, WAVEFORM: 'TRI' },
    defaultBalance: [30, 40],
    notes: 'p.129 gives Feed Back at (07) as `0` for the chorus variant — hence not exposed.',
  },
  {
    index: 31, name: 'DELAY/FLANGER', kind: 'delayPlus', tail: 'flanger',
    params: [
      ...DELAY_HEAD,
      p('DEPTH', 4, 'DEPTH', 'u99'),
      p('SPEED', 5, 'SPEED', 'lfoRate'),
      p('WAVEFORM', 6, 'WAVEFORM', 'mgWave'),
      p('MOD_FEEDBACK', 7, 'MOD FEEDBACK', 's99'),
    ],
    asterisked: true, monoSum: false, dual: true,
    defaults: { ...DELAY_HEAD_DEFAULTS, DEPTH: 70, SPEED: 0.18, WAVEFORM: 'SIN', MOD_FEEDBACK: -75 },
    defaultBalance: [30, 60],
  },
  {
    index: 32, name: 'DELAY/PHASER', kind: 'delayPlus', tail: 'phaser',
    params: [
      ...DELAY_HEAD,
      p('DEPTH', 4, 'DEPTH', 'u99'),
      p('SPEED', 5, 'SPEED', 'lfoRate'),
      p('MOD_FEEDBACK', 6, 'MOD FEEDBACK', 's99'),
    ],
    asterisked: true, monoSum: false, dual: true,
    defaults: { ...DELAY_HEAD_DEFAULTS, DEPTH: 60, SPEED: 0.69, MOD_FEEDBACK: -75 },
    defaultBalance: [30, 75],
    notes: 'No waveform control — p.129 puts Feed Back at (06) where 30/31 put MG Status.',
  },
  {
    index: 33, name: 'DELAY/TREMOLO', kind: 'delayPlus', tail: 'tremolo',
    params: [
      ...DELAY_HEAD,
      p('DEPTH', 4, 'DEPTH', 'u99'),
      p('SPEED', 5, 'SPEED', 'lfoRate'),
      p('SHAPE', 7, 'SHAPE', 's99'),
    ],
    asterisked: true, monoSum: false, dual: true,
    defaults: { ...DELAY_HEAD_DEFAULTS, DEPTH: 80, SPEED: 1.59, SHAPE: 0 },
    defaultBalance: [30, 100],
  },
];

/** `NO EFFECT` plus the 33, for a UI selector. Index into this IS the display type value. */
export const EFFECT_NAMES: string[] = [
  'NO EFFECT',
  ...EFFECT_ALGORITHMS.map((a) => a.name),
];

export const EFFECT_COUNT = EFFECT_ALGORITHMS.length;

/** Look up an algorithm by its 1-based hardware number. `0` (NO EFFECT) returns null. */
export function effectAlgorithm(index: number): EffectAlgorithm | null {
  if (!Number.isFinite(index) || index < 1 || index > EFFECT_COUNT) return null;
  return EFFECT_ALGORITHMS[Math.round(index) - 1] ?? null;
}

/**
 * The pairing restriction, M1R manual p.57 verbatim: an asterisked effect in one slot bars
 * #24 SYMPHONIC ENS and #25 ROTARY SPEAKER from the other, and vice versa. Since 24 and 25
 * are themselves asterisked, that also bars them from pairing with each other.
 *
 * ENFORCE IT, DON'T FIX IT (BRIEF.md): "the hardware ran out of DSP; an emulator that allows
 * any pair is not an M1." Verified against the factory bank — 0 violations in 100 programs.
 */
export function effectPairAllowed(type1: number, type2: number): boolean {
  const a = effectAlgorithm(type1);
  const b = effectAlgorithm(type2);
  if (!a || !b) return true;
  const heavy = (x: EffectAlgorithm): boolean => x.index === 24 || x.index === 25;
  if (heavy(a) && b.asterisked) return false;
  if (heavy(b) && a.asterisked) return false;
  return true;
}

/** Every type value that may be selected in one slot given what the other holds. */
export function allowedTypesAgainst(other: number): number[] {
  const out: number[] = [];
  for (let t = 0; t <= EFFECT_COUNT; t++) if (effectPairAllowed(t, other)) out.push(t);
  return out;
}

// ---- one slot's parameter bag -------------------------------------------------------------

/** A slot's default parameter bag for a given algorithm. Manual: selecting a type resets. */
export function defaultEffectParams(type: number): Record<string, number | string> {
  const algo = effectAlgorithm(type);
  if (!algo) return {};
  const out: Record<string, number | string> = {};
  for (const def of algo.params) {
    const d = algo.defaults[def.id];
    out[def.id] = d !== undefined ? d : neutralFor(def.codec);
  }
  return out;
}

/** Fallback when the chart does not document a default: the codec's neutral position. */
function neutralFor(codec: EffectCodecName): number | string {
  const spec = CODECS[codec];
  if (spec.positions) return spec.positions[0]!;
  if (spec.choices) return spec.choices[Math.floor(spec.choices.length / 2)]!;
  if (spec.min !== undefined && spec.min > 0) return spec.min;
  return 0;
}

/**
 * Heal a slot's parameter bag against its algorithm: drop anything the algorithm does not
 * have, fill anything missing from the defaults, and clamp/snap the rest onto the grid.
 * Same contract as `coalesceProgramParams` — a loaded bundle is untrusted input.
 */
export function coalesceEffectParams(
  type: number,
  raw: Record<string, number | string> | undefined,
): Record<string, number | string> {
  const algo = effectAlgorithm(type);
  if (!algo) return {};
  const out: Record<string, number | string> = {};
  for (const def of algo.params) {
    const v = raw?.[def.id];
    const spec = CODECS[def.codec];
    if (spec.positions) {
      out[def.id] =
        typeof v === 'string' && spec.positions.includes(v)
          ? v
          : (algo.defaults[def.id] ?? spec.positions[0]!);
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      // Round-trip through the codec, which is what puts the value back on the grid.
      const [lo, hi] = encodeValue(def.codec, v);
      out[def.id] = decodeValue(def.codec, lo, hi);
    } else {
      out[def.id] = algo.defaults[def.id] ?? neutralFor(def.codec);
    }
  }
  return out;
}

/** Read one algorithm's 8-byte block into display values. */
export function decodeEffectParams(
  type: number,
  bytes: Uint8Array,
  base = 0,
): Record<string, number | string> {
  const algo = effectAlgorithm(type);
  if (!algo) return {};
  const out: Record<string, number | string> = {};
  for (const def of algo.params) {
    const lo = bytes[base + def.offset] ?? 0;
    const hi = CODECS[def.codec].wide ? (bytes[base + def.offset + 1] ?? 0) : 0;
    out[def.id] = decodeValue(def.codec, lo, hi);
  }
  return out;
}

/**
 * Write one algorithm's 8-byte block. `bytes` is mutated.
 *
 * Sub-byte parameters (the MG-status bits) are OR-ed in rather than assigned, so WAVEFORM and
 * PHASE — which share offset 02 — do not clobber each other. The block is zeroed first, which
 * is also what satisfies p.129's "Don't display NUL from here, and that must be 00".
 */
export function encodeEffectParams(
  type: number,
  params: Record<string, number | string>,
  bytes: Uint8Array,
  base = 0,
): void {
  const algo = effectAlgorithm(type);
  for (let i = 0; i < EFFECT_PARAM_BYTES; i++) bytes[base + i] = 0;
  if (!algo) return;
  const healed = coalesceEffectParams(type, params);
  for (const def of algo.params) {
    const spec = CODECS[def.codec];
    const [lo, hi] = encodeValue(def.codec, healed[def.id]!);
    if (spec.bit !== undefined) {
      // `lo` already carries the bit in its final position (see encodeValue), so this is an
      // OR and not a shift — WAVEFORM and PHASE share offset 02 and must not clobber.
      bytes[base + def.offset] = (bytes[base + def.offset] ?? 0) | lo;
    } else {
      bytes[base + def.offset] = lo;
      if (spec.wide) bytes[base + def.offset + 1] = hi;
    }
  }
  // MG Status bit2 is Wave Shape (p.129 note *11-3-3: 0 = Normal, 1 = for Flanger). It is
  // determined by the algorithm rather than edited, so it is written here rather than being
  // a parameter. MEASURED: set on 8 of 8 factory flanger slots, clear on 46 of 47 chorus.
  if (algo.kind === 'modulation' && algo.modShape === 'flanger') {
    bytes[base + 2] = (bytes[base + 2] ?? 0) | 0b100;
  }
}

// ---- the whole 25-byte block ---------------------------------------------------------------

/** One effect slot's editable state. */
export interface EffectSlotState {
  /** Display type: 0 = NO EFFECT, 1..33. The byte is this minus one, or 33 for Through. */
  type: number;
  /**
   * Wet percent, 0..100. Named A/B rather than L/R because for the dual algorithms 26-33
   * they are NOT a stereo pair — they are the delay half's and the tail half's dry:wet.
   */
  balanceA: number;
  balanceB: number;
  /** Display values for the CURRENT algorithm only. Changing type resets this. */
  params: Record<string, number | string>;
}

/** The effect section: bytes 38..62 of the program record. */
export interface EffectsState {
  slots: [EffectSlotState, EffectSlotState];
  /** Block byte 08 bit4. false = PARALLEL, true = SERIAL. */
  serial: boolean;
  /** Block byte 08 bits 0..3 — per-channel effect enables. */
  fx1L: boolean;
  fx1R: boolean;
  fx2L: boolean;
  fx2R: boolean;
  /** Output 3/4 pan: 0 = OFF, 1 = R, 2..100 = L:R ratio 1:99..99:1, 101 = L. */
  out3Pan: number;
  out4Pan: number;
  /**
   * Bits of the I/O byte that p.129 does not document (it specifies `bit4~0`), carried
   * verbatim so a factory import is lossless.
   *
   * BIT 5 IS REAL AND UNIDENTIFIED. MEASURED: set in 33 of Korg's 100 factory programs, and
   * only ever alongside all four channel enables. It correlates with nothing testable — not
   * oscillator mode, not output pan, not either effect type, not the balances. Rather than
   * invent a meaning it is preserved and ignored, which is the difference between a lossless
   * importer and a silent data loss. If a later session identifies it, promote it to a
   * named field; until then this is an honest unknown, not a placeholder.
   */
  ioReserved: number;
}

/** Mask of the I/O bits this table understands. Everything else lands in `ioReserved`. */
const IO_KNOWN_MASK = 0b11111;

/**
 * The default effect section.
 *
 * BOTH SLOTS OFF. That is a CHOICE and it is the one the fidelity gate depends on: an INIT
 * program must be the dry signal path, so that turning an effect on is an audible, deliberate
 * act rather than something the default already did. It also means the Phase 2 and 3 golden
 * buffers still describe the whole audible chain.
 */
export function defaultEffectSlot(): EffectSlotState {
  return { type: 0, balanceA: 0, balanceB: 0, params: {} };
}

export function defaultEffectsState(): EffectsState {
  return {
    slots: [defaultEffectSlot(), defaultEffectSlot()],
    serial: true,
    fx1L: true,
    fx1R: true,
    fx2L: true,
    fx2R: true,
    out3Pan: 0,
    out4Pan: 0,
    ioReserved: 0,
  };
}

function boolOf(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

export function coalesceEffectSlot(raw: Partial<EffectSlotState> | undefined): EffectSlotState {
  const type = clampInt(typeof raw?.type === 'number' ? raw.type : 0, 0, EFFECT_COUNT);
  const algo = effectAlgorithm(type);
  return {
    type,
    balanceA: clampInt(
      typeof raw?.balanceA === 'number' ? raw.balanceA : (algo?.defaultBalance[0] ?? 0),
      0,
      100,
    ),
    balanceB: clampInt(
      typeof raw?.balanceB === 'number' ? raw.balanceB : (algo?.defaultBalance[1] ?? 0),
      0,
      100,
    ),
    params: coalesceEffectParams(type, raw?.params),
  };
}

/**
 * Heal the effect section.
 *
 * THE PAIRING RESTRICTION IS ENFORCED HERE, not only in the UI. A hand-edited bundle that
 * pairs Symphonic Ensemble with a chorus is describing a machine the M1 never was, so slot 2
 * yields — it is the one the hardware bars you from setting second.
 */
export function coalesceEffectsState(raw: Partial<EffectsState> | undefined): EffectsState {
  const src = Array.isArray(raw?.slots) ? raw.slots : [];
  const slot1 = coalesceEffectSlot(src[0]);
  let slot2 = coalesceEffectSlot(src[1]);
  if (!effectPairAllowed(slot1.type, slot2.type)) slot2 = defaultEffectSlot();
  return {
    slots: [slot1, slot2],
    serial: boolOf(raw?.serial, true),
    fx1L: boolOf(raw?.fx1L, true),
    fx1R: boolOf(raw?.fx1R, true),
    fx2L: boolOf(raw?.fx2L, true),
    fx2R: boolOf(raw?.fx2R, true),
    out3Pan: clampInt(typeof raw?.out3Pan === 'number' ? raw.out3Pan : 0, 0, 101),
    out4Pan: clampInt(typeof raw?.out4Pan === 'number' ? raw.out4Pan : 0, 0, 101),
    ioReserved:
      clampInt(typeof raw?.ioReserved === 'number' ? raw.ioReserved : 0, 0, 255) & ~IO_KNOWN_MASK,
  };
}

/** Read the 25-byte effect block out of a program record. Phase 6's importer. */
export function decodeEffects(record: Uint8Array, start = EFFECT_BLOCK_START): EffectsState {
  const at = (i: number): number => record[start + i] ?? 0;
  const typeOf = (byte: number): number => (byte === EFFECT_THROUGH_BYTE ? 0 : clampInt(byte + 1, 0, EFFECT_COUNT));
  const io = at(BLOCK.io);
  const slot = (typeByte: number, balA: number, balB: number, pbase: number): EffectSlotState => {
    const type = typeOf(typeByte);
    return {
      type,
      balanceA: clampInt(balA, 0, 100),
      balanceB: clampInt(balB, 0, 100),
      params: decodeEffectParams(type, record, start + pbase),
    };
  };
  return {
    slots: [
      slot(at(BLOCK.type1), at(BLOCK.balance1A), at(BLOCK.balance1B), BLOCK.params1),
      slot(at(BLOCK.type2), at(BLOCK.balance2A), at(BLOCK.balance2B), BLOCK.params2),
    ],
    serial: ((io >> IO_BITS.serial) & 1) === 1,
    fx1L: ((io >> IO_BITS.fx1L) & 1) === 1,
    fx1R: ((io >> IO_BITS.fx1R) & 1) === 1,
    fx2L: ((io >> IO_BITS.fx2L) & 1) === 1,
    fx2R: ((io >> IO_BITS.fx2R) & 1) === 1,
    out3Pan: clampInt(at(BLOCK.out3Pan), 0, 101),
    out4Pan: clampInt(at(BLOCK.out4Pan), 0, 101),
    ioReserved: io & ~IO_KNOWN_MASK,
  };
}

/** Write the 25-byte effect block into a program record. `record` is mutated. */
export function encodeEffects(
  effects: EffectsState,
  record: Uint8Array,
  start = EFFECT_BLOCK_START,
): void {
  const e = coalesceEffectsState(effects);
  const put = (i: number, v: number): void => {
    record[start + i] = v & 0xff;
  };
  const typeByte = (t: number): number => (t === 0 ? EFFECT_THROUGH_BYTE : t - 1);

  put(BLOCK.type1, typeByte(e.slots[0].type));
  put(BLOCK.type2, typeByte(e.slots[1].type));
  put(BLOCK.balance1A, e.slots[0].balanceA);
  put(BLOCK.balance1B, e.slots[0].balanceB);
  put(BLOCK.balance2A, e.slots[1].balanceA);
  put(BLOCK.balance2B, e.slots[1].balanceB);
  put(BLOCK.out3Pan, e.out3Pan);
  put(BLOCK.out4Pan, e.out4Pan);
  put(
    BLOCK.io,
    (e.fx1L ? 1 << IO_BITS.fx1L : 0) |
      (e.fx1R ? 1 << IO_BITS.fx1R : 0) |
      (e.fx2L ? 1 << IO_BITS.fx2L : 0) |
      (e.fx2R ? 1 << IO_BITS.fx2R : 0) |
      (e.serial ? 1 << IO_BITS.serial : 0) |
      e.ioReserved,
  );
  encodeEffectParams(e.slots[0].type, e.slots[0].params, record, start + BLOCK.params1);
  encodeEffectParams(e.slots[1].type, e.slots[1].params, record, start + BLOCK.params2);
}

/** Fully-qualified parameter key for the panel and the audibility sweep: `FX1_DEPTH`. */
export function effectParamKey(slot: 1 | 2, id: string): string {
  return `FX${slot}_${id}`;
}

// ---- the panel's view of the table ---------------------------------------------------------

/**
 * Put a value back on the hardware's grid, by round-tripping it through its own codec.
 *
 * THIS IS WHAT KEEPS THE GRIDS REAL DURING A DRAG. A knob emits a continuous float sixty
 * times a second; without this the engine would hear 3.47 s of reverb on the way to 3.5,
 * which is precisely the smoothing PLAN.md forbids ("Continuous floats sound wrong on every
 * sweep"). Snapping at the point of entry means there is nowhere for an off-grid value to
 * exist — not in the store, not in transit, and not in the DSP.
 */
export function snapEffectValue(codec: EffectCodecName, value: number | string): number | string {
  const [lo, hi] = encodeValue(codec, value);
  return decodeValue(codec, lo, hi);
}

/** The same, looked up by algorithm and parameter id. Returns the value unchanged if unknown. */
export function snapEffectParam(
  type: number,
  id: string,
  value: number | string,
): number | string {
  const def = effectAlgorithm(type)?.params.find((p) => p.id === id);
  return def ? snapEffectValue(def.codec, value) : value;
}

/**
 * Project an effect parameter onto the shared `ControlDef` the panel's Knob and Switch speak,
 * exactly as `toControlDef` does for program parameters.
 *
 * `taper` is exponential for the two parameters whose range spans decades — LFO rate
 * (0.03..30 Hz) and delay time (0..500 ms) — because a linear knob spends most of its travel
 * where nothing audible changes. Everything else is linear, matching the hardware's own
 * data slider.
 */
export function toEffectControlDef(def: EffectParamDef): {
  id: string;
  panelLabel: string;
  type: 'knob' | 'switch';
  min?: number;
  max?: number;
  default?: number | string;
  taper?: 'lin' | 'exp';
  unit?: string;
  positions?: string[];
} {
  const spec = CODECS[def.codec];
  const positions = codecPositions(def.codec);
  if (positions) {
    return {
      id: def.id,
      panelLabel: def.label,
      type: 'switch',
      positions: positions.map(String),
      default: String(positions[0]),
    };
  }
  return {
    id: def.id,
    panelLabel: def.label,
    type: 'knob',
    min: spec.min ?? 0,
    max: spec.max ?? 99,
    default: spec.min ?? 0,
    taper: def.codec === 'lfoRate' || def.codec === 'delayTime' ? 'exp' : 'lin',
    unit: def.unit,
  };
}
