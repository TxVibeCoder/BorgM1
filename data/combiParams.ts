/**
 * The M1 Combination Parameter table — the 124-byte SysEx record, as typed data.
 *
 * SOURCE, verbatim: Owner's Manual **p.128, "COMBINATION PARAMETER (TABLE 2)"**, cross-checked
 * against **p.131, "COMBINATION PARAMETER PAGE, POSITION -> OFFSET TABLE (TABLE 6)"**, which
 * lists the same offsets a second time grouped by edit page. Both agree on all 124. Semantics
 * and display ranges come from the Edit Combination Mode pages (manual pp.65-76); the effect
 * block is p.129 and is already modelled by `effectParams.ts`.
 *
 * (Note `pg/` in the research payload stops at p130, so TABLE 6 is only in `pages/b131.png`.)
 *
 * The record is 124 BYTES: 10 name, 1 type, 25 effect block, and 8 timbres of 11. It lands
 * immediately before the program bank in Korg's preload — 861 + 100x124 = 13261, which is
 * exactly where the programs start. That arithmetic is a free structural confirmation of both
 * the record size and the offsets.
 *
 * VALUES HERE ARE DISPLAY VALUES, NOT BYTES — the same contract as `programParams.ts` and
 * `effectParams.ts`. The table owns the codecs, so the byte layout lives in exactly one place
 * and Phase 6's factory importer is `decodeCombi`, written here at no extra cost.
 *
 * THE TIMBRE BLOCK IS DECLARED ONCE AND INSTANTIATED EIGHT TIMES. p.128 says "47 SAME AS
 * TIMBRE 1(36~46) x 7" and the code says the same thing: `TIMBRE_BLOCK` carries offsets
 * RELATIVE to its base and `timbreBlock(n)` places it at 36 + 11n. That is the `1`/`2` rule of
 * Phase 3 generalised to eight, and it makes the eight blocks structurally unable to drift.
 *
 * TWO TRAPS, POINTING IN OPPOSITE DIRECTIONS — see `CONTROL_FILTER_BITS` and `TIMBRE_ON_BIT`.
 * The four MIDI filter bits are `0:DIS, 1:ENA`, so a SET bit means RECEIVE. The timbre on/off
 * bit four positions away in the next byte is `0:ON, 1:OFF`, so a SET bit means SILENT. They
 * are documented together, because the danger is precisely that someone tidies one to match
 * the other.
 */

import type { ControlDef } from './schema';

/** Total size of one combination record, in bytes. Manual p.128. */
export const COMBI_RECORD_BYTES = 124;

/** Bytes 0..9, ASCII, `20~7F`. Held as `CombiState.name`, not as a param. */
export const COMBI_NAME_BYTES = 10;

/** Byte 10, `00~04`, note *4. */
export const COMBI_TYPE_OFFSET = 10;

/**
 * Bytes 11..35 — the same 25-byte effect block as a program's bytes 38..62 (`*11`, p.129).
 * `decodeEffects`/`encodeEffects` already take a start offset, so Phase 4's work is reused
 * verbatim rather than reimplemented.
 */
export const COMBI_EFFECT_BLOCK_START = 11;

/** Timbre 1's block. Manual p.128: "TIMBRE 1 PARAMETER" starts here. */
export const TIMBRE_BLOCK_BASE = 36;
/** Bytes per timbre block. 36..46 inclusive. */
export const TIMBRE_BLOCK_BYTES = 11;
/** Eight timbres: 36, 47, 58, 69, 80, 91, 102, 113 — TABLE 6 lists all eight explicitly. */
export const TIMBRE_COUNT = 8;

/**
 * The five types. Manual p.128 note *4. **Five real types, not one with a mode flag**: each
 * has its own edit pages and, for the two below, its own byte that no other type uses.
 */
export const COMBI_TYPES = ['SINGLE', 'LAYER', 'SPLIT', 'VELOCITY SWITCH', 'MULTI'] as const;
export type CombiType = (typeof COMBI_TYPES)[number];

