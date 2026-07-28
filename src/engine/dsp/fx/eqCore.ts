/**
 * The effect section's equalisers. PURE — no Web Audio types, Node-testable.
 *
 * TWO DIFFERENT THINGS LIVE HERE, and conflating them would be a fidelity bug:
 *
 *  - **The per-effect `EQ HIGH` / `EQ LOW` pair**, which nearly every algorithm carries at
 *    block offsets 06/07. PLAN.md: "most effects leave their EQ in circuit even when switched
 *    off" — these shelves are part of the effect, not a bypassable extra, and they act on the
 *    WET path only, which is what makes I17 Organ 2's `+12/+12` a tone control on the chorus
 *    rather than on the whole program.
 *  - **Algorithm #20 `EQUALIZER`**, a three-band unit with selectable corner frequencies.
 *
 * SHELF FREQUENCIES FOR THE PER-EFFECT PAIR ARE A CHOICE, NOT AN M1 FACT. The manual gives
 * those two parameters a range in dB and never a frequency. The values used are Korg's own
 * documented defaults for the EQUALIZER algorithm — 500 Hz low, 2 kHz high (M1R manual
 * pp.56-57) — on the reasoning that the same chip almost certainly reused the same corners,
 * and that a documented number beats an invented one. If the Phase 4 A/B says the gate patch
 * is too dark or too honky, THESE ARE THE FIRST TWO NUMBERS TO MOVE.
 */

import { dbToGain } from './primitivesCore';

/** Per-effect `EQ LOW` shelf corner, Hz. A CHOICE — see the header. */
export const EFFECT_EQ_LOW_HZ = 500;
/** Per-effect `EQ HIGH` shelf corner, Hz. A CHOICE — see the header. */
export const EFFECT_EQ_HIGH_HZ = 2000;
/** Shelf slope. 0.7 is a gentle, non-resonant knee. A CHOICE. */
const SHELF_SLOPE = 0.7;
/** Peaking-band Q for the EQUALIZER's mid. A CHOICE. */
const MID_Q = 1.0;

