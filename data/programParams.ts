/**
 * The M1 Program Parameter table — the 143-byte SysEx record, as typed data.
 *
 * SOURCE, verbatim: Owner's Manual **p.127, "PROGRAM PARAMETER (TABLE 1)"**, cross-checked
 * against **p.130, "PROGRAM PARAMETER PAGE, POSITION -> OFFSET TABLE (TABLE 5)"**, which
 * lists the same offsets a second time grouped by edit page. Every offset below appears in
 * both tables and they agree. Semantics and display ranges come from the Edit Program Mode
 * pages (manual pp.21-35); the effect block is p.129.
 *
 * The record is 143 BYTES, not 143 parameters: bytes 0-9 are the name, bytes 38-62 are the
 * 25-byte effect block (Phase 4), and six bytes pack several parameters each. The actual
 * control count is 139 — see PROGRAM_PARAMS.length, pinned by test.
 *
 * VALUES HERE ARE DISPLAY VALUES, NOT BYTES. The params bag in `m1State` stores what the
 * panel shows (-99..99, '+', 'SINGLE'), and this table knows how to encode each one back
 * into its byte. That direction matters: Phase 6 imports Korg's factory preload, which is
 * raw bytes, so `decodeProgram` below is the importer and it comes for free.
 *
 * THE `1`/`2` RULE APPLIES TO THE DATA, NOT ONLY THE UI. Bytes 63-102 are oscillator 1 and
 * bytes 103-142 are "SAME AS OSC-1(63~102)" — the manual's own words. So the block is
 * declared ONCE, with offsets relative to its base, and instantiated twice. The two halves
 * are structurally unable to drift, which is the same reason UI-SPEC §4 asks for one
 * per-oscillator component instantiated twice.
 *
 * Hex ranges in TABLE 1 read `00~63` (= 0..99 decimal) and `9D~63` (= -99..99 as a
 * two's-complement byte). They are decimal ranges written in hex, not bitfields.
 *
 * NOMENCLATURE. `sysexName` is Korg's own wording, kept because it is the join key back to
 * the manual. `label` is what the UI says, and it translates VDF/VDA to FILTER/AMP per
 * CLAUDE.md. Never put `sysexName` on a panel.
 */

import type { ControlDef } from './schema';

/** Total size of one program record, in bytes. Manual p.127. */
export const PROGRAM_RECORD_BYTES = 143;

/** Oscillator 1's parameter block. Manual p.127: "OSC-1 PITCH EG" starts here. */
export const OSC_BLOCK_BASE = 63;
/** Oscillator 2's block. Manual p.127: "103 SAME AS OSC-1(63~102)". */
export const OSC2_BLOCK_BASE = 103;
/** Bytes per oscillator block. 63..102 inclusive. */
export const OSC_BLOCK_BYTES = 40;

/** Bytes 0..9, ASCII, `20~7F`. Held as `ProgramState.name`, not as a param. */
export const PROGRAM_NAME_BYTES = 10;

/**
 * Bytes 38..62 — the 25-byte effect block (`*11`, manual p.129). Phase 4 decodes it;
 * Phase 3 reserves it so the record stays 143 bytes and a round-trip is lossless.
 */
export const EFFECT_BLOCK_START = 38;
export const EFFECT_BLOCK_BYTES = 25;

// ---- codecs ---------------------------------------------------------------------------

/**
 * How one parameter's display value maps to (part of) its byte.
 *
 * `swpol` is the one that earns its own codec: bytes 99-102 each hold FOUR three-state
 * controls, and the enable and the polarity are SEPARATE BITS four apart (manual p.127
 * note *1). A value of `'0'` clears the enable bit, so 0 genuinely means disabled and the
 * polarity bit is then irrelevant. Getting this wrong makes a third of the envelopes subtly
 * wrong in a way that reads as a DSP bug. Note the asymmetry with VDF cutoff keyboard
 * tracking, where 0 means FULL tracking — see `keyboardTrackingRatio` in lowpassCore.
 */
export type CodecName =
  | 'u99' // 00~63 : 0..99
  | 'u3' // 00~03 : 0..3
  | 's99' // 9D~63 : -99..99
  | 's12' // F4~0C : -12..12
  | 's50' // CE~32 : -50..50
  | 'key' // 00~7F : C-1..G9
  | 'octave' // FF~01 : 16'..4'
  | 'multisound' // 00~63 internal (64~ is a PCM card we do not model)
  | 'oscMode' // byte 10, note *2
  | 'assign' // byte 11 bit0
  | 'flag' // one bit, OFF/ON
  | 'mgWave' // 2 bits, note *3
  | 'swpol'; // one of the 16 three-state controls in bytes 99-102