/**
 * THE SPLIT POINT AND THE VELOCITY SWITCH POINT HAVE NO BYTES OF THEIR OWN. They are a VIEW
 * over the two timbres' windows, and reading them any other way is the first real trap in this
 * table.
 *
 * TABLE 6 marks the SPLIT page's cursor position D with footnote *14 and the VELOCITY SWITCH
 * page's with *15, and prints those footnotes as the bare numbers `68` and `70`. Every other
 * cell in that table is a byte offset, so 68 and 70 read as byte offsets — and they are not.
 * MEASURED against Korg's own bank (`npm run probe:combis`):
 *
 *   Bass&Reed   byte68=16  t1.keyTop=69  t2.keyBottom=70   -> the split is at 70, not 16
 *   Bass&Horn   byte68=16  t1.keyTop=59  t2.keyBottom=60   -> the split is at 60, not 16
 *
 * Byte 68 is timbre 3's `byte+10`, and 16 is simply its TIMBRE OFF bit — the same value all
 * 174 unused timbres of the non-MULTI combinations carry. Both factory splits store the point
 * as a CONTIGUOUS PAIR of key windows, which is also what the manual describes: "Split point is
 * the lowest key in the upper Program" (p.68).
 *
 * So the point is derived: read it back as timbre 2's window edge, and writing it moves both
 * timbres' edges so the two halves stay contiguous. 68 and 70 are almost certainly the MANUAL
 * PAGE NUMBERS on which each type's split is explained — p.68 is the SPLIT notes page and p.70
 * the VELOCITY SWITCH notes page — which is exactly the sort of footnote a cell needs when its
 * value is not one offset.
 *
 * The obvious-looking alternative — trusting the table and reading byte 68 — would have given
 * every factory SPLIT a split point of E0, and it would have looked like a DSP bug.
 */
export const SPLIT_POINT_DERIVED = true;

// ---- the panpot -------------------------------------------------------------------------

/**
 * The 14-position panpot. Manual p.128 note *5 gives the bytes; the Edit Combination pages
 * give the display: "A, A:B (in ratios from 9:1 - 1:9), B, C, C + D and D."
 *
 * THE PANPOT IS THE ROUTING. It is not a stereo pan — it is a bus assignment into the effect
 * section's four inputs, and it is the only thing that can reach buses C and D. That is what
 * makes PARALLEL routing mean anything: a Program has no panpot page at all, so it is
 * hard-wired 5:5 into A/B and cannot feed effect 2 in parallel (see `effectChainCore`). A
 * Combination can, and that is the whole point of this phase.
 */
export const PANPOT_POSITIONS = [
  'A',
  '9:1',
  '8:2',
  '7:3',
  '6:4',
  '5:5',
  '4:6',
  '3:7',
  '2:8',
  '1:9',
  'B',
  'C',
  'C+D',
  'D',
] as const;
export type PanpotPosition = (typeof PANPOT_POSITIONS)[number];

/** Index of `5:5`, the centre. Manual p.24: every non-drum Program defaults here. */
export const PANPOT_CENTRE = 5;
/** First index that leaves the A/B pair. Positions 11..13 are C, C+D and D. */
export const PANPOT_FIRST_CD = 11;

/** True when this panpot position routes to buses C/D rather than A/B. */
export function panpotIsCd(position: number): boolean {
  return position >= PANPOT_FIRST_CD;
}

/**
 * Bus gains for one panpot position, as `[a, b, c, d]`.
 *
 * RATIO-PRESERVING AND PEAK-NORMALISED: the two halves sit in exactly the ratio the display
 * prints, and the LOUDER of them always runs at unity. So `9:1` really is nine parts to one,
 * `5:5` is unity on both, and no position ever exceeds unity on either bus.
 *
 * THE CENTRE HAS TO BE UNITY, and that is measured rather than chosen. Manual p.37: "Programs
 * with the exception of drum kit are input to A and B **in a ratio of 5:5**" — Program mode is
 * the same panpot position a centred Combination timbre uses, and Program mode is the
 * instrument's reference level. Under the obvious sum-preserving law (`1-b`, `b`) the centre
 * is 0.5 on each bus, and a SINGLE Combination pointing at a program measured EXACTLY half
 * that program's level in PROGRAM mode — 0.2464 against 0.4927 at note 60, same spectral
 * centroid — a 6 dB step on switching mode that the hardware cannot have.
 *
 * What is given up is a constant sum, so the mono-sum-in reverbs do receive 6 dB less from a
 * hard-panned timbre than from a centred one. That is the ordinary behaviour of a 0 dB pan law
 * and it was the weaker of the two constraints: the level step is documented, the constant
 * send was an inference.
 *
 * `C+D` is the C/D pair's centre and follows the same rule — unity on both.
 */
export function panpotGains(position: number): [number, number, number, number] {
  const p = Math.min(PANPOT_POSITIONS.length - 1, Math.max(0, Math.round(position)));
  if (p === 11) return [0, 0, 1, 0]; // C
  if (p === 12) return [0, 0, 1, 1]; // C+D
  if (p === 13) return [0, 0, 0, 1]; // D
  // 0..10 is the A:B ratio, A-heavy first: position 0 is all A, position 10 all B.
  const a = 10 - p;
  const b = p;
  const loudest = Math.max(a, b);
  return [a / loudest, b / loudest, 0, 0];
}