/**
 * A direct-form-II transposed biquad. One per channel — the coefficients are shared but the
 * state must not be, or the two channels bleed into each other.
 */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;
  /** True when the section is exactly unity, so it can be skipped entirely. */
  private bypass = true;

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }

  get isBypassed(): boolean {
    return this.bypass;
  }

  private setCoefficients(
    b0: number,
    b1: number,
    b2: number,
    a0: number,
    a1: number,
    a2: number,
  ): void {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    this.bypass = false;
  }

  /** Make the section a straight wire. Cheaper than running a unity biquad. */
  setUnity(): void {
    this.b0 = 1;
    this.b1 = 0;
    this.b2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.bypass = true;
  }

  /** RBJ low shelf. `db` of 0 collapses to a bypass rather than a unity filter. */
  setLowShelf(hz: number, db: number, sampleRate: number): void {
    if (db === 0) return this.setUnity();
    const A = Math.pow(10, db / 40);
    const w = (2 * Math.PI * clampHz(hz, sampleRate)) / sampleRate;
    const cs = Math.cos(w);
    const sn = Math.sin(w);
    const alpha = (sn / 2) * Math.sqrt((A + 1 / A) * (1 / SHELF_SLOPE - 1) + 2);
    const beta = 2 * Math.sqrt(A) * alpha;
    this.setCoefficients(
      A * (A + 1 - (A - 1) * cs + beta),
      2 * A * (A - 1 - (A + 1) * cs),
      A * (A + 1 - (A - 1) * cs - beta),
      A + 1 + (A - 1) * cs + beta,
      -2 * (A - 1 + (A + 1) * cs),
      A + 1 + (A - 1) * cs - beta,
    );
  }

  /** RBJ high shelf. */
  setHighShelf(hz: number, db: number, sampleRate: number): void {
    if (db === 0) return this.setUnity();
    const A = Math.pow(10, db / 40);
    const w = (2 * Math.PI * clampHz(hz, sampleRate)) / sampleRate;
    const cs = Math.cos(w);
    const sn = Math.sin(w);
    const alpha = (sn / 2) * Math.sqrt((A + 1 / A) * (1 / SHELF_SLOPE - 1) + 2);
    const beta = 2 * Math.sqrt(A) * alpha;
    this.setCoefficients(
      A * (A + 1 + (A - 1) * cs + beta),
      -2 * A * (A - 1 + (A + 1) * cs),
      A * (A + 1 + (A - 1) * cs - beta),
      A + 1 - (A - 1) * cs + beta,
      2 * (A - 1 - (A + 1) * cs),
      A + 1 - (A - 1) * cs - beta,
    );
  }

  /** RBJ peaking band, for the EQUALIZER's mid. */
  setPeaking(hz: number, db: number, q: number, sampleRate: number): void {
    if (db === 0) return this.setUnity();
    const A = Math.pow(10, db / 40);
    const w = (2 * Math.PI * clampHz(hz, sampleRate)) / sampleRate;
    const cs = Math.cos(w);
    const sn = Math.sin(w);
    const alpha = sn / (2 * Math.max(0.1, q));
    this.setCoefficients(
      1 + alpha * A,
      -2 * cs,
      1 - alpha * A,
      1 + alpha / A,
      -2 * cs,
      1 - alpha / A,
    );
  }

  process(x: number): number {
    if (this.bypass) return x;
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

function clampHz(hz: number, sampleRate: number): number {
  return Math.min(sampleRate * 0.45, Math.max(20, hz));
}

/**
 * The `EQ HIGH` / `EQ LOW` pair carried by nearly every algorithm, as a stereo unit.
 *
 * Held as one object rather than four loose biquads because the pair is always configured
 * together and always sits at the same point in the chain — the wet path's output.
 */
export class EffectEq {
  private readonly low: [Biquad, Biquad] = [new Biquad(), new Biquad()];
  private readonly high: [Biquad, Biquad] = [new Biquad(), new Biquad()];
  private active = false;

  /** `lowDb` and `highDb` are the raw -12..12 display values. */
  set(lowDb: number, highDb: number, sampleRate: number): void {
    for (let ch = 0; ch < 2; ch++) {
      this.low[ch]!.setLowShelf(EFFECT_EQ_LOW_HZ, lowDb, sampleRate);
      this.high[ch]!.setHighShelf(EFFECT_EQ_HIGH_HZ, highDb, sampleRate);
    }
    this.active = lowDb !== 0 || highDb !== 0;
  }

  reset(): void {
    for (let ch = 0; ch < 2; ch++) {
      this.low[ch]!.reset();
      this.high[ch]!.reset();
    }
  }

  /** True when both shelves are flat, so the caller can skip the loop entirely. */
  get isFlat(): boolean {
    return !this.active;
  }

  processFrame(ch: 0 | 1, x: number): number {
    if (!this.active) return x;
    return this.high[ch]!.process(this.low[ch]!.process(x));
  }
}

/**
 * Algorithm #20, `EQUALIZER`. Three bands: low shelf, mid peak, high shelf.
 *
 * The MID band is in the SysEx block (p.129 titles the algorithm "3 Band EQ" and allocates
 * `Mid fc` and `Mid Gain` at offsets 00/01) but is absent from the hardware's own edit page
 * and from the default-values chart, both of which show Low and High only. The bytes are
 * real, so the band is modelled; it defaults to 0 dB, which is out of circuit.
 */
export class ThreeBandEq {
  private readonly low: [Biquad, Biquad] = [new Biquad(), new Biquad()];
  private readonly mid: [Biquad, Biquad] = [new Biquad(), new Biquad()];
  private readonly high: [Biquad, Biquad] = [new Biquad(), new Biquad()];

  set(
    p: {
      lowFc: number;
      lowGain: number;
      midFc: number;
      midGain: number;
      highFc: number;
      highGain: number;
    },
    sampleRate: number,
  ): void {
    for (let ch = 0; ch < 2; ch++) {
      this.low[ch]!.setLowShelf(p.lowFc, p.lowGain, sampleRate);
      this.mid[ch]!.setPeaking(p.midFc, p.midGain, MID_Q, sampleRate);
      this.high[ch]!.setHighShelf(p.highFc, p.highGain, sampleRate);
    }
  }

  reset(): void {
    for (let ch = 0; ch < 2; ch++) {
      this.low[ch]!.reset();
      this.mid[ch]!.reset();
      this.high[ch]!.reset();
    }
  }

  processFrame(ch: 0 | 1, x: number): number {
    return this.high[ch]!.process(this.mid[ch]!.process(this.low[ch]!.process(x)));
  }
}

export { dbToGain };
