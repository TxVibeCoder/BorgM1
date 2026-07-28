/**
 * Program parameters -> engine configuration. PURE, no Web Audio types, Node-testable.
 *
 * This is the seam Phase 3 exists to build: `data/programParams.ts` says what the 143 bytes
 * MEAN, `voiceEngineCore.ts` says what the engine NEEDS, and this file is the one place
 * that maps between them. It replaces the flat placeholder `neutralOsc` that Phase 2 built
 * inline in `engineBridge.ts` — the engine's interface is unchanged, it is simply being fed
 * real values now.
 *
 * The oscillator's SAMPLES are injected rather than looked up, because the bank is an impure
 * dependency (Cache API, transferred buffers) and this file has to stay Node-testable.
 *
 * SEVERAL CURVES HERE ARE UNDOCUMENTED, and are labelled as CHOICES at each definition
 * rather than silently baked in: the cutoff 0..99 -> Hz map, the pitch EG's level scaling,
 * and the MG and delay-start curves imported from their own cores. Korg published a range
 * for each parameter and nothing about its taper. Mark them, so a later session tuning
 * against the Phase 4 A/B knows exactly which numbers are fair game.
 */

import {
  coalesceProgramParams,
  MG_WAVEFORMS,
  OCTAVE_POSITIONS,
  OSC_MODES,
} from '../../../data/programParams';
import {
  ampEgConfig,
  filterEgConfig,
  pitchEgConfig,
  PITCH_EG_MAX_SEMITONES,
} from '../dsp/levelTimeEgCore';
import { mgDelayToSeconds, mgFreqToHz, type MgConfig } from '../dsp/mgCore';
import { delayStartToSeconds, type EgTimeMod, type SwPol } from '../dsp/modCore';
import type {
  BankSampleRef,
  ControllerConfig,
  OscConfig,
  OscMode,
  ProgramConfig,
} from '../voice/voiceEngineCore';

/**
 * What the bank supplies per oscillator. Injected so this file stays pure.
 *
 * GENERIC IN THE SAMPLE TYPE, and that is not over-engineering — the two callers genuinely
 * hold different things. The bridge has already TRANSFERRED the PCM to the worklet, so on
 * the main thread a sample is an offset into a buffer it no longer owns
 * (`SerializedSample`); inside the worklet it is a live `Float32Array` view
 * (`BankSampleRef`). Making this generic lets one mapping serve both without either side
 * casting, which is what stops a field being silently dropped in transit.
 */
export interface OscSource<S = BankSampleRef> {
  keymap: Uint16Array;
  samples: S[];
}

/** An oscillator config carrying whichever sample representation the caller holds. */
export type OscConfigOf<S> = Omit<OscConfig, 'samples'> & { samples: S[] };
export type ProgramConfigOf<S> = Omit<ProgramConfig, 'osc'> & {
  osc: [OscConfigOf<S>, OscConfigOf<S>];
};

/**
 * VDF CUTOFF VALUE 0..99 -> Hz. A CHOICE, not an M1 fact.
 *
 * Exponential, because pitch is: a linear cutoff control spends three quarters of its travel
 * in the top octave, where nothing happens. The top of the range must be genuinely open —
 * at 99 the filter has to be effectively out of circuit, or the Phase 4 fidelity gate
 * (whose patch has a flat filter) measures this curve instead of the sample.
 */
export const CUTOFF_MIN_HZ = 30;
export const CUTOFF_MAX_HZ = 18000;

export function cutoffValueToHz(v: number): number {
  const t = Math.min(99, Math.max(0, v)) / 99;
  return CUTOFF_MIN_HZ * Math.pow(CUTOFF_MAX_HZ / CUTOFF_MIN_HZ, t);
}

/** 0..99 -> 0..1. The unsigned depth parameters. */
function unit(v: number): number {
  return Math.min(1, Math.max(0, v / 99));
}

/** -99..99 -> -1..1. The signed depth parameters. */
function signedUnit(v: number): number {
  return Math.min(1, Math.max(-1, v / 99));
}

type Params = Record<string, number | string>;

function num(p: Params, id: string): number {
  const v = p[id];
  return typeof v === 'number' ? v : 0;
}

function text(p: Params, id: string): string {
  const v = p[id];
  return typeof v === 'string' ? v : '';
}

