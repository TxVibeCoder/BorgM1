/**
 * The modulation block — algorithms 12-19, and the tails of 30-33. PURE, Node-testable.
 *
 * ONE BLOCK, FOUR TOPOLOGIES, AND A PHASE BIT. PLAN.md: "the `I`/`II` variants of Chorus,
 * Flanger, Phaser and Tremolo are one modulation block with a phase-invert bit. Four fewer
 * implementations." That is confirmed by the manual's own prose — "Stereo ChorusI ... phase
 * inversion of the two circuits. Stereo ChorusII has no phase inversion" — and by the factory
 * bank, where MG-Status bit1 is set on 51 of 54 `I`-variant slots and clear on every `II`.
 *
 * So the `I`/`II` distinction is NOT two algorithms here. It is `phase180`, and it does one
 * thing: offsets the right channel's LFO by half a cycle. Everything else is shared.
 *
 * THE MODULATION DEPTH CURVES ARE CHOICES. Korg publishes `Mod Depth 0 to 99` and nothing
 * about what 99 means in milliseconds or Hz. Every full-scale constant below is labelled and
 * collected at the top, because they are the numbers the Phase 4 A/B is most likely to move.
 */

import { EffectEq } from './eqCore';
import {
  AllpassSection,
  DelayLine,
  EffectLfo,
  signed99,
  unit99,
} from './primitivesCore';

// ---- the labelled choices ----------------------------------------------------------------

/** Peak delay deviation at `DEPTH` 99, milliseconds. A CHOICE, not an M1 fact.
 *  At the gate patch's 0.30 Hz this is about 16 cents of peak pitch shift — a lush, slow
 *  chorus rather than a vibrato. FIRST NUMBER TO MOVE if the A/B says the swirl is wrong. */
export const CHORUS_DEPTH_MS = 5;
/** The same for the flanger, whose whole delay range is only 50 ms. A CHOICE. */
export const FLANGER_DEPTH_MS = 4;
/** Minimum delay a modulated tap may reach, ms. Below this the interpolator runs out of room. */
const MIN_DELAY_MS = 0.5;
/** Phaser sweep range, Hz, from `MANUAL` 0 to 99. A CHOICE. */
const PHASER_MIN_HZ = 100;
const PHASER_MAX_HZ = 4000;
/** Phaser allpass stages. Six gives three notches — the classic voicing. A CHOICE. */
const PHASER_STAGES = 6;
/** Longest base delay the chorus allows, ms (p.129: `0~C8(32) : 0~200(50)`). */
const MAX_CHORUS_DELAY_MS = 200;

export type ModTopology = 'chorus' | 'flanger' | 'phaser' | 'tremolo';

export interface ModulationParams {
  topology: ModTopology;
  /** 0..99. */
  depth: number;
  /** Hz, already snapped to the hardware's piecewise grid. */
  speedHz: number;
  /** MG Status bit0. */
  triangle: boolean;
  /** MG Status bit1 — the `I`/`II` distinction. */
  phase180: boolean;
  /** -99..99. Flanger and phaser only; chorus and tremolo pass 0. */
  feedback: number;
  /** Milliseconds. Chorus/flanger base delay. */
  delayMs: number;
  /** 0..99. Phaser only — the sweep's centre. */
  manual: number;
  /** -99..99. Tremolo only. */
  shape: number;
  /** Feedback crosses to the other channel (algorithm 15, `CROSS FLANGER`). */
  crossFeedback: boolean;
  eqLowDb: number;
  eqHighDb: number;
  /** Some hosts want the EQ suppressed (the `Delay/X` tails carry no EQ of their own). */
  noEq?: boolean;
}

/**
 * A stereo modulation unit producing the WET signal only — the dry/wet mix is the effect
 * slot's job, because `Dry:EFF` is a slot parameter rather than an algorithm parameter.
 */
export class Modulation {
  private readonly lineL: DelayLine;
  private readonly lineR: DelayLine;
  private readonly apL: AllpassSection[] = [];
  private readonly apR: AllpassSection[] = [];
  private readonly lfo = new EffectLfo();
  private readonly eq = new EffectEq();
  private fbL = 0;
  private fbR = 0;