// ---- codecs -----------------------------------------------------------------------------

/**
 * How one combination parameter's display value maps to (part of) its byte.
 *
 * `program` is the one that earns its own codec, and it is the only context-dependent field
 * in the record: manual p.128 note *12 says the mapping SHIFTS BY ONE in MULTI, where `00H`
 * means TIMBRE OFF and `I00` starts at `01H`. Every other type packs `I00` at `00H` and has no
 * OFF position at all. So the codec takes the combination type, and `decodeCombi` reads byte
 * 10 before it reads a single timbre.
 */
export type CombiCodecName =
  | 'program' // 00~C7, note *12 — I00..I99, C00..C99, and OFF in MULTI only
  | 'u99' // 00~63 : 0..99
  | 's12' // F4~0C : -12..12
  | 's50' // CE~32 : -50..50
  | 'key' // 00~7F : C-1..G9
  | 'vel' // 01~7F : 1..127
  | 'velTop' // as `vel`, but 0 is reachable — see VEL_TOP's note
  | 'reserved' // undocumented bits, carried verbatim
  | 'panpot' // bit3~0 : 0..0D, note *5
  | 'midiCh' // bit3~0 : 1..16
  | 'enaDis' // one bit, 0:DIS 1:ENA — a SET bit RECEIVES
  | 'timbreOn' // one bit, 0:ON 1:OFF — a SET bit is SILENT
  | 'panSource' // bit7, 0:TIM 1:INS
  | 'combiType'; // byte 10, note *4

/**
 * MIDI filter bit positions within the CONTROL FILTER byte (block offset 9). p.128 note *6.
 *
 * **`=0:DIS, =1:ENA`. A SET BIT MEANS RECEIVE.** Confirmed against the Edit Combination pages,
 * which display these four as `ENA`/`DIS` — "Damper has no effect on the Program of Layer 1
 * when Layer 1 Damper is set to DIS" (p.67), "A Timbre for which MIDI PROG CHG is set to DIS
 * does not change its Program" (p.76). The GLOBAL-mode filter (F5-2) uses the same wording.
 *
 * PLAN.md warns that "MIDI filter polarity is INVERTED — OFF means receive, ON means block".
 * That is NOT true of these four bits; it is true of `TIMBRE_ON_BIT` in the very next byte.
 * The warning is real and it points one field to the left.
 *
 * The practical consequence is the default: a cleared byte blocks everything, so a new timbre
 * has to be born with all four bits SET or it silently ignores the damper pedal.
 */
export const CONTROL_FILTER_BITS = {
  programChange: 0,
  damper: 1,
  afterTouch: 2,
  controlChange: 3,
} as const;

/**
 * TIMBRE ON/OFF — block offset 10, bit 4. p.128: **`bit4=0:ON, =1:OFF`**.
 *
 * THIS is the inverted one. A set bit silences the timbre. Note it sits four bits from
 * `CONTROL_FILTER_BITS.programChange` in the adjacent byte and means the opposite thing.
 */
export const TIMBRE_ON_BIT = 4;

/** Block offset 4, bit 7. p.128: `bit7=0:TIM, =1:INS`. See `PAN_SOURCES`. */
export const PAN_SOURCE_BIT = 7;

/**
 * `TIMBRE.INST`, block offset 4 bit 7. p.128 gives it as `bit7=0:TIM, =1:INS` and nothing else.
 *
 * AN HONEST UNKNOWN, PRESERVED RATHER THAN GUESSED AT — the same call Phase 4 made for I/O
 * bit 5. The obvious hypothesis is that it marks a drum-kit timbre, because the Edit
 * Combination pages say "When the Drum Kit Program is selected, the display shows `SND` and the
 * Panpot setting in the GLOBAL Mode is operative" (pp.67, 71), and a drum kit needs a pan per
 * INSTRUMENT rather than one for the whole timbre. THE FACTORY BANK REFUTES IT: bit7 is set on
 * exactly 2 of 800 timbres, 11 timbres point at a DRUMS-mode program, and the overlap is ZERO.
 * Both bit7 timbres point at the same non-drum program (I08).
 *
 * So the positions below are the manual's, the bit is carried verbatim so an import is
 * lossless, and NO DSP behaviour hangs off it. Inventing one would have silently rerouted two
 * factory combinations.
 */
export const PAN_SOURCES = ['TIMBRE', 'INSTRUMENT'] as const;

interface CombiCodecSpec {
  min?: number;
  max?: number;
  positions?: readonly string[];
}

