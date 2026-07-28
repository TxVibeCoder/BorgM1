/**
 * Reverb and early reflections — algorithms 1-9, and the tails of 26-28. PURE, Node-testable.
 *
 * MONO-SUM IN, STEREO OUT. BRIEF.md: "Reverbs, Early Reflections, Overdrive, Distortion,
 * Symphonic and Rotary are mono-sum in, stereo out. That is why M1 reverb sits so centred."
 * This is not a simplification — it is the behaviour, and reproducing it is most of why the
 * M1's reverb sounds like the M1's reverb rather than like a modern plate.
 *
 * THE STRUCTURE IS A CHOICE; THE PARAMETERS ARE NOT. Korg never published the MDE chip's
 * reverb topology, so the comb-and-allpass network below is a design decision, labelled as
 * such. What is NOT a choice is every number the user can reach: reverb time in 0.1 s steps
 * from 0.2 to 9.9, pre-delay in 1 ms steps to 200, E/R level 0-99, high damp 0-99. Those come
 * straight from p.129 and the grids are reproduced exactly (PLAN.md: "do not smooth them").
 *
 * SIZED TO THE HARDWARE'S MEMORY. The MDE's delay RAM is 65,536 words, about 2.05 s at
 * 32 kHz, shared by BOTH effect slots. The network below uses roughly 0.9 s of that at its
 * longest settings, which leaves room for a second effect — the same constraint that is
 * presumably why Korg mono-summed the input in the first place.
 */

import { EffectEq } from './eqCore';
import { Allpass, DampedComb, DelayLine, dampToCoefficient, unit99 } from './primitivesCore';

/**
 * Comb delays in milliseconds. A CHOICE. Mutually non-harmonic so the modes do not pile up
 * into a ringing pitch, and spread 30-67 ms so the tail is dense without needing more combs
 * than the chip's memory would allow.
 */
const COMB_MS = [29.7, 34.1, 39.3, 44.9, 50.3, 55.1, 60.7, 66.1];

/**
 * Diffuser lengths, two different chains so the two outputs decorrelate. A CHOICE.
 *
 * Decorrelating at the ALLPASSES rather than by running two comb banks is deliberate: it
 * halves the memory, and with a mono-summed input a second comb bank would only be producing
 * a differently-tuned version of the same signal anyway.
 */
const ALLPASS_L_MS = [5.03, 1.71, 12.7, 3.11];
const ALLPASS_R_MS = [4.37, 2.11, 11.3, 3.83];

/**
 * Early-reflection tap times as a FRACTION of the E/R time parameter, with their gains.
 * A CHOICE — the pattern of a room's first reflections is geometry Korg never published.
 * Chosen irregular so the taps do not fuse into a single flams-y echo.
 */
const ER_TAPS: [number, number][] = [
  [0.0, 1.0],
  [0.17, 0.82],
  [0.29, 0.65],
  [0.41, 0.72],
  [0.53, 0.5],
  [0.62, 0.56],
  [0.75, 0.38],
  [0.87, 0.42],
  [1.0, 0.3],
];

/** Longest pre-delay any algorithm allows, ms (p.129: reverbs 0-200). */
const MAX_PRE_DELAY_MS = 200;
/** Longest E/R time any algorithm allows, ms (p.129: 100-800). */
const MAX_ER_MS = 800;

export interface ReverbParams {
  /** Seconds, already on the 0.1 s grid. */
  reverbTimeS: number;
  /** 0..99. */
  highDamp: number;
  /** Milliseconds, 0..200. */
  preDelayMs: number;
  /** 0..99 — how much of the early-reflection cluster is mixed with the tail. */
  erLevel: number;
  eqLowDb: number;
  eqHighDb: number;
}

/**
 * The reverb tail generator. Feed it a MONO sample, get a stereo pair back.
 *
 * `process` returns into a caller-owned two-element array rather than allocating a pair per
 * frame — this runs inside `process()` where allocation is forbidden.
 */
export class Reverb {
  private readonly combs: DampedComb[];
  private readonly apL: Allpass[];
  private readonly apR: Allpass[];
  private readonly preDelay: DelayLine;
  private readonly erLine: DelayLine;
  private readonly eq = new EffectEq();
  private preDelaySamples = 0;
  private erSamples = 0;
  private erGain = 0;
  private erReverse = false;