/** MG waveforms. Manual p.127 note *3. */
export const MG_WAVEFORMS = ['TRIANGLE', 'UP SAW', 'DOWN SAW', 'RECTANGLE'] as const;
/** Oscillator modes. Manual p.127 note *2. DRUM is spelled DRUMS in the plugin UI. */
export const OSC_MODES = ['SINGLE', 'DOUBLE', 'DRUMS'] as const;
/** Voice assign. Manual p.127 byte 11 bit0. */
export const ASSIGN_POSITIONS = ['POLY', 'MONO'] as const;
/** Octave feet. Manual p.127: FF~01 : 16'~4'. */
export const OCTAVE_POSITIONS = ["16'", "8'", "4'"] as const;
/** The three states of every EG-time modulation switch. Manual p.26/p.27: "0 having no effect". */
export const SWPOL_POSITIONS = ['-', '0', '+'] as const;
/** The four EG segments each SW&POL byte controls, in bit order. Manual p.127 note *1. */
export const EG_SEGMENTS = ['ATTACK', 'DECAY', 'SLOPE', 'RELEASE'] as const;

interface CodecSpec {
  /** Inclusive display range for numeric codecs. */
  min?: number;
  max?: number;
  /** Position list for enumerated codecs. */
  positions?: readonly string[];
}

const CODECS: Record<CodecName, CodecSpec> = {
  u99: { min: 0, max: 99 },
  u3: { min: 0, max: 3 },
  s99: { min: -99, max: 99 },
  s12: { min: -12, max: 12 },
  s50: { min: -50, max: 50 },
  key: { min: 0, max: 127 },
  octave: { positions: OCTAVE_POSITIONS },
  multisound: { min: 0, max: 99 },
  oscMode: { positions: OSC_MODES },
  assign: { positions: ASSIGN_POSITIONS },
  flag: { positions: ['OFF', 'ON'] },
  mgWave: { positions: MG_WAVEFORMS },
  swpol: { positions: SWPOL_POSITIONS },
};

export function codecSpec(codec: CodecName): CodecSpec {
  return CODECS[codec];
}

// ---- parameter definitions ------------------------------------------------------------

/** Which edit page a parameter lives on. Mirrors TABLE 5's grouping (manual p.130). */
export type ParamGroup =
  | 'OSC BASIC'
  | 'OSC'
  | 'PITCH EG'
  | 'FILTER'
  | 'FILTER EG'
  | 'FILTER KBD TRACK'
  | 'FILTER VELOCITY'
  | 'AMP'
  | 'AMP EG'
  | 'AMP KBD TRACK'
  | 'AMP VELOCITY'
  | 'PITCH MG'
  | 'FILTER MG'
  | 'AFTER TOUCH'
  | 'JOY STICK';

export interface ProgramParamDef {
  /** Stable id. Per-oscillator params are prefixed `OSC1_` / `OSC2_`. */
  id: string;
  /** Byte offset into the 143-byte record. */
  offset: number;
  /**
   * Bit position for sub-byte parameters. For `swpol` this is the ENABLE bit; the polarity
   * bit is always this + 4 (manual p.127 note *1).
   */
  bit?: number;
  /** UI label. FILTER/AMP nomenclature — never Korg's VDF/VDA (CLAUDE.md). */
  label: string;
  /** TABLE 1's own wording. The join key back to the manual; never shown in the UI. */
  sysexName: string;
  group: ParamGroup;
  codec: CodecName;
  default: number | string;
  unit?: string;
  /** Oscillator this belongs to, or null for program-level parameters. */
  osc: 1 | 2 | null;
  notes?: string;
}

/** A per-oscillator entry, with `offset` RELATIVE to the block base. */
type OscParamSpec = Omit<ProgramParamDef, 'osc' | 'id'> & { id: string };

/**
 * Bytes 63..102, declared once. `offset` is relative to the block base, so instantiating
 * the block at 63 and at 103 is the whole of the `1`/`2` rule at the data layer.
 *
 * Defaults describe a flat, neutral, audible program: instant attack, full sustain, filter
 * open, no modulation. That is a CHOICE — Korg's INIT PROGRAM contents are not in the
 * manual — but a defensible one, because it is the shape `I17 Organ 2` itself uses, which
 * makes the Phase 4 fidelity gate reachable by editing rather than by fighting the default.
 */