const CODECS: Record<CombiCodecName, CombiCodecSpec> = {
  program: {},
  u99: { min: 0, max: 99 },
  s12: { min: -12, max: 12 },
  s50: { min: -50, max: 50 },
  key: { min: 0, max: 127 },
  vel: { min: 1, max: 127 },
  velTop: { min: 0, max: 127 },
  reserved: { min: 0, max: 255 },
  panpot: { positions: PANPOT_POSITIONS },
  midiCh: { min: 1, max: 16 },
  enaDis: { positions: ['DIS', 'ENA'] },
  timbreOn: { positions: ['ON', 'OFF'] },
  panSource: { positions: PAN_SOURCES },
  combiType: { positions: COMBI_TYPES },
};

export function combiCodecSpec(codec: CombiCodecName): CombiCodecSpec {
  return CODECS[codec];
}

// ---- the program pointer ------------------------------------------------------------------

/**
 * A timbre's program is a POINTER into the 200-slot program bank (`I00`..`I99`, `C00`..`C99`),
 * not a copy of the program. The 124-byte record has no room for anything else, and that is
 * also why editing a program in PROGRAM mode changes every timbre that points at it.
 *
 * `null` is TIMBRE OFF, which only MULTI can express (note *12).
 */
export type ProgramRef = string | null;

export const PROGRAM_BANKS = ['I', 'C'] as const;
export const PROGRAMS_PER_BANK = 100;
/** `00~C7` = 0..199. Two banks of 100. */
export const PROGRAM_REF_COUNT = PROGRAM_BANKS.length * PROGRAMS_PER_BANK;

/** `I17` -> 17, `C00` -> 100. Returns null for anything unparseable, which reads as OFF. */
export function programRefToIndex(ref: ProgramRef): number | null {
  if (typeof ref !== 'string') return null;
  const bank = PROGRAM_BANKS.indexOf(ref[0] as (typeof PROGRAM_BANKS)[number]);
  if (bank < 0) return null;
  const n = Number(ref.slice(1));
  if (!Number.isInteger(n) || n < 0 || n >= PROGRAMS_PER_BANK) return null;
  return bank * PROGRAMS_PER_BANK + n;
}

/** 17 -> `I17`, 100 -> `C00`. */
export function programIndexToRef(index: number): ProgramRef {
  if (!Number.isFinite(index)) return null;
  const i = Math.round(index);
  if (i < 0 || i >= PROGRAM_REF_COUNT) return null;
  const bank = PROGRAM_BANKS[Math.floor(i / PROGRAMS_PER_BANK)]!;
  return `${bank}${String(i % PROGRAMS_PER_BANK).padStart(2, '0')}`;
}

/** Every legal program reference, in bank order. The picker's list. */
export const PROGRAM_REFS: string[] = Array.from(
  { length: PROGRAM_REF_COUNT },
  (_, i) => programIndexToRef(i)!,
);

// ---- parameter definitions ----------------------------------------------------------------

/** Which edit page a parameter lives on. Mirrors TABLE 6's grouping (manual p.131). */
export type CombiParamGroup = 'TIMBRE' | 'WINDOW' | 'PITCH' | 'MIDI FILTER' | 'COMBI';

export interface CombiParamDef {
  /** Stable id. Per-timbre params are prefixed `T1_`..`T8_`. */
  id: string;
  /** Byte offset into the 124-byte record. */
  offset: number;
  /** Bit position for sub-byte parameters. */
  bit?: number;
  /** UI label. */
  label: string;
  /** TABLE 2's own wording. The join key back to the manual; never shown in the UI. */
  sysexName: string;
  group: CombiParamGroup;
  codec: CombiCodecName;
  default: number | string;
  unit?: string;
  /** Timbre this belongs to (1..8), or null for combination-level parameters. */
  timbre: number | null;
  notes?: string;
}

/** A per-timbre entry, with `offset` RELATIVE to the block base. */
type TimbreParamSpec = Omit<CombiParamDef, 'timbre' | 'id'> & { id: string };

/**
 * Bytes 36..46, declared once. Manual p.128, TIMBRE 1 PARAMETER.
 *
 * Defaults describe a timbre that plays: full range, full velocity, unity level, centre pan,
 * every MIDI filter ENABLED and the timbre ON. The filter defaults are the load-bearing ones —
 * see `CONTROL_FILTER_BITS`, where a cleared byte would block the damper pedal on every new
 * combination and look like a sustain bug.
 */
