/**
 * The M1's modulation rules — PURE, no Web Audio types, Node-testable, DETERMINISTIC.
 *
 * These are the small signed maps that sit between a raw program byte and the DSP: how
 * velocity scales amplitude, how key position scales amplitude and envelope speed, and how
 * the per-segment EG-time switches work. They live together because they share one trap.
 *
 * THE TRAP, and it is asymmetric — do not "tidy" it into consistency:
 *
 *   - VDF **cutoff** keyboard tracking of 0 means **100% tracking** (manual p.27: "The
 *     change of Cutoff and the change of pitch are equal when set to 0"). That one lives in
 *     `lowpassCore.keyboardTrackingRatio`.
 *   - **EG-time** keyboard tracking and velocity of 0 genuinely ARE off, because the enable
 *     lives in a separate bit from the polarity (manual p.127 note *1, and p.26/p.27: "with
 *     0 having no effect"). That one is `egTimeScale` below.
 *
 * Two parameters that read almost identically on a panel, with opposite meanings at zero.
 */

/** The three states of every EG-time switch. Bytes 99-102, four per byte. */
export type SwPol = '-' | '0' | '+';

/** Segment order within each SW&POL byte. Manual p.127 note *1: bit0..3. */
export const EG_SEGMENT_COUNT = 4;
export const SEG_ATTACK = 0;
export const SEG_DECAY = 1;
export const SEG_SLOPE = 2;
export const SEG_RELEASE = 3;

/**
 * Full-scale EG-time modulation range, in octaves of time. A CHOICE, not an M1 fact —
 * Korg documents the direction and that 0 is off, never the depth. Two octaves means a
 * fully-modulated segment runs at most 4x faster or 4x slower.
 */
export const EG_TIME_MOD_OCTAVES = 2;

export interface EgTimeMod {
  /** 0..1, from the EG TIME KBD TRACK / EG TIME VEL. SENSE amount byte. */
  amount: number;
  /** Per-segment switch, in bit order: attack, decay, slope, release. */
  segments: readonly [SwPol, SwPol, SwPol, SwPol];
}

export function noEgTimeMod(): EgTimeMod {
  return { amount: 0, segments: ['0', '0', '0', '0'] };
}

/**
 * Time multiplier for one EG segment. `delta` is a signed -1..1 position (how hard the key
 * was hit, or how far above the centre key it sits).
 *
 * Direction, verbatim from manual p.26: "When set to positive ('+'), the stronger the key
 * is hit the shorter the time of the EG... The time becomes longer when set to '-'." So a
 * positive switch with a positive delta must return a multiplier BELOW 1.
 *
 * Returns exactly 1 when the switch is '0', whatever the amount — the enable bit is clear
 * and the hardware simply does not consult the rest.
 */
export function egTimeScale(mod: EgTimeMod, segment: number, delta: number): number {
  const sw = mod.segments[segment];
  if (sw === undefined || sw === '0') return 1;
  const sign = sw === '+' ? 1 : -1;
  const amount = Math.min(1, Math.max(0, mod.amount));
  const d = Math.min(1, Math.max(-1, delta));
  return Math.pow(2, -sign * amount * d * EG_TIME_MOD_OCTAVES);
}

/** Velocity 1..127 -> a signed -1..1 position, centred on the MIDI half-way point. */
export function velocityDelta(velocity: number): number {
  return Math.min(1, Math.max(-1, (velocity - 64) / 63));
}

/**
 * Key position relative to the program's CENTRE KEY -> a signed -1..1 position.
 *
 * The centre key is a real parameter (bytes 72 and 87), not a constant: manual p.27 calls
 * it "the key for which cutoff/EG time does not change". Five octaves either side reaches
 * full depth, which spans the 88-key bed from any sensible centre.
 */
export const KEY_TRACK_SPAN_SEMITONES = 60;

export function keyDelta(note: number, centerKey: number): number {
  return Math.min(1, Math.max(-1, (note - centerKey) / KEY_TRACK_SPAN_SEMITONES));
}

/**
 * AMP velocity sensitivity — SIGNED, -1..1 (byte 89 is `9D~63 : -99~99`).
 *
 * The sign is load-bearing and not decoration: a DOUBLE-mode program with OPPOSITE-SIGNED
 * sensitivities on its two oscillators is how the M1 does a continuous velocity crossfade,
 * which is the only velocity layering it has (a multisound contains no velocity zones).
 * Modelling this as unsigned would silently delete that whole technique.
 *
 * Positive: quiet when played softly. Negative: quiet when played hard. Returns 0..1.
 */
export function ampVelocityGain(sensitivity: number, velocity: number): number {
  const amt = Math.min(1, Math.max(-1, sensitivity));
  const norm = Math.min(1, Math.max(0, velocity / 127));
  return amt >= 0 ? 1 - amt * (1 - norm) : 1 + amt * norm;
}

/**
 * AMP keyboard tracking (byte 88, signed) -> a gain multiplier.
 *
 * Positive makes the top of the keyboard louder, negative the bottom. A CHOICE of depth:
 * full amount is one octave of gain across the tracking span. Unlike cutoff tracking, 0
 * here really is off — this byte has no enable bit and the manual gives it no special case.
 */
export function ampTrackingGain(amount: number, note: number, centerKey: number): number {
  if (amount === 0) return 1;
  const amt = Math.min(1, Math.max(-1, amount));
  return Math.pow(2, amt * keyDelta(note, centerKey));
}

/**
 * Scale a signed sensitivity by velocity, for the depth-style parameters: VDF EG INTENSITY
 * VEL. SENSE (byte 77) and the pitch EG's LEVEL VELOCITY SENSE (byte 70).
 *
 * Returns a signed amount added to the base depth. Positive sensitivity adds depth as
 * velocity rises above the centre and removes it below, so playing at the centre velocity
 * reproduces the programmed value exactly — "(The set value by EG intensity is the norm.)",
 * manual p.26.
 */
export function velocityDepth(sensitivity: number, velocity: number): number {
  return Math.min(1, Math.max(-1, sensitivity)) * velocityDelta(velocity);
}

/**
 * OSC-2 DELAY START (byte 18, 0..99) -> seconds. A CHOICE, not an M1 fact.
 *
 * Linear to one second. The manual (p.23) only says it is "the time it takes between the
 * onset of the sound of Oscillator 1 and the start of Oscillator 2"; a linear control is
 * the honest default for a delay a player sets by ear against an attack transient, which
 * is what this parameter is for (attack transients are separate multisounds on the M1,
 * layered with DOUBLE plus this delay — never concatenated onto a loop body).
 */
export const DELAY_START_MAX_S = 1;

export function delayStartToSeconds(v: number): number {
  return (Math.min(99, Math.max(0, v)) / 99) * DELAY_START_MAX_S;
}