const OSC_BLOCK: OscParamSpec[] = [
  // ---- OSC-n PITCH EG (63..70) --------------------------------------------------------
  { id: 'PEG_START', offset: 0, label: 'START LEVEL', sysexName: 'START LEVEL', group: 'PITCH EG', codec: 's99', default: 0 },
  { id: 'PEG_AT', offset: 1, label: 'ATTACK TIME', sysexName: 'ATTACK TIME', group: 'PITCH EG', codec: 'u99', default: 0 },
  { id: 'PEG_AL', offset: 2, label: 'ATTACK LEVEL', sysexName: 'ATTACK LEVEL', group: 'PITCH EG', codec: 's99', default: 0 },
  { id: 'PEG_DT', offset: 3, label: 'DECAY TIME', sysexName: 'DECAY TIME', group: 'PITCH EG', codec: 'u99', default: 0 },
  { id: 'PEG_RT', offset: 4, label: 'RELEASE TIME', sysexName: 'RELEASE TIME', group: 'PITCH EG', codec: 'u99', default: 0 },
  { id: 'PEG_RL', offset: 5, label: 'RELEASE LEVEL', sysexName: 'RELEASE LEVEL', group: 'PITCH EG', codec: 's99', default: 0 },
  { id: 'PEG_TIME_VEL', offset: 6, label: 'TIME VEL', sysexName: 'TIME VELOCITY SENSE', group: 'PITCH EG', codec: 's99', default: 0 },
  { id: 'PEG_LEVEL_VEL', offset: 7, label: 'LEVEL VEL', sysexName: 'LEVEL VELOCITY SENSE', group: 'PITCH EG', codec: 's99', default: 0 },

  // ---- VDF-n (71..77) -----------------------------------------------------------------
  { id: 'VDF_CUTOFF', offset: 8, label: 'CUTOFF', sysexName: 'CUTOFF VALUE', group: 'FILTER', codec: 'u99', default: 99 },
  {
    id: 'VDF_TRACK_CENTER', offset: 9, label: 'CENTER KEY', sysexName: 'KBD TRACK CENTER',
    group: 'FILTER KBD TRACK', codec: 'key', default: 60,
    notes: "The key at which tracking contributes nothing. Manual p.27: 'the key for which cutoff/EG time does not change'.",
  },
  {
    id: 'VDF_CUTOFF_TRACK', offset: 10, label: 'CUTOFF TRACK', sysexName: 'CUTOFF KBD TRACK',
    group: 'FILTER KBD TRACK', codec: 's99', default: -99,
    notes:
      'THE TRAP: 0 means 100% tracking, not none — manual p.27, "The change of Cutoff and the change ' +
      'of pitch are equal when set to 0." Negative values reduce it. Asymmetric with EG-time tracking, ' +
      'where 0 IS off. See keyboardTrackingRatio in lowpassCore.ts.',
  },
  { id: 'VDF_EG_INT', offset: 11, label: 'EG INT', sysexName: 'EG INTENSITY', group: 'FILTER', codec: 'u99', default: 0 },
  { id: 'VDF_EGT_TRACK', offset: 12, label: 'EG TIME TRACK', sysexName: 'EG TIME KBD TRACK', group: 'FILTER KBD TRACK', codec: 'u99', default: 0 },
  { id: 'VDF_EGT_VEL', offset: 13, label: 'EG TIME VEL', sysexName: 'EG TIME VEL. SENSE', group: 'FILTER VELOCITY', codec: 'u99', default: 0 },
  { id: 'VDF_EGI_VEL', offset: 14, label: 'EG INT VEL', sysexName: 'EG INT. VEL. SENSE', group: 'FILTER VELOCITY', codec: 's99', default: 0 },

  // ---- VDF-n EG (78..85). Eight parameters: it releases to a LEVEL. --------------------
  { id: 'VDF_EG_AT', offset: 15, label: 'ATTACK TIME', sysexName: 'ATTACK TIME', group: 'FILTER EG', codec: 'u99', default: 0 },
  { id: 'VDF_EG_AL', offset: 16, label: 'ATTACK LEVEL', sysexName: 'ATTACK LEVEL', group: 'FILTER EG', codec: 's99', default: 0 },
  { id: 'VDF_EG_DT', offset: 17, label: 'DECAY TIME', sysexName: 'DECAY TIME', group: 'FILTER EG', codec: 'u99', default: 0 },
  { id: 'VDF_EG_BP', offset: 18, label: 'BREAK POINT', sysexName: 'BREAK POINT', group: 'FILTER EG', codec: 's99', default: 0 },
  { id: 'VDF_EG_ST', offset: 19, label: 'SLOPE TIME', sysexName: 'SLOPE TIME', group: 'FILTER EG', codec: 'u99', default: 0 },
  { id: 'VDF_EG_SL', offset: 20, label: 'SUSTAIN LEVEL', sysexName: 'SUSTAIN LEVEL', group: 'FILTER EG', codec: 's99', default: 0 },
  { id: 'VDF_EG_RT', offset: 21, label: 'RELEASE TIME', sysexName: 'RELEASE TIME', group: 'FILTER EG', codec: 'u99', default: 0 },
  {
    id: 'VDF_EG_RL', offset: 22, label: 'RELEASE LEVEL', sysexName: 'RELEASE LEVEL', group: 'FILTER EG', codec: 's99', default: 0,
    notes: 'The AMP EG has no counterpart to this. That asymmetry is why UI-SPEC asks for two EG graph components.',
  },

  // ---- VDA-n (86..91) -----------------------------------------------------------------
  { id: 'VDA_LEVEL', offset: 23, label: 'LEVEL', sysexName: 'OSCILATOR LEVEL', group: 'OSC', codec: 'u99', default: 70 },
  { id: 'VDA_TRACK_CENTER', offset: 24, label: 'CENTER KEY', sysexName: 'KBD TRACK CENTER', group: 'AMP KBD TRACK', codec: 'key', default: 60 },
  { id: 'VDA_AMP_TRACK', offset: 25, label: 'AMP TRACK', sysexName: 'AMP. KBD TRACK INT.', group: 'AMP KBD TRACK', codec: 's99', default: 0 },
  { id: 'VDA_AMP_VEL', offset: 26, label: 'AMP VEL', sysexName: 'AMP. VELOCITY SENSE', group: 'AMP VELOCITY', codec: 's99', default: 60 },
  { id: 'VDA_EGT_TRACK', offset: 27, label: 'EG TIME TRACK', sysexName: 'EG TIME KBD TRACK', group: 'AMP KBD TRACK', codec: 'u99', default: 0 },
  { id: 'VDA_EGT_VEL', offset: 28, label: 'EG TIME VEL', sysexName: 'EG TIME VEL. SENSE', group: 'AMP VELOCITY', codec: 'u99', default: 0 },

  // ---- VDA-n EG (92..98). SEVEN parameters — no release level. ------------------------
  { id: 'VDA_EG_AT', offset: 29, label: 'ATTACK TIME', sysexName: 'ATTACK TIME', group: 'AMP EG', codec: 'u99', default: 0 },
  { id: 'VDA_EG_AL', offset: 30, label: 'ATTACK LEVEL', sysexName: 'ATTACK LEVEL', group: 'AMP EG', codec: 'u99', default: 99 },
  { id: 'VDA_EG_DT', offset: 31, label: 'DECAY TIME', sysexName: 'DECAY TIME', group: 'AMP EG', codec: 'u99', default: 0 },
  { id: 'VDA_EG_BP', offset: 32, label: 'BREAK POINT', sysexName: 'BREAK POINT', group: 'AMP EG', codec: 'u99', default: 99 },
  { id: 'VDA_EG_ST', offset: 33, label: 'SLOPE TIME', sysexName: 'SLOPE TIME', group: 'AMP EG', codec: 'u99', default: 0 },
  { id: 'VDA_EG_SL', offset: 34, label: 'SUSTAIN LEVEL', sysexName: 'SUSTAIN LEVEL', group: 'AMP EG', codec: 'u99', default: 99 },
  { id: 'VDA_EG_RT', offset: 35, label: 'RELEASE TIME', sysexName: 'RELEASE TIME', group: 'AMP EG', codec: 'u99', default: 25 },

  // ---- 99..102: four bytes, sixteen three-state switches -------------------------------
  ...egSwPolBlock(36, 'VDF_EGT_TRACK', 'FILTER KBD TRACK', 'F. EG TIME K.T SW&POL'),
  ...egSwPolBlock(37, 'VDF_EGT_VEL', 'FILTER VELOCITY', 'F. EG TIME VEL. SW&POL'),
  ...egSwPolBlock(38, 'VDA_EGT_TRACK', 'AMP KBD TRACK', 'A. EG TIME K.T SW&POL'),
  ...egSwPolBlock(39, 'VDA_EGT_VEL', 'AMP VELOCITY', 'A. EG TIME VEL. SW&POL'),
];