const TIMBRE_BLOCK: TimbreParamSpec[] = [
  {
    id: 'PROGRAM',
    offset: 0,
    label: 'PROGRAM',
    sysexName: 'PROGRAM NO.',
    group: 'TIMBRE',
    codec: 'program',
    default: 'I00',
    notes: 'Note *12: the byte mapping shifts by one in MULTI, where 00H is TIMBRE OFF.',
  },
  {
    id: 'LEVEL',
    offset: 1,
    label: 'LEVEL',
    sysexName: 'OUTPUT LEVEL',
    group: 'TIMBRE',
    codec: 'u99',
    default: 99,
    notes:
      'Manual p.65: "when set to 99 is the full volume as set in the Program parameter, and ' +
      '0 mutes the Program completely" — so 99 is UNITY, not a headroom-reduced maximum.',
  },
  {
    id: 'TRANSPOSE',
    offset: 2,
    label: 'TRANSPOSE',
    sysexName: 'KEY TRANSPOSE',
    group: 'PITCH',
    codec: 's12',
    default: 0,
    unit: 'semi',
    notes: 'The LAYER page calls the same byte "Interval" (p.66). One field, two names.',
  },
  {
    id: 'DETUNE',
    offset: 3,
    label: 'DETUNE',
    sysexName: 'DETUNE',
    group: 'PITCH',
    codec: 's50',
    default: 0,
    unit: 'cents',
  },
  {
    id: 'PAN_SOURCE',
    offset: 4,
    bit: PAN_SOURCE_BIT,
    label: 'PAN SRC',
    sysexName: 'TIMBRE.INST',
    group: 'TIMBRE',
    codec: 'panSource',
    default: 'TIMBRE',
    notes: 'INSTRUMENT hands the routing to the global per-drum pan table; display reads SND.',
  },
  {
    id: 'PAN',
    offset: 4,
    label: 'PAN',
    sysexName: 'PAN',
    group: 'TIMBRE',
    codec: 'panpot',
    default: '5:5',
  },
  {
    id: 'KEY_TOP',
    offset: 5,
    label: 'KEY TOP',
    sysexName: 'KEY WINDOW TOP',
    group: 'WINDOW',
    codec: 'key',
    default: 127,
  },
  {
    id: 'KEY_BOTTOM',
    offset: 6,
    label: 'KEY BTM',
    sysexName: 'KEY WINDOW BOTTOM',
    group: 'WINDOW',
    codec: 'key',
    default: 0,
  },
  {
    id: 'VEL_TOP',
    offset: 7,
    label: 'VEL TOP',
    sysexName: 'VEL.WINDOW TOP',
    group: 'WINDOW',
    codec: 'velTop',
    default: 127,
    notes:
      'p.128 documents 01~7F, but the factory bank writes 0 here on all 174 unused timbres of ' +
      'its non-MULTI combinations — and 0 is MEANINGFUL, since a top below the bottom is an ' +
      'empty window and an unused timbre is exactly what should never sound. VEL BOTTOM is ' +
      'never 0 in the same 800 timbres, so the range is widened here and only here.',
  },
  {
    id: 'VEL_BOTTOM',
    offset: 8,
    label: 'VEL BTM',
    sysexName: 'VEL.WINDOW BOTTOM',
    group: 'WINDOW',
    codec: 'vel',
    default: 1,
  },
  {
    id: 'FILTER_PROGRAM_CHANGE',
    offset: 9,
    bit: CONTROL_FILTER_BITS.programChange,
    label: 'PRG CHG',
    sysexName: 'CONTROL FILTER bit0',
    group: 'MIDI FILTER',
    codec: 'enaDis',
    default: 'ENA',
  },
  {
    id: 'FILTER_DAMPER',
    offset: 9,
    bit: CONTROL_FILTER_BITS.damper,
    label: 'DAMPER',
    sysexName: 'CONTROL FILTER bit1',
    group: 'MIDI FILTER',
    codec: 'enaDis',
    default: 'ENA',
  },
  {
    id: 'FILTER_AFTER_TOUCH',
    offset: 9,
    bit: CONTROL_FILTER_BITS.afterTouch,
    label: 'AFTER TCH',
    sysexName: 'CONTROL FILTER bit2',
    group: 'MIDI FILTER',
    codec: 'enaDis',
    default: 'ENA',
  },
  {
    id: 'FILTER_CONTROL_CHANGE',
    offset: 9,
    bit: CONTROL_FILTER_BITS.controlChange,
    label: 'CTRL CHG',
    sysexName: 'CONTROL FILTER bit3',
    group: 'MIDI FILTER',
    codec: 'enaDis',
    default: 'ENA',
  },
  {
    id: 'FILTER_RESERVED',
    offset: 9,
    label: 'RESERVED',
    sysexName: 'CONTROL FILTER bits 7~4',
    group: 'MIDI FILTER',
    codec: 'reserved',
    default: 0xf0,
    notes:
      'p.128 specifies bit3~0 of this byte and says nothing about the top nibble. MEASURED: it ' +
      'is 0xF in 768 of 800 factory timbres, 0x0 in 31 and 0x4 in one — real data, correlating ' +
      'with nothing testable. Carried verbatim so a factory import is lossless, exactly as ' +
      "Phase 4 carried the effect I/O byte's undocumented bit 5. An honest unknown, not a " +
      'placeholder; the default matches the population.',
  },
  {
    id: 'TIMBRE_OFF',
    offset: 10,
    bit: TIMBRE_ON_BIT,
    label: 'TIMBRE',
    sysexName: 'TIMBRE ON.OFF',
    group: 'TIMBRE',
    codec: 'timbreOn',
    default: 'ON',
    notes: 'INVERTED: a SET bit means OFF. The only inverted bit in the record.',
  },
  {
    id: 'CHANNEL',
    offset: 10,
    label: 'MIDI CH',
    sysexName: 'MIDI CHANNEL',
    group: 'TIMBRE',
    codec: 'midiCh',
    default: 1,
  },
];

