/**
 * The MG (Modulation Generator) — PURE, no Web Audio types, Node-testable, DETERMINISTIC.
 *
 * Korg's name for the LFO. A Program has exactly TWO: one modulating pitch (bytes 19-22)
 * and one modulating filter cutoff (bytes 23-26). Both are PROGRAM-level, not per-
 * oscillator — the manual puts them in the common block and gives each one a pair of
 * per-oscillator ENABLE bits instead. That is why this file has no notion of which
 * oscillator it is driving: the caller gates the output.
 *
 * NO PRNG HERE, deliberately. The `RECTANGLE` waveform is the one place a lesser
 * implementation reaches for noise; it does not, so the signal path stays byte-exactly
 * reproducible and Phase 2's golden-buffer gate keeps working (CLAUDE.md).
 *
 * TWO UNDOCUMENTED CURVES, both labelled as CHOICES rather than M1 facts:
 *   - the frequency parameter 0..99 -> Hz mapping, and
 *   - the delay parameter 0..99 -> seconds mapping.
 * Korg published neither for the program MG. (The *effect* MG's grid IS documented, on
 * manual p.129, and is quantized quite differently — do not copy one onto the other.)
 */

/** MG waveforms, in the byte order of manual p.127 note *3. */
export const MG_TRIANGLE = 0;
export const MG_UP_SAW = 1;
export const MG_DOWN_SAW = 2;
export const MG_RECTANGLE = 3;

/**
 * Frequency parameter 0..99 -> Hz. A CHOICE, not an M1 fact.
 *
 * Exponential for the same reason the EG time curve is: the ear discriminates far better
 * at the slow end, where a pad's drift lives, than between 18 and 20 Hz.
 */
export const MG_FREQ_MIN_HZ = 0.05;
export const MG_FREQ_MAX_HZ = 30;

export function mgFreqToHz(v: number): number {
  const t = Math.min(99, Math.max(0, v)) / 99;
  return MG_FREQ_MIN_HZ * Math.pow(MG_FREQ_MAX_HZ / MG_FREQ_MIN_HZ, t);
}

/**
 * Delay parameter 0..99 -> seconds before the MG fades in. A CHOICE, not an M1 fact.
 * Linear to 3 s: this is a fade-in time a player dials by feel, and a linear control is
 * what makes "half way" mean "half as long".
 */
export const MG_DELAY_MAX_S = 3;

export function mgDelayToSeconds(v: number): number {
  return (Math.min(99, Math.max(0, v)) / 99) * MG_DELAY_MAX_S;
}

export interface MgConfig {
  /** One of the MG_* constants. */
  waveform: number;
  freqHz: number;
  /** Seconds of silence, then a fade-in of the same length, before full depth. */
  delayS: number;
  /** 0..1. The caller multiplies this by its own per-destination depth. */
  intensity: number;
  /** Restart the phase on every note-on. OFF = the MG free-runs across notes. */
  keySync: boolean;
}

export interface MgState {
  /** 0..1. */
  phase: number;
  /** Seconds since the note that started this MG. */
  elapsed: number;
}

export function makeMgState(): MgState {
  return { phase: 0, elapsed: 0 };
}

/** An MG that contributes nothing. Zero intensity, so the waveform never reaches the signal. */
export function neutralMgConfig(): MgConfig {
  return { waveform: MG_TRIANGLE, freqHz: 1, delayS: 0, intensity: 0, keySync: false };
}

export function mgNoteOn(st: MgState, cfg: MgConfig): void {
  st.elapsed = 0;
  // KEY SYNC off means the MG free-runs — the phase is deliberately NOT reset, so two notes
  // held together share one modulation phase and beat with each other exactly as the
  // hardware's single shared generator does.
  if (cfg.keySync) st.phase = 0;
}

/** Waveform value at phase 0..1, in -1..1. */
export function mgWaveform(waveform: number, phase: number): number {
  const p = phase - Math.floor(phase);
  switch (waveform) {
    case MG_UP_SAW:
      return 2 * p - 1;
    case MG_DOWN_SAW:
      return 1 - 2 * p;
    case MG_RECTANGLE:
      return p < 0.5 ? 1 : -1;
    case MG_TRIANGLE:
    default:
      // Starts at 0 and rises, so a note with DELAY 0 begins un-modulated rather than at
      // full swing — which is what stops key-synced vibrato from clicking the pitch on
      // every note-on.
      return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
  }
}

/**
 * The delay envelope: silent for `delayS`, then fading in over the same span again.
 * Returns 0..1.
 *
 * A hard switch-on at the end of the delay would step the pitch, which is audible as a
 * click on exactly the slow vibrato this parameter exists to create.
 */
export function mgDelayEnvelope(elapsed: number, delayS: number): number {
  if (delayS <= 0) return 1;
  if (elapsed <= delayS) return 0;
  return Math.min(1, (elapsed - delayS) / delayS);
}

/**
 * Advance by `dt` seconds and return the modulation value, already scaled by intensity and
 * the delay envelope. Range -1..1.
 *
 * `freqScale` multiplies the rate for this block. It exists because the joystick can speed
 * the MG up (bytes 35 and 37, `JOY STICK PITCH/VDF MG FREQUENCY`) — scaling the rate here
 * rather than rebuilding the config keeps the phase continuous, so pushing the stick
 * changes the vibrato speed without jumping the waveform.
 */
export function mgProcess(st: MgState, cfg: MgConfig, dt: number, freqScale = 1): number {
  st.elapsed += dt;
  st.phase += cfg.freqHz * Math.max(0, freqScale) * dt;
  // Wrap rather than letting the phase grow without bound: at 30 Hz a phase accumulator
  // left running for an hour loses float precision exactly where the waveform is steepest.
  if (st.phase >= 1 || st.phase < 0) st.phase -= Math.floor(st.phase);
  return mgWaveform(cfg.waveform, st.phase) * cfg.intensity * mgDelayEnvelope(st.elapsed, cfg.delayS);
}