/**
 * One SW&POL byte -> four three-state parameters, one per EG segment.
 *
 * bit0..3 are the ENABLE bits for attack/decay/slope/release and bit4..7 the matching
 * POLARITY bits (manual p.127 note *1). They are separate bits, which is precisely why
 * `'0'` is a real state rather than "positive with zero depth".
 */
function egSwPolBlock(
  relOffset: number,
  idPrefix: string,
  group: ParamGroup,
  sysexName: string,
): OscParamSpec[] {
  return EG_SEGMENTS.map((seg, i) => ({
    id: `${idPrefix}_${seg}`,
    offset: relOffset,
    bit: i,
    label: seg,
    sysexName: `${sysexName} (${seg})`,
    group,
    codec: 'swpol' as const,
    default: '0',
  }));
}

/**
 * Program-level parameters, bytes 10..37. Absolute offsets.
 *
 * Bytes 0-9 (name) and 38-62 (effects) are deliberately absent: the name lives in
 * `ProgramState.name` and the effect block is Phase 4's. Both are still covered by the
 * byte-accounting test, which is what keeps this table honest about the full 143.
 */
const COMMON_PARAMS: Omit<ProgramParamDef, 'osc'>[] = [
  { id: 'OSC_MODE', offset: 10, label: 'OSC MODE', sysexName: 'OSCILATOR MODE', group: 'OSC BASIC', codec: 'oscMode', default: 'SINGLE' },
  { id: 'ASSIGN', offset: 11, bit: 0, label: 'ASSIGN', sysexName: 'ASSIGN', group: 'OSC BASIC', codec: 'assign', default: 'POLY' },
  { id: 'HOLD', offset: 11, bit: 1, label: 'HOLD', sysexName: 'HOLD', group: 'OSC BASIC', codec: 'flag', default: 'OFF' },

  { id: 'OSC1_MULTISOUND', offset: 12, label: 'MULTISOUND', sysexName: 'OSC-1 MULTISOUND', group: 'OSC', codec: 'multisound', default: 6, notes: 'Default 6 = Organ2, the Phase 4 acceptance-test sound.' },
  { id: 'OSC1_OCTAVE', offset: 13, label: 'OCTAVE', sysexName: 'OSC-1 OCTAVE', group: 'OSC', codec: 'octave', default: "8'" },
  { id: 'OSC2_MULTISOUND', offset: 14, label: 'MULTISOUND', sysexName: 'OSC-2 MULTISOUND', group: 'OSC', codec: 'multisound', default: 6 },
  { id: 'OSC2_OCTAVE', offset: 15, label: 'OCTAVE', sysexName: 'OSC-2 OCTAVE', group: 'OSC', codec: 'octave', default: "8'" },
  { id: 'INTERVAL', offset: 16, label: 'INTERVAL', sysexName: 'INTERVAL', group: 'OSC', codec: 's12', default: 0, unit: 'semi' },
  { id: 'DETUNE', offset: 17, label: 'DETUNE', sysexName: 'DETUNE', group: 'OSC', codec: 's50', default: 0, unit: 'cent' },
  { id: 'DELAY_START', offset: 18, label: 'DELAY START', sysexName: 'DELAY START', group: 'OSC', codec: 'u99', default: 0, notes: 'Delays oscillator 2 only. Manual p.23.' },

  // ---- PITCH MG (19..22). Byte 19 packs four parameters. ------------------------------
  { id: 'PMG_WAVE', offset: 19, label: 'WAVEFORM', sysexName: 'PITCH MG WAVE FORM', group: 'PITCH MG', codec: 'mgWave', default: 'TRIANGLE' },
  { id: 'PMG_OSC1_ENABLE', offset: 19, bit: 5, label: 'OSC 1', sysexName: 'PITCH MG OSC-1 MG ENABLE', group: 'PITCH MG', codec: 'flag', default: 'OFF' },
  { id: 'PMG_OSC2_ENABLE', offset: 19, bit: 6, label: 'OSC 2', sysexName: 'PITCH MG OSC-2 MG ENABLE', group: 'PITCH MG', codec: 'flag', default: 'OFF' },
  { id: 'PMG_KEY_SYNC', offset: 19, bit: 7, label: 'KEY SYNC', sysexName: 'PITCH MG KEY SYNC', group: 'PITCH MG', codec: 'flag', default: 'OFF' },
  { id: 'PMG_FREQ', offset: 20, label: 'FREQUENCY', sysexName: 'PITCH MG FREQUENCY', group: 'PITCH MG', codec: 'u99', default: 30 },
  { id: 'PMG_DELAY', offset: 21, label: 'DELAY', sysexName: 'PITCH MG DELAY', group: 'PITCH MG', codec: 'u99', default: 0 },
  { id: 'PMG_INTENSITY', offset: 22, label: 'INTENSITY', sysexName: 'PITCH MG INTENSITY', group: 'PITCH MG', codec: 'u99', default: 0 },

  // ---- CUTOFF MG (23..26). Same shape, four parameters in byte 23. --------------------
  { id: 'FMG_WAVE', offset: 23, label: 'WAVEFORM', sysexName: 'CUTOFF MG WAVE FORM', group: 'FILTER MG', codec: 'mgWave', default: 'TRIANGLE' },
  { id: 'FMG_OSC1_ENABLE', offset: 23, bit: 5, label: 'OSC 1', sysexName: 'CUTOFF MG OSC-1 MG ENABLE', group: 'FILTER MG', codec: 'flag', default: 'OFF' },
  { id: 'FMG_OSC2_ENABLE', offset: 23, bit: 6, label: 'OSC 2', sysexName: 'CUTOFF MG OSC-2 MG ENABLE', group: 'FILTER MG', codec: 'flag', default: 'OFF' },
  { id: 'FMG_KEY_SYNC', offset: 23, bit: 7, label: 'KEY SYNC', sysexName: 'CUTOFF MG KEY SYNC', group: 'FILTER MG', codec: 'flag', default: 'OFF' },
  { id: 'FMG_FREQ', offset: 24, label: 'FREQUENCY', sysexName: 'CUTOFF MG FREQUENCY', group: 'FILTER MG', codec: 'u99', default: 30 },
  { id: 'FMG_DELAY', offset: 25, label: 'DELAY', sysexName: 'CUTOFF MG DELAY', group: 'FILTER MG', codec: 'u99', default: 0 },
  { id: 'FMG_INTENSITY', offset: 26, label: 'INTENSITY', sysexName: 'CUTOFF MG INTENSITY', group: 'FILTER MG', codec: 'u99', default: 0 },

  // ---- AFTER TOUCH (27..31) -----------------------------------------------------------
  { id: 'AT_PITCH', offset: 27, label: 'PITCH', sysexName: 'AFTER TOUCH PITCH', group: 'AFTER TOUCH', codec: 's12', default: 0, unit: 'semi' },
  { id: 'AT_PITCH_MG', offset: 28, label: 'PITCH MG', sysexName: 'AFTER TOUCH PITCH MG', group: 'AFTER TOUCH', codec: 'u99', default: 0 },
  { id: 'AT_VDF_CUTOFF', offset: 29, label: 'CUTOFF', sysexName: 'AFTER TOUCH VDF CUTOFF', group: 'AFTER TOUCH', codec: 's99', default: 0 },
  { id: 'AT_VDF_MG', offset: 30, label: 'FILTER MG', sysexName: 'AFTER TOUCH VDF MG', group: 'AFTER TOUCH', codec: 'u99', default: 0 },
  { id: 'AT_VDA_AMP', offset: 31, label: 'AMP', sysexName: 'AFTER TOUCH VDA AMPLITUDE', group: 'AFTER TOUCH', codec: 's99', default: 0 },

  // ---- JOY STICK (32..37) -------------------------------------------------------------
  { id: 'JS_PITCH_BEND', offset: 32, label: 'PITCH BEND', sysexName: 'JOY STICK PITCH BEND', group: 'JOY STICK', codec: 's12', default: 2, unit: 'semi' },
  { id: 'JS_VDF_SWEEP', offset: 33, label: 'FILTER SWEEP', sysexName: 'JOY STICK VDF SWEEP INT.', group: 'JOY STICK', codec: 's99', default: 0 },
  { id: 'JS_PITCH_MG_INT', offset: 34, label: 'PITCH MG INT', sysexName: 'JOY STICK PITCH MG INT.', group: 'JOY STICK', codec: 'u99', default: 0 },
  { id: 'JS_PITCH_MG_FREQ', offset: 35, label: 'PITCH MG FREQ', sysexName: 'JOY STICK PITCH MG FREQUENCY', group: 'JOY STICK', codec: 'u3', default: 0 },
  { id: 'JS_VDF_MG_INT', offset: 36, label: 'FILTER MG INT', sysexName: 'JOY STICK VDF MG INT.', group: 'JOY STICK', codec: 'u99', default: 0 },
  { id: 'JS_VDF_MG_FREQ', offset: 37, label: 'FILTER MG FREQ', sysexName: 'JOY STICK VDF MG FREQUENCY', group: 'JOY STICK', codec: 'u3', default: 0 },
];