/** Place `TIMBRE_BLOCK` at 36 + 11(n-1). TABLE 6 prints all eight bases; they agree. */
function timbreBlock(timbre: number): CombiParamDef[] {
  const base = TIMBRE_BLOCK_BASE + (timbre - 1) * TIMBRE_BLOCK_BYTES;
  return TIMBRE_BLOCK.map((p) => ({
    ...p,
    id: `T${timbre}_${p.id}`,
    offset: base + p.offset,
    timbre,
  }));
}

/** Combination-level parameters, then all eight timbre blocks. */
export const COMBI_PARAMS: CombiParamDef[] = [
  {
    id: 'COMBI_TYPE',
    offset: COMBI_TYPE_OFFSET,
    label: 'TYPE',
    sysexName: 'COMBINATION TYPE',
    group: 'COMBI',
    codec: 'combiType',
    default: 'SINGLE',
    timbre: null,
  },
  ...Array.from({ length: TIMBRE_COUNT }, (_, i) => timbreBlock(i + 1)).flat(),
];

export const COMBI_PARAMS_BY_ID: ReadonlyMap<string, CombiParamDef> = new Map(
  COMBI_PARAMS.map((p) => [p.id, p]),
);

export function combiParam(id: string): CombiParamDef {
  const p = COMBI_PARAMS_BY_ID.get(id);
  if (!p) throw new Error(`unknown combination parameter: ${id}`);
  return p;
}

/** Every parameter belonging to one timbre, in table order. */
export function timbreParams(timbre: number): CombiParamDef[] {
  return COMBI_PARAMS.filter((p) => p.timbre === timbre);
}

// ---- byte <-> display value ---------------------------------------------------------------

function toSigned(byte: number): number {
  return byte > 127 ? byte - 256 : byte;
}

function fromSigned(v: number): number {
  return v < 0 ? v + 256 : v;
}

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

/**
 * Byte -> program reference. Note *12: MULTI shifts the whole map up by one to make room for
 * `00H = TIMBRE OFF`.
 *
 * p.128 prints `C8H = C99` for the non-MULTI case, which cannot be right — `64H = C00` plus
 * 100 programs ends at `C7H`, and the field's own range in the same table is `00~C7`. The
 * second block was evidently copied from the MULTI one and its last line not adjusted. The
 * range is treated as the authority; the factory bank agrees (see `probeCombis`).
 */
export function byteToProgramRef(byte: number, isMulti: boolean): ProgramRef {
  const b = clampInt(byte, 0, 255);
  if (!isMulti) return programIndexToRef(b);
  return b === 0 ? null : programIndexToRef(b - 1);
}

export function programRefToByte(ref: ProgramRef, isMulti: boolean): number {
  const i = programRefToIndex(ref);
  if (!isMulti) return i ?? 0;
  return i === null ? 0 : i + 1;
}

