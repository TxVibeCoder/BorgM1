/**
 * The main-thread <-> worklet message shapes. Shared by the bridge and the processor so
 * the two cannot drift — a mismatched field here is a silent wrong note, not a type error
 * at the boundary, because `postMessage` structurally clones whatever it is given.
 */

import type { EgConfig } from './dsp/levelTimeEgCore';
import type { OscMode } from './voice/voiceEngineCore';

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

export interface SerializedOsc {
  /** 128x128 lookup. Transferable, so a program change costs one 32 KB move per oscillator. */
  keymap: Uint16Array;
  samples: SerializedSample[];
  level: number;
  octave: number;
  interval: number;
  detune: number;
  ampEg: EgConfig;
  filterEg: EgConfig;
  pitchEg: EgConfig;
  cutoffHz: number;
  egIntensity: number;
  cutoffTracking: number;
  velocitySensitivity: number;
}

export interface SerializedProgram {
  oscMode: OscMode;
  resonance: number;
  osc: [SerializedOsc, SerializedOsc];
}