/** Instantiate the per-oscillator block at its base offset. The `1`/`2` rule, as data. */
function oscBlock(osc: 1 | 2): ProgramParamDef[] {
  const base = osc === 1 ? OSC_BLOCK_BASE : OSC2_BLOCK_BASE;
  return OSC_BLOCK.map((p) => ({ ...p, id: `OSC${osc}_${p.id}`, offset: base + p.offset, osc }));
}

/** Every editable program parameter, in byte order within each block. */
export const PROGRAM_PARAMS: ProgramParamDef[] = [
  ...COMMON_PARAMS.map((p) => ({
    ...p,
    // OSC1_/OSC2_ prefixed common params (multisound, octave) belong to an oscillator for
    // the purpose of the panel's enable flag, even though their bytes sit in the common block.
    osc: p.id.startsWith('OSC1_') ? (1 as const) : p.id.startsWith('OSC2_') ? (2 as const) : null,
  })),
  ...oscBlock(1),
  ...oscBlock(2),
];

export const PROGRAM_PARAMS_BY_ID: ReadonlyMap<string, ProgramParamDef> = new Map(
  PROGRAM_PARAMS.map((p) => [p.id, p]),
);

export function programParam(id: string): ProgramParamDef {
  const p = PROGRAM_PARAMS_BY_ID.get(id);
  if (!p) throw new Error(`unknown program parameter '${id}'`);
  return p;
}