/** Gather one SW&POL byte's four switches plus its amount byte into an EgTimeMod. */
function egTimeMod(p: Params, amountId: string): EgTimeMod {
  const seg = (name: string): SwPol => (text(p, `${amountId}_${name}`) || '0') as SwPol;
  return {
    amount: unit(num(p, amountId)),
    segments: [seg('ATTACK'), seg('DECAY'), seg('SLOPE'), seg('RELEASE')],
  };
}

/** `16'`/`8'`/`4'` -> -1/0/+1, the byte's own FF~01 encoding. */
function octaveOf(p: Params, id: string): number {
  const i = OCTAVE_POSITIONS.indexOf(text(p, id) as (typeof OCTAVE_POSITIONS)[number]);
  return (i < 0 ? 1 : i) - 1;
}

function mgConfigOf(p: Params, prefix: 'PMG' | 'FMG'): MgConfig {
  const wave = MG_WAVEFORMS.indexOf(
    text(p, `${prefix}_WAVE`) as (typeof MG_WAVEFORMS)[number],
  );
  return {
    waveform: wave < 0 ? 0 : wave,
    freqHz: mgFreqToHz(num(p, `${prefix}_FREQ`)),
    delayS: mgDelayToSeconds(num(p, `${prefix}_DELAY`)),
    intensity: unit(num(p, `${prefix}_INTENSITY`)),
    keySync: text(p, `${prefix}_KEY_SYNC`) === 'ON',
  };
}

function controllersOf(p: Params): ControllerConfig {
  return {
    atPitch: num(p, 'AT_PITCH'),
    atPitchMg: unit(num(p, 'AT_PITCH_MG')),
    atCutoff: signedUnit(num(p, 'AT_VDF_CUTOFF')),
    atCutoffMg: unit(num(p, 'AT_VDF_MG')),
    atAmp: signedUnit(num(p, 'AT_VDA_AMP')),
    jsPitchBend: num(p, 'JS_PITCH_BEND'),
    jsCutoffSweep: signedUnit(num(p, 'JS_VDF_SWEEP')),
    jsPitchMgInt: unit(num(p, 'JS_PITCH_MG_INT')),
    jsCutoffMgInt: unit(num(p, 'JS_VDF_MG_INT')),
    // RAW 0..3, not normalized: the byte is a small integer count of how much faster the
    // stick drives the MG, and the engine multiplies the rate by 1 + depth * this.
    jsPitchMgFreq: num(p, 'JS_PITCH_MG_FREQ'),
    jsCutoffMgFreq: num(p, 'JS_VDF_MG_FREQ'),
  };
}

/**
 * Build one oscillator's config from the half of the parameter model that belongs to it.
 *
 * THE `1`/`2` RULE, at the engine boundary: this function is called twice with `osc` 1 and
 * 2 and differs only in the id prefix, exactly as the panel instantiates one component
 * twice. Anything that reads `osc` for a reason other than choosing the prefix is a place
 * the two halves can drift, so there are only two: INTERVAL and DETUNE are relative to
 * oscillator 1 and therefore meaningless on it, and DELAY START only delays oscillator 2.
 */
