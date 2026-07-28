/**
 * The delay block — algorithms 10 and 11, and the head of every `Delay/X` (26-33).
 * PURE, Node-testable.
 *
 * THE 500 ms CEILING IS A HARDWARE FACT, NOT A ROUND NUMBER. The service manual gives the
 * MDE's delay RAM as 65,536 words; at ~32,768 Hz that makes 500 ms exactly 2^14 words, so
 * the memory partitions into four clean 16K blocks. That derivation is also one of the two
 * that bracket the project's sample-rate choice (DECISIONS.md, planning).
 *
 * `CROSS DELAY` differs from `STEREO DELAY` in one line — the manual: "Cross delay sends the
 * feedback signal of each delay over to the other delay."
 */

import { EffectEq } from './eqCore';
import { DelayLine, OnePole, dampToCoefficient, signed99 } from './primitivesCore';

/** p.129: `00~1F4 : 00~500`. */
export const MAX_DELAY_MS = 500;

export interface DelayParams {
  /** Milliseconds, 0..500. */
  timeLMs: number;
  timeRMs: number;
  /** -99..99. Negative inverts the phase of the fed-back signal. */
  feedbackL: number;
  feedbackR: number;
  /** 0..99. */
  highDampL: number;
  highDampR: number;
  /** Feedback crosses to the other channel (algorithm 11). */
  cross: boolean;
  eqLowDb: number;
  eqHighDb: number;
  noEq?: boolean;
}

/** A stereo delay producing WET signal only. */
export class StereoDelay {
  private readonly lineL: DelayLine;
  private readonly lineR: DelayLine;
  private readonly dampL = new OnePole();
  private readonly dampR = new OnePole();
  private readonly eq = new EffectEq();
  private delayL = 1;
  private delayR = 1;
  private fbL = 0;
  private fbR = 0;
  private cross = false;
  private useEq = true;

  constructor(readonly sampleRate: number) {
    const max = Math.ceil((MAX_DELAY_MS * sampleRate) / 1000) + 8;
    this.lineL = new DelayLine(max);
    this.lineR = new DelayLine(max);
  }

  reset(): void {
    this.lineL.reset();
    this.lineR.reset();
    this.dampL.reset();
    this.dampR.reset();
    this.eq.reset();
  }

  set(p: DelayParams): void {
    const perMs = this.sampleRate / 1000;
    // A delay time of 0 still has to read at least one sample back, or the line degenerates
    // into an algebraic loop the moment feedback is non-zero.
    this.delayL = Math.max(1, p.timeLMs * perMs);
    this.delayR = Math.max(1, p.timeRMs * perMs);
    this.fbL = signed99(p.feedbackL);
    this.fbR = signed99(p.feedbackR);
    this.dampL.setDamping(dampToCoefficient(p.highDampL));
    this.dampR.setDamping(dampToCoefficient(p.highDampR));
    this.cross = p.cross;
    this.useEq = p.noEq !== true;
    this.eq.set(this.useEq ? p.eqLowDb : 0, this.useEq ? p.eqHighDb : 0, this.sampleRate);
  }

  processBlock(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    count: number,
  ): void {
    for (let n = 0; n < count; n++) {
      const wetL = this.lineL.readInt(this.delayL);
      const wetR = this.lineR.readInt(this.delayR);
      const dL = this.dampL.process(wetL);
      const dR = this.dampR.process(wetR);
      // Feedback is clamped just under unity so a 99% setting rings for a long time without
      // running away — the hardware's own feedback path had finite headroom too.
      this.lineL.push(inL[n]! + (this.cross ? dR : dL) * this.fbL * 0.99);
      this.lineR.push(inR[n]! + (this.cross ? dL : dR) * this.fbR * 0.99);
      outL[n] = wetL;
      outR[n] = wetR;
    }
    if (this.useEq && !this.eq.isFlat) {
      for (let n = 0; n < count; n++) {
        outL[n] = this.eq.processFrame(0, outL[n]!);
        outR[n] = this.eq.processFrame(1, outR[n]!);
      }
    }
  }
}
