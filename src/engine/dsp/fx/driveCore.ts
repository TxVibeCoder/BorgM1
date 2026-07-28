/**
 * Overdrive, Distortion and Exciter — algorithms 21, 22, 23. PURE, Node-testable.
 *
 * OVERDRIVE AND DISTORTION ARE MONO-SUM IN, STEREO OUT (BRIEF.md). That is worth stating
 * because it is counter-intuitive: a distortion box is normally per-channel, and summing
 * first is what makes the M1's overdrive collapse the image the way it does.
 *
 * THE TWO ARE NOT THE SAME CURVE AT DIFFERENT GAINS. The manual distinguishes them —
 * Distortion has "a dirtier harder edge than overdrive" — and their parameter sets differ in
 * a way that confirms it: Over Drive carries a full mid band plus both EQ shelves, Distortion
 * carries EQ LOW only. Three parameters, and the missing EQ HIGH is real: p.129 and the
 * default-values chart independently list Low alone.
 *
 * BOTH TRANSFER CURVES ARE CHOICES. Korg published a `Drive 0-99` range and nothing else.
 */

import { Biquad, EffectEq } from './eqCore';
import { OnePole, dbToGain, signed99, unit99 } from './primitivesCore';

/** Peak input gain at `DRIVE` 99. A CHOICE — sets how hard the curve is pushed. */
const OVERDRIVE_MAX_GAIN = 40;
/** The same for Distortion, which is meant to be dirtier. A CHOICE. */
const DISTORTION_MAX_GAIN = 120;

/**
 * Soft asymmetric saturation — the overdrive curve. A CHOICE.
 *
 * `tanh` alone is symmetric and therefore generates odd harmonics only, which reads as
 * "fuzzy" rather than "driven". Adding a small even-order term by biasing the input gives
 * the second harmonic that makes a valve-ish overdrive sound like one.
 */
export function overdriveCurve(x: number): number {
  const biased = x + 0.12;
  return Math.tanh(biased) - Math.tanh(0.12);
}

/**
 * Hard-knee clipping with a rounded corner — the distortion curve. A CHOICE.
 *
 * Clipping outright would alias badly on a sampled source; this keeps a short cubic knee so
 * the corner is band-limited enough to survive without oversampling.
 */
export function distortionCurve(x: number): number {
  const a = Math.abs(x);
  if (a <= 1) return x - (x * x * x) / 3;
  return Math.sign(x) * (2 / 3);
}

export interface DriveParams {
  /** 0..99 — `Drive` for Over Drive, `Distortion` for Distortion. */
  drive: number;
  /** 0..99 output level. */
  level: number;
  /** Over Drive only. */
  midFcHz: number;
  midGainDb: number;
  eqLowDb: number;
  /** Over Drive only; Distortion has no high shelf. */
  eqHighDb: number;
  hard: boolean;
}

/** Over Drive (21) and Distortion (22). */
export class Drive {
  private readonly mid: [Biquad, Biquad] = [new Biquad(), new Biquad()];
  private readonly eq = new EffectEq();
  private gain = 1;
  private out = 1;
  private hard = false;

  constructor(readonly sampleRate: number) {}

  reset(): void {
    this.mid[0]!.reset();
    this.mid[1]!.reset();
    this.eq.reset();
  }

  set(p: DriveParams): void {
    this.hard = p.hard;
    const max = p.hard ? DISTORTION_MAX_GAIN : OVERDRIVE_MAX_GAIN;
    // Exponential in the drive control: a linear map spends most of its travel in a region
    // where the curve is already saturated and nothing further happens.
    this.gain = 1 + (max - 1) * Math.pow(unit99(p.drive), 2);
    this.out = unit99(p.level);
    for (let ch = 0; ch < 2; ch++) this.mid[ch]!.setPeaking(p.midFcHz, p.midGainDb, 1, this.sampleRate);
    this.eq.set(p.eqLowDb, p.eqHighDb, this.sampleRate);
  }

  processBlock(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    count: number,
  ): void {
    const curve = this.hard ? distortionCurve : overdriveCurve;
    for (let n = 0; n < count; n++) {
      // MONO-SUM IN. Halved rather than summed raw, so a centred source does not gain 6 dB
      // on its way into the drive stage and change how hard the curve is hit.
      const mono = (inL[n]! + inR[n]!) * 0.5;
      const shaped = curve(this.mid[0]!.process(mono) * this.gain) * this.out;
      outL[n] = this.eq.processFrame(0, shaped);
      outR[n] = this.eq.processFrame(1, shaped);
    }
  }
}

/**
 * Exciter (23). Manual: "increases the clarity of the sound, giving greater definition and
 * presence, bringing the sound to the forefront."
 *
 * Structure: split off the band above the `Emphatic Point`, distort it gently to synthesise
 * harmonics, and blend that back. `Blend` is SIGNED (-99..99) — negative subtracts the
 * generated band instead of adding it, which dulls rather than brightens. A CHOICE in its
 * details; the signed range is Korg's.
 */
export class Exciter {
  private readonly hp: [OnePole, OnePole] = [new OnePole(), new OnePole()];
  private readonly eq = new EffectEq();
  private blend = 0;

  constructor(readonly sampleRate: number) {}

  reset(): void {
    this.hp[0]!.reset();
    this.hp[1]!.reset();
    this.eq.reset();
  }

  /** `emphaticPoint` is the 1..10 display value. */
  set(p: { blend: number; emphaticPoint: number; eqLowDb: number; eqHighDb: number }): void {
    // 1..10 spread exponentially over 1..8 kHz. A CHOICE — the manual gives no frequencies.
    const t = (Math.min(10, Math.max(1, p.emphaticPoint)) - 1) / 9;
    this.hp[0]!.setCutoff(1000 * Math.pow(8, t), this.sampleRate);
    this.hp[1]!.setCutoff(1000 * Math.pow(8, t), this.sampleRate);
    this.blend = signed99(p.blend);
    this.eq.set(p.eqLowDb, p.eqHighDb, this.sampleRate);
  }

  processBlock(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    count: number,
  ): void {
    for (let n = 0; n < count; n++) {
      const hL = this.hp[0]!.processHighpass(inL[n]!);
      const hR = this.hp[1]!.processHighpass(inR[n]!);
      // A gentle squarer on the extracted band is what generates the added harmonics.
      const eL = Math.tanh(hL * 3) * 0.5;
      const eR = Math.tanh(hR * 3) * 0.5;
      outL[n] = this.eq.processFrame(0, inL[n]! + eL * this.blend);
      outR[n] = this.eq.processFrame(1, inR[n]! + eR * this.blend);
    }
  }
}

export { dbToGain };
