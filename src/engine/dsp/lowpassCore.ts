/**
 * The filter (VDF) — PURE, no Web Audio types, Node-testable.
 *
 * NON-RESONANT BY DESIGN. The 1988 hardware's filter has no resonance control — confirmed
 * three separate ways, and the reason the reference plugin ships a `RESONANCE` switch at
 * all is precisely that the hardware lacked one. Resonance here is a switchable EXTENSION
 * that DEFAULTS OFF (CLAUDE.md), and the Phase 4 fidelity gate must pass with it off.
 *
 * SLOPE IS UNDOCUMENTED. Korg never published it. 12 dB/oct is a DESIGN CHOICE, not a
 * measurement — label it as such wherever fidelity is discussed. `stages` cascades whole
 * SVFs for 24 dB/oct and beyond, so the choice can be revisited against the Phase 4 A/B
 * rather than argued about in the abstract.
 *
 * TPT STATE-VARIABLE, not a cascade of one-poles. Two reasons:
 *
 *   1. Modulation. The cutoff is moved at block rate by the filter EG and keyboard
 *      tracking. A direct-form filter's state has no physical meaning, so changing
 *      coefficients mid-note produces a transient heard as a zipper; a TPT structure's
 *      state IS the integrator value and stays continuous under modulation.
 *   2. Resonance actually works. A cascade of one-poles with global negative feedback
 *      CANNOT produce a resonant peak at two poles — the loop needs 180 degrees of phase
 *      shift, which takes four. The first version of this file did exactly that and the
 *      "resonance" control only ever attenuated. An SVF resonates correctly at 12 dB/oct.
 */

/** Cascaded SVF stages. 1 stage = 12 dB/oct. A CHOICE — the hardware's slope is unknown. */
export const DEFAULT_STAGES = 1;

/** Cutoff is clamped into this band before use, in Hz. */
export const MIN_CUTOFF_HZ = 20;

/**
 * Damping with resonance fully off. k = 2 is Q = 0.5, critically damped: the magnitude
 * response falls monotonically with NO peak anywhere, which is what "non-resonant" has to
 * mean for the fidelity gate to be meaningful.
 */
export const K_NO_RESONANCE = 2;
/** Damping at maximum resonance. Above zero so the filter cannot self-oscillate. */
export const K_MAX_RESONANCE = 0.12;

export interface LowpassState {
  /** Two integrator states per SVF stage. */
  ic1: Float64Array;
  ic2: Float64Array;
}

export function makeLowpassState(stages = DEFAULT_STAGES): LowpassState {
  return { ic1: new Float64Array(stages), ic2: new Float64Array(stages) };
}

export function resetLowpass(st: LowpassState): void {
  st.ic1.fill(0);
  st.ic2.fill(0);
}

/**
 * Per-sample `g` coefficient from a cutoff in Hz.
 *
 * The cutoff is clamped to just below Nyquist. `tan` diverges as its argument approaches
 * pi/2, so an un-clamped cutoff at or above Nyquist produces an infinite coefficient and
 * silences the voice permanently — and a filter EG with a high intensity WILL push the
 * cutoff there on a high note.
 */
export function cutoffCoefficient(cutoffHz: number, sampleRate: number): number {
  const nyquist = sampleRate * 0.5;
  const fc = Math.min(nyquist * 0.49, Math.max(MIN_CUTOFF_HZ, cutoffHz));
  return Math.tan((Math.PI * fc) / sampleRate);
}

/** Map the 0..1 resonance EXTENSION onto the SVF's damping term. 0 => no peak at all. */
export function resonanceToK(resonance: number): number {
  const r = Math.min(1, Math.max(0, resonance));
  return K_NO_RESONANCE + r * (K_MAX_RESONANCE - K_NO_RESONANCE);
}

/** One sample through one TPT SVF stage, lowpass output. */
function svfStage(st: LowpassState, i: number, x: number, g: number, k: number): number {
  const a1 = 1 / (1 + g * (g + k));
  const a2 = g * a1;
  const a3 = g * a2;
  const ic1 = st.ic1[i]!;
  const ic2 = st.ic2[i]!;
  const v3 = x - ic2;
  const v1 = a1 * ic1 + a2 * v3;
  const v2 = ic2 + a2 * ic1 + a3 * v3;
  st.ic1[i] = 2 * v1 - ic1;
  st.ic2[i] = 2 * v2 - ic2;
  return v2;
}

/**
 * Process one sample through the cascade.
 *
 * `resonance` is the EXTENSION: 0 gives k = 2, a monotonic response with no peak, which is
 * the signal path the non-resonant hardware had.
 */
export function processSample(
  st: LowpassState,
  x: number,
  g: number,
  resonance = 0,
): number {
  const k = resonanceToK(resonance);
  let v = x;
  for (let i = 0; i < st.ic1.length; i++) v = svfStage(st, i, v, g, k);
  return v;
}

/**
 * Process a block with the coefficient interpolated across it.
 *
 * The cutoff moves per block, not per sample, but stepping it at block boundaries is
 * audible as a staircase whenever the filter EG is fast — the same defect the sample
 * player's increment interpolation exists to avoid, in a different parameter.
 */
export function processBlock(
  st: LowpassState,
  buf: Float32Array,
  offset: number,
  count: number,
  gStart: number,
  gEnd: number,
  resonance = 0,
): void {
  const k = resonanceToK(resonance);
  const step = count > 1 ? (gEnd - gStart) / count : 0;
  let g = gStart;
  for (let n = 0; n < count; n++) {
    let v = buf[offset + n]!;
    for (let i = 0; i < st.ic1.length; i++) v = svfStage(st, i, v, g, k);
    buf[offset + n] = v;
    g += step;
  }
}

/**
 * VDF cutoff keyboard tracking.
 *
 * THE TRAP: a tracking value of 0 means **100% tracking** — the cutoff follows pitch 1:1.
 * NEGATIVE values are what give you no tracking. This silently affects every patch, and
 * it is asymmetric with the EG-time tracking, where 0 genuinely is off.
 *
 * `tracking` is the raw hardware parameter. Returns a multiplier on the base cutoff.
 */
export function keyboardTrackingRatio(tracking: number, note: number, centerNote = 60): number {
  // 0 -> 1.0 (full tracking), -99 -> 0.0 (none), +99 -> 2.0 (exaggerated)
  const amount = 1 + tracking / 99;
  const semitones = (note - centerNote) * amount;
  return Math.pow(2, semitones / 12);
}