  private topology: ModTopology = 'chorus';
  private depth01 = 0;
  private feedback01 = 0;
  private baseDelaySamples = 0;
  private swingSamples = 0;
  private phaseOffset = 0;
  private manual01 = 0;
  private crossFeedback = false;
  private useEq = true;

  /** LFO value at the end of the previous control block, for per-sample interpolation. */
  private prevL = 0;
  private prevR = 0;

  constructor(readonly sampleRate: number) {
    const maxSamples = Math.ceil(((MAX_CHORUS_DELAY_MS + CHORUS_DEPTH_MS) * sampleRate) / 1000) + 8;
    this.lineL = new DelayLine(maxSamples);
    this.lineR = new DelayLine(maxSamples);
    for (let i = 0; i < PHASER_STAGES; i++) {
      this.apL.push(new AllpassSection());
      this.apR.push(new AllpassSection());
    }
  }

  reset(): void {
    this.lineL.reset();
    this.lineR.reset();
    for (const a of this.apL) a.reset();
    for (const a of this.apR) a.reset();
    this.eq.reset();
    this.lfo.reset(0);
    this.fbL = 0;
    this.fbR = 0;
    this.prevL = 0;
    this.prevR = 0;
  }

  set(p: ModulationParams): void {
    this.topology = p.topology;
    this.depth01 = unit99(p.depth);
    this.feedback01 = signed99(p.feedback);
    this.manual01 = unit99(p.manual);
    this.crossFeedback = p.crossFeedback;
    this.useEq = p.noEq !== true;

    this.lfo.setRate(p.speedHz, this.sampleRate);
    this.lfo.setWaveform(p.triangle);
    // SHAPE belongs to the tremolo alone; leaving it applied elsewhere would skew a chorus.
    this.lfo.setShape(p.topology === 'tremolo' ? signed99(p.shape) : 0);
    // THE `I`/`II` BIT. Half a cycle of offset on the right channel, and nothing else.
    this.phaseOffset = p.phase180 ? 0.5 : 0;

    const perMs = this.sampleRate / 1000;
    const swingMs = (p.topology === 'flanger' ? FLANGER_DEPTH_MS : CHORUS_DEPTH_MS) * this.depth01;
    this.baseDelaySamples = Math.max(MIN_DELAY_MS * perMs, p.delayMs * perMs);
    this.swingSamples = swingMs * perMs;

    if (this.useEq) this.eq.set(p.eqLowDb, p.eqHighDb, this.sampleRate);
    else this.eq.set(0, 0, this.sampleRate);
  }

  /**
   * Render `count` frames of WET signal.
   *
   * The LFO is evaluated ONCE per call and its value interpolated across the block, exactly
   * as the voice engine interpolates increment and gain. Evaluating it per sample would be
   * smoother still but would tie modulation resolution to nothing in particular; evaluating
   * it per block WITHOUT interpolating would step the delay line and click. Callers pass a
   * control-block-sized `count` (CLAUDE.md).
   */
  processBlock(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    count: number,
  ): void {
    const endL = this.lfo.advance(count);
    const endR = this.phaseOffset === 0 ? endL : this.lfo.valueOffset(this.phaseOffset);
    const startL = this.prevL;
    const startR = this.prevR;
    this.prevL = endL;
    this.prevR = endR;

    switch (this.topology) {
      case 'chorus':
      case 'flanger':
        this.renderDelayMod(inL, inR, outL, outR, count, startL, endL, startR, endR);
        break;
      case 'phaser':
        this.renderPhaser(inL, inR, outL, outR, count, startL, endL, startR, endR);
        break;
      case 'tremolo':
        this.renderTremolo(inL, inR, outL, outR, count, startL, endL, startR, endR);
        break;
    }

    if (this.useEq && !this.eq.isFlat) {
      for (let n = 0; n < count; n++) {
        outL[n] = this.eq.processFrame(0, outL[n]!);
        outR[n] = this.eq.processFrame(1, outR[n]!);
      }
    }
  }