/** Read one parameter's display value out of a raw 124-byte record. */
export function decodeCombiParam(
  def: CombiParamDef,
  record: Uint8Array,
  isMulti: boolean,
): number | string {
  const byte = record[def.offset] ?? 0;
  switch (def.codec) {
    case 'program':
      return byteToProgramRef(byte, isMulti) ?? 'OFF';
    case 'u99':
    case 'key':
    case 'vel':
    case 'velTop':
      return clampInt(byte, CODECS[def.codec].min!, CODECS[def.codec].max!);
    case 'reserved':
      // The top nibble only; bits 3~0 belong to the four documented filters.
      return byte & 0xf0;
    case 's12':
    case 's50':
      return clampInt(toSigned(byte), CODECS[def.codec].min!, CODECS[def.codec].max!);
    case 'panpot':
      return PANPOT_POSITIONS[clampInt(byte & 0x0f, 0, PANPOT_POSITIONS.length - 1)]!;
    case 'midiCh':
      // 4 bits hold 0..15 and the manual prints the range as 1~16, so the stored value is
      // one less than the displayed channel.
      return (byte & 0x0f) + 1;
    case 'enaDis':
      // A SET bit RECEIVES. See CONTROL_FILTER_BITS.
      return (byte >> (def.bit ?? 0)) & 1 ? 'ENA' : 'DIS';
    case 'timbreOn':
      // INVERTED: a SET bit is OFF.
      return (byte >> (def.bit ?? 0)) & 1 ? 'OFF' : 'ON';
    case 'panSource':
      return PAN_SOURCES[(byte >> PAN_SOURCE_BIT) & 1]!;
    case 'combiType':
      return COMBI_TYPES[clampInt(byte, 0, COMBI_TYPES.length - 1)]!;
  }
}

/**
 * Write one parameter's display value into a raw record, preserving the other parameters that
 * share its byte. `record` is mutated.
 */
export function encodeCombiParam(
  def: CombiParamDef,
  value: number | string,
  record: Uint8Array,
  isMulti: boolean,
): void {
  const prev = record[def.offset] ?? 0;
  const setBit = (bit: number, on: boolean): number =>
    on ? prev | (1 << bit) : prev & ~(1 << bit);

  switch (def.codec) {
    case 'program':
      record[def.offset] = programRefToByte(
        value === 'OFF' || value === null ? null : String(value),
        isMulti,
      );
      return;
    case 'u99':
    case 'key':
    case 'vel':
    case 'velTop':
      record[def.offset] = clampInt(Number(value), CODECS[def.codec].min!, CODECS[def.codec].max!);
      return;
    case 'reserved':
      record[def.offset] = (prev & 0x0f) | (clampInt(Number(value), 0, 255) & 0xf0);
      return;
    case 's12':
    case 's50':
      record[def.offset] = fromSigned(
        clampInt(Number(value), CODECS[def.codec].min!, CODECS[def.codec].max!),
      );
      return;
    case 'panpot': {
      const i = Math.max(0, PANPOT_POSITIONS.indexOf(value as PanpotPosition));
      // Bits 3~0 only — bit 7 is the pan SOURCE and shares this byte.
      record[def.offset] = (prev & ~0x0f) | i;
      return;
    }
    case 'midiCh':
      record[def.offset] = (prev & ~0x0f) | (clampInt(Number(value), 1, 16) - 1);
      return;
    case 'enaDis':
      record[def.offset] = setBit(def.bit ?? 0, value === 'ENA');
      return;
    case 'timbreOn':
      record[def.offset] = setBit(def.bit ?? 0, value === 'OFF');
      return;
    case 'panSource':
      record[def.offset] = setBit(PAN_SOURCE_BIT, value === 'INSTRUMENT');
      return;
    case 'combiType':
      record[def.offset] = Math.max(0, COMBI_TYPES.indexOf(value as CombiType));
      return;
  }
}

// ---- whole-record helpers -------------------------------------------------------------------

export function defaultCombiParams(): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const p of COMBI_PARAMS) out[p.id] = p.default;
  return out;
}

/**
 * Heal a params bag: fill every missing parameter from its default, clamp numbers into the
 * range the manual gives them, reject any enumerated value that is not a legal position, and
 * DROP unknown keys — which is also the last route by which a JSON-hostile value could reach
 * the state tree.
 */
export function coalesceCombiParams(
  raw: Record<string, unknown> | undefined,
): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const p of COMBI_PARAMS) {
    const v = raw?.[p.id];
    const spec = CODECS[p.codec];
    if (p.codec === 'program') {
      out[p.id] = typeof v === 'string' && (v === 'OFF' || programRefToIndex(v) !== null)
        ? v
        : p.default;
    } else if (spec.positions) {
      out[p.id] = typeof v === 'string' && spec.positions.includes(v) ? v : p.default;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[p.id] = clampInt(v, spec.min ?? 0, spec.max ?? 127);
    } else {
      out[p.id] = p.default;
    }
  }
  return out;
}

/** How many timbres a type uses. Only MULTI exposes all eight. */
export function timbresInType(type: string): number {
  if (type === 'MULTI') return TIMBRE_COUNT;
  return type === 'SINGLE' ? 1 : 2;
}

// ---- the derived split and velocity switch points -------------------------------------------
//
// See `SPLIT_POINT_DERIVED`. These have no bytes; they are a one-value view of the two
// timbres' windows, which is how the hardware's SPLIT and VELOCITY SWITCH edit pages present
// them and how the factory bank stores them.

