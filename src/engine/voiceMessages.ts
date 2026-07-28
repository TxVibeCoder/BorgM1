/**
 * The main-thread <-> worklet message shapes. Shared by the bridge and the processor so
 * the two cannot drift — a mismatched field here is a silent wrong note, not a type error
 * at the boundary, because `postMessage` structurally clones whatever it is given.
 *
 * DERIVED FROM THE ENGINE'S OWN TYPES, deliberately. Phase 2 restated every OscConfig field
 * here by hand, which meant Phase 3 could add a parameter to the engine, wire it in the
 * bridge, and have it silently dropped in transit with nothing failing to compile. Building
 * these as `Omit<..., 'samples'>` makes that a type error instead: the only field the wire
 * format is allowed to disagree about is the one that genuinely differs, because a
 * transferred buffer cannot carry a Float32Array view.
 */

import type { ControllerConfig, OscConfig, OscMode, ProgramConfig } from './voice/voiceEngineCore';
import type { MgConfig } from './dsp/mgCore';

/** One sample, addressed as a window into the transferred bank blob. */
export interface SerializedSample {
  /** Offset in SAMPLES (not bytes) into the bank's float array. */
  offset: number;
  length: number;
  loopStart: number;
  loopEnd: number;
  rootKey: number;
  fineCents: number;
  sampleRate: number;
}

/**
 * An oscillator on the wire: every engine field except `samples`, which travels as offsets
 * into the transferred PCM blob and is rehydrated into views on the far side.
 *
 * `keymap` stays a Uint16Array — it is transferable, so a program change costs one 32 KB
 * move per oscillator rather than a copy.
 */
export type SerializedOsc = Omit<OscConfig, 'samples'> & { samples: SerializedSample[] };

export type SerializedProgram = Omit<ProgramConfig, 'osc'> & {
  osc: [SerializedOsc, SerializedOsc];
};

export type { ControllerConfig, MgConfig, OscMode };