/**
 * Parameters that belong to oscillator 2 and therefore grey out in SINGLE mode.
 * UI-SPEC §4: one flag, off OSC MODE, drives every one of them.
 */
export function isOsc2Param(p: ProgramParamDef): boolean {
  return p.osc === 2;
}

// ---- byte <-> display value -------------------------------------------------------------

/** Two's complement of one byte, for the `9D~63` style signed ranges. */
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

/** Read one parameter's display value out of a raw 143-byte record. */
export function decodeParam(def: ProgramParamDef, record: Uint8Array): number | string {
  const byte = record[def.offset] ?? 0;
  switch (def.codec) {
    case 'u99':
    case 'u3':
    case 'key':
    case 'multisound':
      return clampInt(byte, CODECS[def.codec].min!, CODECS[def.codec].max!);
    case 's99':
    case 's12':
    case 's50':
      return clampInt(toSigned(byte), CODECS[def.codec].min!, CODECS[def.codec].max!);
    case 'octave':
      // FF~01 : 16'~4'. Signed -1..+1, so index into OCTAVE_POSITIONS by value + 1.
      return OCTAVE_POSITIONS[clampInt(toSigned(byte), -1, 1) + 1]!;
    case 'oscMode':
      return OSC_MODES[clampInt(byte, 0, OSC_MODES.length - 1)]!;
    case 'assign':
      return ASSIGN_POSITIONS[(byte >> (def.bit ?? 0)) & 1]!;
    case 'flag':
      return (byte >> (def.bit ?? 0)) & 1 ? 'ON' : 'OFF';
    case 'mgWave':
      return MG_WAVEFORMS[byte & 0b11]!;
    case 'swpol': {
      const b = def.bit ?? 0;
      const enabled = (byte >> b) & 1;
      if (!enabled) return '0'; // enable clear => genuinely off; polarity is irrelevant
      return (byte >> (b + 4)) & 1 ? '-' : '+';
    }
  }
}