export function buildOscConfig<S>(
  params: Params,
  osc: 1 | 2,
  source: OscSource<S>,
): OscConfigOf<S> {
  const p = params;
  const k = (id: string) => `OSC${osc}_${id}`;

  return {
    keymap: source.keymap,
    samples: source.samples,
    level: unit(num(p, k('VDA_LEVEL'))),
    octave: octaveOf(p, k('OCTAVE')),
    interval: osc === 2 ? num(p, 'INTERVAL') : 0,
    detune: osc === 2 ? num(p, 'DETUNE') : 0,

    ampEg: ampEgConfig({
      attackTime: num(p, k('VDA_EG_AT')),
      attackLevel: unit(num(p, k('VDA_EG_AL'))),
      decayTime: num(p, k('VDA_EG_DT')),
      breakPoint: unit(num(p, k('VDA_EG_BP'))),
      slopeTime: num(p, k('VDA_EG_ST')),
      sustainLevel: unit(num(p, k('VDA_EG_SL'))),
      releaseTime: num(p, k('VDA_EG_RT')),
    }),
    filterEg: filterEgConfig({
      attackTime: num(p, k('VDF_EG_AT')),
      attackLevel: signedUnit(num(p, k('VDF_EG_AL'))),
      decayTime: num(p, k('VDF_EG_DT')),
      breakPoint: signedUnit(num(p, k('VDF_EG_BP'))),
      slopeTime: num(p, k('VDF_EG_ST')),
      sustainLevel: signedUnit(num(p, k('VDF_EG_SL'))),
      releaseTime: num(p, k('VDF_EG_RT')),
      // The filter EG releases to a LEVEL and the amp EG does not. That asymmetry is the
      // whole reason UI-SPEC asks for two EG graph components, and it is visible right here
      // as the parameter the ampEgConfig call above simply does not have.
      releaseLevel: signedUnit(num(p, k('VDF_EG_RL'))),
    }),
    pitchEg: pitchEgConfig({
      // Pitch EG levels are semitones, clamped to +/-1 octave by pitchEgConfig itself.
      startLevel: signedUnit(num(p, k('PEG_START'))) * PITCH_EG_MAX_SEMITONES,
      attackTime: num(p, k('PEG_AT')),
      attackLevel: signedUnit(num(p, k('PEG_AL'))) * PITCH_EG_MAX_SEMITONES,
      decayTime: num(p, k('PEG_DT')),
      releaseTime: num(p, k('PEG_RT')),
      releaseLevel: signedUnit(num(p, k('PEG_RL'))) * PITCH_EG_MAX_SEMITONES,
    }),

    cutoffHz: cutoffValueToHz(num(p, k('VDF_CUTOFF'))),
    egIntensity: unit(num(p, k('VDF_EG_INT'))),
    // RAW, not normalized: 0 means 100% tracking, so dividing by 99 here would be harmless
    // but scaling or re-centring it would silently change every patch. lowpassCore owns
    // the interpretation; this hands the hardware value straight through.
    cutoffTracking: num(p, k('VDF_CUTOFF_TRACK')),
    cutoffCenterKey: num(p, k('VDF_TRACK_CENTER')),

    ampVelocity: signedUnit(num(p, k('VDA_AMP_VEL'))),
    ampTracking: signedUnit(num(p, k('VDA_AMP_TRACK'))),
    ampCenterKey: num(p, k('VDA_TRACK_CENTER')),
    egIntensityVelocity: signedUnit(num(p, k('VDF_EGI_VEL'))),

    filterEgTimeTrack: egTimeMod(p, k('VDF_EGT_TRACK')),
    filterEgTimeVel: egTimeMod(p, k('VDF_EGT_VEL')),
    ampEgTimeTrack: egTimeMod(p, k('VDA_EGT_TRACK')),
    ampEgTimeVel: egTimeMod(p, k('VDA_EGT_VEL')),

    pitchEgTimeVelocity: signedUnit(num(p, k('PEG_TIME_VEL'))),
    pitchEgLevelVelocity: signedUnit(num(p, k('PEG_LEVEL_VEL'))),

    startDelayS: osc === 2 ? delayStartToSeconds(num(p, 'DELAY_START')) : 0,

    pitchMgEnable: text(p, `PMG_OSC${osc}_ENABLE`) === 'ON',
    cutoffMgEnable: text(p, `FMG_OSC${osc}_ENABLE`) === 'ON',
  };
}

/**
 * Build the whole engine configuration from a params bag.
 *
 * The bag is COALESCED first, so a partial or hand-edited program cannot reach the engine
 * with a missing or out-of-range value. Same contract as `m1State`'s coalesce functions: a
 * loaded bundle is untrusted input, and this is the last place to say so.
 */
export function buildProgramConfig<S = BankSampleRef>(
  params: Params,
  sources: [OscSource<S>, OscSource<S>],
  options: { resonance?: number } = {},
): ProgramConfigOf<S> {
  const p = coalesceProgramParams(params);
  const mode = text(p, 'OSC_MODE');
  const oscMode: OscMode = (OSC_MODES as readonly string[]).includes(mode)
    ? (mode as OscMode)
    : 'SINGLE';

  return {
    oscMode,
    osc: [buildOscConfig(p, 1, sources[0]), buildOscConfig(p, 2, sources[1])],
    // The resonance EXTENSION. Not a program parameter — the 1988 filter has no Q — so it
    // arrives from the extensions slice of the state tree and defaults to 0 (CLAUDE.md).
    resonance: Math.min(1, Math.max(0, options.resonance ?? 0)),
    pitchMg: mgConfigOf(p, 'PMG'),
    cutoffMg: mgConfigOf(p, 'FMG'),
    controllers: controllersOf(p),
    mono: text(p, 'ASSIGN') === 'MONO',
    hold: text(p, 'HOLD') === 'ON',
  };
}