  constructor(readonly sampleRate: number) {
    const ms = (v: number): number => (v * sampleRate) / 1000;
    this.combs = COMB_MS.map((m) => new DampedComb(Math.round(ms(m))));
    this.apL = ALLPASS_L_MS.map((m) => new Allpass(ms(m), 0.5));
    this.apR = ALLPASS_R_MS.map((m) => new Allpass(ms(m), 0.5));
    this.preDelay = new DelayLine(ms(MAX_PRE_DELAY_MS) + 4);
    this.erLine = new DelayLine(ms(MAX_ER_MS) + 4);
  }

  reset(): void {
    for (const c of this.combs) c.reset();
    for (const a of this.apL) a.reset();
    for (const a of this.apR) a.reset();
    this.preDelay.reset();
    this.erLine.reset();
    this.eq.reset();
  }

  set(p: ReverbParams): void {
    const damp = dampToCoefficient(p.highDamp);
    for (const c of this.combs) {
      c.setReverbTime(p.reverbTimeS, this.sampleRate);
      c.setDamping(damp);
    }
    this.preDelaySamples = Math.round((p.preDelayMs * this.sampleRate) / 1000);
    // The reverb's own E/R cluster is fixed-length; only its LEVEL is a parameter here.
    // Algorithms 7-9 expose the time instead and use `setEarlyReflection` below.
    this.erSamples = Math.round((80 * this.sampleRate) / 1000);
    this.erGain = unit99(p.erLevel);
    this.erReverse = false;
    this.eq.set(p.eqLowDb, p.eqHighDb, this.sampleRate);
  }

  /**
   * Configure as a standalone Early Reflection unit (algorithms 7-9), where the tail is
   * suppressed entirely and the tap cluster IS the effect.
   *
   * `reverse` is Early Ref 3: the manual says it "uses a reverse envelope on the early
   * reflections, for strong attack characteristics with cymbals", so the tap gains ramp up
   * instead of down.
   */
  setEarlyReflection(p: {
    erTimeMs: number;
    preDelayMs: number;
    eqLowDb: number;
    eqHighDb: number;
    reverse: boolean;
  }): void {
    for (const c of this.combs) {
      // Reverb time 0 would still leak a tail through the comb bank; silence it instead.
      c.setReverbTime(0.05, this.sampleRate);
      c.setDamping(0.9);
    }
    this.preDelaySamples = Math.round((p.preDelayMs * this.sampleRate) / 1000);
    this.erSamples = Math.round((p.erTimeMs * this.sampleRate) / 1000);
    this.erGain = 1;
    this.erReverse = p.reverse;
    this.eq.set(p.eqLowDb, p.eqHighDb, this.sampleRate);
    this.tailGain = 0;
  }

  /** 0 for a pure early-reflection unit, 1 for a reverb. */
  private tailGain = 1;

  /** Restore the tail after a `setEarlyReflection` reconfiguration. */
  setTailEnabled(on: boolean): void {
    this.tailGain = on ? 1 : 0;
  }

  /**
   * One frame. `mono` is the already-summed input; the stereo result lands in `out`.
   */
  process(mono: number, out: Float32Array): void {
    this.preDelay.push(mono);
    const pre = this.preDelaySamples > 0 ? this.preDelay.readInt(this.preDelaySamples) : mono;

    // ---- early reflections: a fixed irregular tap pattern scaled by the E/R time --------
    this.erLine.push(pre);
    let er = 0;
    if (this.erGain > 0 && this.erSamples > 0) {
      const n = ER_TAPS.length;
      for (let i = 0; i < n; i++) {
        const [frac, gain] = ER_TAPS[i]!;
        const g = this.erReverse ? ER_TAPS[n - 1 - i]![1] : gain;
        er += this.erLine.readInt(Math.max(1, frac * this.erSamples)) * g;
      }
      er *= this.erGain * 0.3;
    }

    // ---- tail: parallel damped combs, then two different diffuser chains ---------------
    let l = 0;
    let r = 0;
    if (this.tailGain > 0) {
      let sum = 0;
      for (const c of this.combs) sum += c.process(pre);
      sum *= 0.125; // 1/8, so eight combs do not sum to eight times the level
      l = sum;
      r = sum;
      for (const a of this.apL) l = a.process(l);
      for (const a of this.apR) r = a.process(r);
    }

    out[0] = this.eq.processFrame(0, l * this.tailGain + er);
    out[1] = this.eq.processFrame(1, r * this.tailGain + er);
  }
}