/**
 * Write one parameter's display value into a raw record, preserving the other parameters
 * that share its byte. `record` is mutated.
 */
export function encodeParam(def: ProgramParamDef, value: number | string, record: Uint8Array): void {
  const prev = record[def.offset] ?? 0;
  const setBit = (bit: number, on: boolean): number =>
    on ? (record[def.offset] ?? 0) | (1 << bit) : (record[def.offset] ?? 0) & ~(1 << bit);

  switch (def.codec) {
    case 'u99':
    case 'u3':
    case 'key':
    case 'multisound':
      record[def.offset] = clampInt(Number(value), CODECS[def.codec].min!, CODECS[def.codec].max!);
      return;
    case 's99':
    case 's12':
    case 's50':
      record[def.offset] = fromSigned(
        clampInt(Number(value), CODECS[def.codec].min!, CODECS[def.codec].max!),
      );
      return;
    case 'octave': {
      const i = Math.max(0, OCTAVE_POSITIONS.indexOf(value as (typeof OCTAVE_POSITIONS)[number]));
      record[def.offset] = fromSigned(i - 1);
      return;
    }
    case 'oscMode':
      record[def.offset] = Math.max(0, OSC_MODES.indexOf(value as (typeof OSC_MODES)[number]));
      return;
    case 'assign':
      record[def.offset] = setBit(def.bit ?? 0, value === 'MONO');
      return;
    case 'flag':
      record[def.offset] = setBit(def.bit ?? 0, value === 'ON');
      return;
    case 'mgWave': {
      const i = Math.max(0, MG_WAVEFORMS.indexOf(value as (typeof MG_WAVEFORMS)[number]));
      record[def.offset] = (prev & ~0b11) | i;
      return;
    }
    case 'swpol': {
      const b = def.bit ?? 0;
      // Enable and polarity are separate bits. '0' clears the enable and LEAVES polarity
      // alone, which is what the hardware does — the polarity bit is simply not consulted.
      record[def.offset] = setBit(b, value !== '0');
      if (value !== '0') record[def.offset] = setBit(b + 4, value === '-');
      return;
    }
  }
}