/** Manual p.68: "Split point is the lowest key in the upper Program" — i.e. timbre 2's edge. */
export function readSplitPoint(params: Record<string, number | string>): number {
  return clampInt(Number(params['T2_KEY_BOTTOM']), 0, 127);
}

/** Writes BOTH edges so the two halves stay contiguous, which is what the factory bank shows. */
export function writeSplitPoint(
  params: Record<string, number | string>,
  point: number,
): Record<string, number | string> {
  const p = clampInt(point, 0, 127);
  return {
    ...params,
    T1_KEY_BOTTOM: 0,
    T1_KEY_TOP: Math.max(0, p - 1),
    T2_KEY_BOTTOM: p,
    T2_KEY_TOP: 127,
  };
}

/** The velocity twin. Timbre 2 is the LOUD half, so the point is its window bottom. */
export function readVelSwitchPoint(params: Record<string, number | string>): number {
  return clampInt(Number(params['T2_VEL_BOTTOM']), 1, 127);
}

/**
 * `T1_VEL_TOP` becomes `point - 1`, which is 0 when the point is 1 — a legal byte here (see
 * VEL_TOP's note) and exactly the manual's "If the Velocity SW point is set to 1, the soft
 * Program will not sound" (p.70). An empty window is the mechanism, not a special case.
 */
export function writeVelSwitchPoint(
  params: Record<string, number | string>,
  point: number,
): Record<string, number | string> {
  const p = clampInt(point, 1, 127);
  return {
    ...params,
    T1_VEL_BOTTOM: 1,
    T1_VEL_TOP: p - 1,
    T2_VEL_BOTTOM: p,
    T2_VEL_TOP: 127,
  };
}

/** Read a whole 124-byte record into a params bag. Phase 6's factory importer. */
export function decodeCombi(record: Uint8Array): Record<string, number | string> {
  const type = COMBI_TYPES[clampInt(record[COMBI_TYPE_OFFSET] ?? 0, 0, COMBI_TYPES.length - 1)]!;
  const isMulti = type === 'MULTI';
  const out: Record<string, number | string> = {};
  for (const p of COMBI_PARAMS) out[p.id] = decodeCombiParam(p, record, isMulti);
  return out;
}

/** Write a params bag into a fresh 124-byte record. */
export function encodeCombi(params: Record<string, number | string>): Uint8Array {
  const record = new Uint8Array(COMBI_RECORD_BYTES);
  const p = coalesceCombiParams(params);
  const isMulti = String(p['COMBI_TYPE']) === 'MULTI';
  for (const def of COMBI_PARAMS) encodeCombiParam(def, p[def.id]!, record, isMulti);
  return record;
}

export function decodeCombiName(record: Uint8Array): string {
  let s = '';
  for (let i = 0; i < COMBI_NAME_BYTES; i++) {
    const c = record[i] ?? 32;
    s += c >= 32 && c < 127 ? String.fromCharCode(c) : ' ';
  }
  return s.trimEnd();
}

export function encodeCombiName(name: string, record: Uint8Array): void {
  for (let i = 0; i < COMBI_NAME_BYTES; i++) {
    const c = name.charCodeAt(i);
    record[i] = Number.isFinite(c) && c >= 32 && c < 127 ? c : 32;
  }
}

// ---- the panel's view of the table ----------------------------------------------------------

/**
 * Project a combination parameter onto `ControlDef`, so the panel's controls and the validator
 * in `data/schema.ts` see the same shapes the program table's controls do. The table above
 * stays the source of truth; this is a view of it.
 */
export function toCombiControlDef(p: CombiParamDef): ControlDef {
  const spec = CODECS[p.codec];
  const ref = "Owner's Manual p.128 (TABLE 2)";
  // The program pointer is a 201-position selector, not a knob — OFF plus two banks of 100.
  const positions = p.codec === 'program' ? ['OFF', ...PROGRAM_REFS] : spec.positions;
  if (positions) {
    return {
      id: p.id,
      panelLabel: p.label,
      type: 'switch',
      positions: [...positions],
      default: p.default,
      manualRef: ref,
      notes: p.notes,
    };
  }
  return {
    id: p.id,
    panelLabel: p.label,
    type: 'knob',
    min: spec.min,
    max: spec.max,
    default: p.default as number,
    taper: 'lin',
    unit: p.unit,
    manualRef: ref,
    notes: p.notes,
  };
}

export const COMBI_CONTROL_DEFS: ControlDef[] = COMBI_PARAMS.map(toCombiControlDef);