  /**
   * Chorus and flanger: a swept fractional tap, with feedback for the flanger.
   *
   * THE SWEEP IS UNIPOLAR — it runs UPWARD from the base delay rather than around it, so
   * `DELAY_TIME` is the floor of the sweep and not its centre. That matches the parameter's
   * own definition ("Time between direct sound and effect sound") and it is not cosmetic:
   * I17 Organ 2, the fidelity gate's own patch, sets DELAY TIME 0 with DEPTH 99. A bipolar
   * sweep would spend half of every cycle clamped against the interpolator's minimum delay,
   * which flattens one side of the modulation and is plainly audible as an uneven wobble.
   * MEASURED in the browser before the fix. A CHOICE in its details — Korg documents the
   * range and not the geometry.
   */
  private renderDelayMod(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    count: number,
    startL: number,
    endL: number,
    startR: number,
    endR: number,
  ): void {
    const minSamples = (MIN_DELAY_MS * this.sampleRate) / 1000;
    const stepL = (endL - startL) / count;
    const stepR = (endR - startR) / count;
    const fb = this.feedback01;
    for (let n = 0; n < count; n++) {
      // (lfo + 1) * 0.5 maps -1..1 onto 0..1, so the tap never reaches below the base delay.
      const mL = (startL + stepL * (n + 1) + 1) * 0.5;
      const mR = (startR + stepR * (n + 1) + 1) * 0.5;
      const dL = Math.max(minSamples, this.baseDelaySamples + this.swingSamples * mL);
      const dR = Math.max(minSamples, this.baseDelaySamples + this.swingSamples * mR);

      const wetL = this.lineL.read(dL);
      const wetR = this.lineR.read(dR);
      // CROSS FLANGER (#15) sends each side's feedback to the OTHER line — the manual's own
      // description. A plain flanger feeds back into itself.
      this.lineL.push(inL[n]! + (this.crossFeedback ? this.fbR : this.fbL) * fb);
      this.lineR.push(inR[n]! + (this.crossFeedback ? this.fbL : this.fbR) * fb);
      this.fbL = wetL;
      this.fbR = wetR;
      outL[n] = wetL;
      outR[n] = wetR;
    }
  }

  /** Phaser: a cascade of swept allpass sections plus feedback. */
  private renderPhaser(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    count: number,
    startL: number,
    endL: number,
    startR: number,
    endR: number,
  ): void {
    const stepL = (endL - startL) / count;
    const stepR = (endR - startR) / count;
    const fb = this.feedback01 * 0.9;
    const ratio = PHASER_MAX_HZ / PHASER_MIN_HZ;
    // Sweep exponentially about the manual setting — pitch is exponential, and a linear
    // sweep spends most of its travel where nothing audible happens.
    const centre = PHASER_MIN_HZ * Math.pow(ratio, this.manual01);
    const octaves = 2 * this.depth01;

    for (let n = 0; n < count; n++) {
      const hzL = centre * Math.pow(2, octaves * (startL + stepL * (n + 1)));
      const hzR = centre * Math.pow(2, octaves * (startR + stepR * (n + 1)));
      for (let s = 0; s < PHASER_STAGES; s++) {
        this.apL[s]!.setFrequency(hzL, this.sampleRate);
        this.apR[s]!.setFrequency(hzR, this.sampleRate);
      }
      let l = inL[n]! + this.fbL * fb;
      let r = inR[n]! + this.fbR * fb;
      for (let s = 0; s < PHASER_STAGES; s++) {
        l = this.apL[s]!.process(l);
        r = this.apR[s]!.process(r);
      }
      this.fbL = l;
      this.fbR = r;
      outL[n] = l;
      outR[n] = r;
    }
  }

  /**
   * Tremolo: amplitude modulation. With `phase180` the two channels move in opposition,
   * which is the manual's "automatic panning between left and right outputs".
   */
  private renderTremolo(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    count: number,
    startL: number,
    endL: number,
    startR: number,
    endR: number,
  ): void {
    const stepL = (endL - startL) / count;
    const stepR = (endR - startR) / count;
    const d = this.depth01;
    for (let n = 0; n < count; n++) {
      // (1 + lfo)/2 maps -1..1 onto 0..1, so depth 99 reaches full silence at the trough
      // and unity at the peak rather than boosting above unity.
      const gL = 1 - d * (1 - (startL + stepL * (n + 1) + 1) * 0.5);
      const gR = 1 - d * (1 - (startR + stepR * (n + 1) + 1) * 0.5);
      outL[n] = inL[n]! * gL;
      outR[n] = inR[n]! * gR;
    }
  }
}