/** The neutral program: every parameter at its default. */
export function defaultProgramParams(): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const p of PROGRAM_PARAMS) out[p.id] = p.default;
  return out;
}

/**
 * Heal a params bag: fill missing parameters from defaults, clamp numbers into range, and
 * replace any enumerated value that is not a legal position. Same contract as the
 * `coalesce*` functions in m1State — a loaded bundle is untrusted input.
 */
export function coalesceProgramParams(
  raw: Record<string, number | string> | undefined,
): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const p of PROGRAM_PARAMS) {
    const spec = CODECS[p.codec];
    const v = raw?.[p.id];
    if (spec.positions) {
      out[p.id] = typeof v === 'string' && spec.positions.includes(v) ? v : p.default;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[p.id] = clampInt(v, spec.min!, spec.max!);
    } else {
      out[p.id] = p.default;
    }
  }
  return out;
}

/** Encode a whole params bag into a 143-byte record. Bytes 0-9 and 38-62 are left at 0. */
export function encodeProgram(params: Record<string, number | string>): Uint8Array {
  const record = new Uint8Array(PROGRAM_RECORD_BYTES);
  const healed = coalesceProgramParams(params);
  for (const p of PROGRAM_PARAMS) encodeParam(p, healed[p.id]!, record);
  return record;
}

/** Decode a 143-byte record into a params bag. Phase 6's factory-bank importer. */
export function decodeProgram(record: Uint8Array): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const p of PROGRAM_PARAMS) out[p.id] = decodeParam(p, record);
  return out;
}

/** Program name from bytes 0..9, trimmed. */
export function decodeProgramName(record: Uint8Array): string {
  let s = '';
  for (let i = 0; i < PROGRAM_NAME_BYTES; i++) {
    const c = record[i] ?? 0x20;
    s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ' ';
  }
  return s.trim();
}

// ---- bridge to the shared ControlDef schema ---------------------------------------------

/**
 * Project a parameter onto `ControlDef`, so the panel's controls and the validator in
 * `data/schema.ts` see the same shapes SynthStack's module data used. The table above stays
 * the source of truth; this is a view of it.
 */
export function toControlDef(p: ProgramParamDef): ControlDef {
  const spec = CODECS[p.codec];
  if (spec.positions) {
    return {
      id: p.id,
      panelLabel: p.label,
      type: 'switch',
      positions: [...spec.positions],
      default: p.default,
      manualRef: "Owner's Manual p.127 (TABLE 1)",
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
    manualRef: "Owner's Manual p.127 (TABLE 1)",
    notes: p.notes,
  };
}

export const PROGRAM_CONTROL_DEFS: ControlDef[] = PROGRAM_PARAMS.map(toControlDef);
