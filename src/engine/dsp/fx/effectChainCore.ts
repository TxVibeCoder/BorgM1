/**
 * The two-slot effect matrix — the M1's whole master effect section. PURE, Node-testable.
 *
 * FOUR BUSES AND A 2-EFFECT MATRIX, NOT SENDS (BRIEF.md). The hardware has four inputs
 * (A, B, C, D) and four outputs (1/L, 2/R, 3, 4), and the routing is a single bit:
 *
 *   SERIAL    A,B -> Effect1 --+-> Effect2 -> 1/L, 2/R     C,D --Pan3/Pan4--+
 *   PARALLEL  A,B -> Effect1 --+-> 1/L, 2/R                C,D -> Effect2 --Pan3/Pan4--+
 *
 * That is manual pp.36-37 verbatim, and it is the page on which Pan 3 and Pan 4 finally make
 * sense: they are where outputs 3 and 4 sit in the main stereo pair. In SERIAL they carry C
 * and D into effect 2's input ("The output signals from 3 and 4 can also be mixed with the A
 * and B inputs to be routed together through Effect 2"); in PARALLEL they carry effect 2's own
 * output back ("The outputs from 3 and 4 can be mixed with the Effect 1 outputs").
 *
 * PROGRAM MODE CANNOT REACH EFFECT 2 IN PARALLEL, AND THAT IS NOT A BUG. Program mode has no
 * panpot page at all, so a non-drum program is hard-wired 5:5 into A/B — and in PARALLEL the
 * A/B path stops at Effect 1. Switching a Program to PARALLEL therefore SILENCES effect 2
 * entirely. It looks like a fault and it is the hardware. Phase 5's Combinations have a real
 * panpot per timbre and DO feed C/D: 68 of Korg's 800 factory combination timbres are panned
 * to C, C+D or D, and 41 of the 100 combinations set Pan 3 to 101 (hard L) and Pan 4 to 1
 * (hard R), which is the manual's own recipe for hearing both effects in stereo.
 *
 * `Dry:EFF` IS A CROSSFADE, NOT A SEND. The display reads `60:40`, the two halves sum to 100,
 * and the byte is the EFFECT half — so `out = dry*(1-w) + wet*w`. Worth stating because the
 * alternative reading (dry always unity, wet added on top) is louder by up to 6 dB and is
 * exactly the error PLAN.md warns about: "Korg's own emulation had wet levels globally too
 * hot — SOS had to drop reverb from 18 to 13." I17 Organ 2's hall sits at 18, so if this law
 * is wrong the fidelity gate is the thing that will say so.
 */

import {
  effectAlgorithm,
  type EffectAlgorithm,
  type EffectsState,
  type EffectSlotState,
} from '../../../../data/effectParams';
import { StereoDelay } from './delayCore';
import { Drive, Exciter } from './driveCore';
import { SymphonicEnsemble, RotarySpeaker } from './ensembleCore';
import { ThreeBandEq } from './eqCore';
import { Modulation, type ModTopology } from './modulationCore';
import { Reverb } from './reverbCore';

/** Longest block this chain will ever be asked for. Scratch is sized once, here. */
export const MAX_FX_BLOCK = 256;

type Params = Record<string, number | string>;

function num(p: Params, id: string, fallback = 0): number {
  const v = p[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function isTri(p: Params, id: string): boolean {
  return p[id] === 'TRI';
}

/**
 * One effect slot. Holds an instance of EVERY block kind, built once in the constructor.
 *
 * That looks wasteful and is the correct trade: `set()` runs on the audio thread (it is
 * driven by `port.onmessage`), so allocating a reverb's delay lines there would risk a GC
 * pause in the render callback. A few megabytes of resident delay memory is the cheap side
 * of that trade — the sample bank alone is already 100 MiB (DECISIONS.md, Phase 2).
 */
export class EffectSlot {
  private algo: EffectAlgorithm | null = null;

  private readonly reverb: Reverb;
  private readonly mod: Modulation;
  private readonly delay: StereoDelay;
  private readonly drive: Drive;
  private readonly exciter: Exciter;
  private readonly eq3: ThreeBandEq;
  private readonly symphonic: SymphonicEnsemble;
  private readonly rotary: RotarySpeaker;
  /** The `Delay/X` family's second half — a reverb or a modulation, fed by the delay. */
  private readonly tailReverb: Reverb;
  private readonly tailMod: Modulation;
  private readonly tailDelay: StereoDelay;

  /** Wet percent 0..1 for the two balances. */
  private wetA = 0;
  private wetB = 0;

  private readonly scratchL = new Float32Array(MAX_FX_BLOCK);
  private readonly scratchR = new Float32Array(MAX_FX_BLOCK);
  private readonly stageL = new Float32Array(MAX_FX_BLOCK);
  private readonly stageR = new Float32Array(MAX_FX_BLOCK);
  private readonly revOut = new Float32Array(2);

  constructor(readonly sampleRate: number) {
    this.reverb = new Reverb(sampleRate);
    this.mod = new Modulation(sampleRate);
    this.delay = new StereoDelay(sampleRate);
    this.drive = new Drive(sampleRate);
    this.exciter = new Exciter(sampleRate);
    this.eq3 = new ThreeBandEq();
    this.symphonic = new SymphonicEnsemble(sampleRate);
    this.rotary = new RotarySpeaker(sampleRate);
    this.tailReverb = new Reverb(sampleRate);
    this.tailMod = new Modulation(sampleRate);
    this.tailDelay = new StereoDelay(sampleRate);
  }

  get isActive(): boolean {
    return this.algo !== null;
  }

  reset(): void {
    this.reverb.reset();
    this.mod.reset();
    this.delay.reset();
    this.drive.reset();
    this.exciter.reset();
    this.eq3.reset();
    this.symphonic.reset();
    this.rotary.reset();
    this.tailReverb.reset();
    this.tailMod.reset();
    this.tailDelay.reset();
  }

  /** Configure from a slot's state. Safe to call as often as a knob moves. */
  set(state: EffectSlotState): void {
    const next = effectAlgorithm(state.type);
    // Changing algorithm must clear the previous one's delay memory, or its tail leaks into
    // the new effect for as long as its longest line.
    if (next?.index !== this.algo?.index) this.reset();
    this.algo = next;
    this.wetA = Math.min(1, Math.max(0, state.balanceA / 100));
    this.wetB = Math.min(1, Math.max(0, state.balanceB / 100));
    if (!next) return;
    const p = state.params;

    switch (next.kind) {
      case 'reverb':
        this.reverb.setTailEnabled(true);
        this.reverb.set({
          reverbTimeS: num(p, 'REVERB_TIME', 2),
          highDamp: num(p, 'HIGH_DAMP'),
          preDelayMs: num(p, 'PRE_DELAY'),
          erLevel: num(p, 'ER_LEVEL'),
          eqLowDb: num(p, 'EQ_LOW'),
          eqHighDb: num(p, 'EQ_HIGH'),
        });
        break;
      case 'earlyReflection':
        this.reverb.setEarlyReflection({
          erTimeMs: num(p, 'ER_TIME', 200),
          preDelayMs: num(p, 'PRE_DELAY'),
          eqLowDb: num(p, 'EQ_LOW'),
          eqHighDb: num(p, 'EQ_HIGH'),
          // EARLY REF 3 alone runs its tap envelope backwards (manual: "reverse envelope
          // on the early reflections, for strong attack characteristics with cymbals").
          reverse: next.index === 9,
        });
        break;
      case 'delay':
        this.delay.set({
          timeLMs: num(p, 'DELAY_TIME_L'),
          timeRMs: num(p, 'DELAY_TIME_R'),
          feedbackL: num(p, 'FEEDBACK'),
          feedbackR: num(p, 'FEEDBACK'),
          highDampL: num(p, 'HIGH_DAMP'),
          highDampR: num(p, 'HIGH_DAMP'),
          cross: next.index === 11,
          eqLowDb: num(p, 'EQ_LOW'),
          eqHighDb: num(p, 'EQ_HIGH'),
        });
        break;
      case 'modulation':
        this.mod.set({
          topology: next.modShape as ModTopology,
          depth: num(p, 'DEPTH'),
          speedHz: num(p, 'SPEED', 1),
          triangle: isTri(p, 'WAVEFORM'),
          // THE `I`/`II` BIT. `'180'` is the inverted-phase variant.
          phase180: p['PHASE'] === '180',
          feedback: num(p, 'FEEDBACK'),
          delayMs: num(p, 'DELAY_TIME'),
          manual: num(p, 'MANUAL'),
          shape: num(p, 'SHAPE'),
          crossFeedback: next.index === 15,
          eqLowDb: num(p, 'EQ_LOW'),
          eqHighDb: num(p, 'EQ_HIGH'),
        });
        break;
      case 'eq':
        this.eq3.set(
          {
            lowFc: num(p, 'LOW_FC', 500),
            lowGain: num(p, 'LOW_GAIN'),
            midFc: num(p, 'MID_FC', 1000),
            midGain: num(p, 'MID_GAIN'),
            highFc: num(p, 'HIGH_FC', 2000),
            highGain: num(p, 'HIGH_GAIN'),
          },
          this.sampleRate,
        );
        break;
      case 'drive':
        this.drive.set({
          drive: num(p, next.index === 22 ? 'DISTORTION' : 'DRIVE'),
          level: num(p, 'LEVEL'),
          midFcHz: num(p, 'EQ_MID_FC', 1000),
          midGainDb: num(p, 'EQ_MID_GAIN'),
          eqLowDb: num(p, 'EQ_LOW'),
          // DISTORTION genuinely has no high shelf — three parameters, confirmed twice.
          eqHighDb: next.index === 22 ? 0 : num(p, 'EQ_HIGH'),
          hard: next.index === 22,
        });
        break;
      case 'exciter':
        this.exciter.set({
          blend: num(p, 'BLEND'),
          emphaticPoint: num(p, 'EMPHATIC_POINT', 5),
          eqLowDb: num(p, 'EQ_LOW'),
          eqHighDb: num(p, 'EQ_HIGH'),
        });
        break;
      case 'symphonic':
        this.symphonic.set({
          depth: num(p, 'DEPTH'),
          eqLowDb: num(p, 'EQ_LOW'),
          eqHighDb: num(p, 'EQ_HIGH'),
        });
        break;
      case 'rotary':
        this.rotary.set({ depth: num(p, 'DEPTH'), speedRate: num(p, 'SPEED_RATE') });
        break;
      case 'delayPlus':
        this.setDelayPlus(next, p);
        break;
    }
  }

  /** The `Delay/X` family: a delay head, then one of the other blocks as a tail. */
  private setDelayPlus(algo: EffectAlgorithm, p: Params): void {
    const isDualDelay = algo.tail === 'delay';
    this.delay.set({
      timeLMs: num(p, isDualDelay ? 'DELAY_TIME_L' : 'DELAY_TIME'),
      timeRMs: num(p, isDualDelay ? 'DELAY_TIME_L' : 'DELAY_TIME'),
      feedbackL: num(p, isDualDelay ? 'FEEDBACK_L' : 'FEEDBACK'),
      feedbackR: num(p, isDualDelay ? 'FEEDBACK_L' : 'FEEDBACK'),
      highDampL: num(p, isDualDelay ? 'HIGH_DAMP_L' : 'HIGH_DAMP'),
      highDampR: num(p, isDualDelay ? 'HIGH_DAMP_L' : 'HIGH_DAMP'),
      cross: false,
      eqLowDb: 0,
      eqHighDb: 0,
      // The combined algorithms carry no EQ of their own — p.129 gives them no EQ offsets.
      noEq: true,
    });

    switch (algo.tail) {
      case 'hall':
      case 'room':
        this.tailReverb.setTailEnabled(true);
        this.tailReverb.set({
          reverbTimeS: num(p, 'REVERB_TIME', 2),
          highDamp: num(p, 'REVERB_HIGH_DAMP'),
          preDelayMs: num(p, 'PRE_DELAY'),
          erLevel: 0,
          eqLowDb: 0,
          eqHighDb: 0,
        });
        break;
      case 'earlyReflection':
        this.tailReverb.setEarlyReflection({
          erTimeMs: num(p, 'ER_TIME', 200),
          preDelayMs: num(p, 'PRE_DELAY'),
          eqLowDb: 0,
          eqHighDb: 0,
          reverse: false,
        });
        break;
      case 'delay':
        this.tailDelay.set({
          timeLMs: num(p, 'DELAY_TIME_R'),
          timeRMs: num(p, 'DELAY_TIME_R'),
          feedbackL: num(p, 'FEEDBACK_R'),
          feedbackR: num(p, 'FEEDBACK_R'),
          highDampL: num(p, 'HIGH_DAMP_R'),
          highDampR: num(p, 'HIGH_DAMP_R'),
          cross: false,
          eqLowDb: 0,
          eqHighDb: 0,
          noEq: true,
        });
        break;
      default:
        this.tailMod.set({
          topology: (algo.tail ?? 'chorus') as ModTopology,
          depth: num(p, 'DEPTH'),
          speedHz: num(p, 'SPEED', 1),
          triangle: isTri(p, 'WAVEFORM'),
          // The combined algorithms fix the phase at 0 — p.129 gives `bit1 <- 0` for 30/31,
          // which makes sense: the delay head already supplies the stereo width.
          phase180: false,
          feedback: num(p, 'MOD_FEEDBACK'),
          delayMs: 10,
          manual: 50,
          shape: num(p, 'SHAPE'),
          crossFeedback: false,
          eqLowDb: 0,
          eqHighDb: 0,
          noEq: true,
        });
        break;
    }
  }

  /**
   * Render `count` frames. `inL`/`inR` are read, `outL`/`outR` written (they may alias the
   * inputs). `count` must not exceed MAX_FX_BLOCK.
   *
   * The dry/wet crossfade happens HERE rather than inside each block, because `Dry:EFF` is a
   * slot parameter — the same balance applies whatever algorithm is loaded.
   */
  process(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    count: number,
  ): void {
    const algo = this.algo;
    if (!algo) {
      if (outL !== inL) outL.set(inL.subarray(0, count));
      if (outR !== inR) outR.set(inR.subarray(0, count));
      return;
    }
    const wet = this.scratchL;
    const wetR = this.scratchR;

    if (algo.kind === 'delayPlus') {
      this.processDelayPlus(algo, inL, inR, outL, outR, count);
      return;
    }

    this.renderWet(algo, inL, inR, wet, wetR, count);
    // A/B are the LEFT and RIGHT balances for the stereo algorithms 1-25.
    const a = this.wetA;
    const b = this.wetB;
    for (let n = 0; n < count; n++) {
      outL[n] = inL[n]! * (1 - a) + wet[n]! * a;
      outR[n] = inR[n]! * (1 - b) + wetR[n]! * b;
    }
  }

  /**
   * The dual algorithms: TWO serial stages, each with its OWN dry/wet.
   *
   * MEASURED, not inferred: across Korg's 100 factory programs the two balance bytes are
   * equal in 196 of 196 slots holding a stereo effect (1-25) and unequal in 4 of 4 slots
   * holding a dual one (26-33). They are the two halves' `Dry:EFF`, exactly as the hardware's
   * edit page shows two of them.
   */
  private processDelayPlus(
    algo: EffectAlgorithm,
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    count: number,
  ): void {
    const wl = this.scratchL;
    const wr = this.scratchR;
    const sl = this.stageL;
    const sr = this.stageR;

    // Stage 1: the delay head, mixed at balance A.
    this.delay.processBlock(inL, inR, wl, wr, count);
    const a = this.wetA;
    for (let n = 0; n < count; n++) {
      sl[n] = inL[n]! * (1 - a) + wl[n]! * a;
      sr[n] = inR[n]! * (1 - a) + wr[n]! * a;
    }

    // Stage 2: the tail, fed by stage 1 and mixed at balance B.
    switch (algo.tail) {
      case 'hall':
      case 'room':
      case 'earlyReflection':
        this.renderReverb(this.tailReverb, sl, sr, wl, wr, count);
        break;
      case 'delay':
        this.tailDelay.processBlock(sl, sr, wl, wr, count);
        break;
      default:
        this.tailMod.processBlock(sl, sr, wl, wr, count);
        break;
    }
    const b = this.wetB;
    for (let n = 0; n < count; n++) {
      outL[n] = sl[n]! * (1 - b) + wl[n]! * b;
      outR[n] = sr[n]! * (1 - b) + wr[n]! * b;
    }
  }

  /** Dispatch to the block that owns this algorithm, producing WET signal only. */
  private renderWet(
    algo: EffectAlgorithm,
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    count: number,
  ): void {
    switch (algo.kind) {
      case 'reverb':
      case 'earlyReflection':
        this.renderReverb(this.reverb, inL, inR, outL, outR, count);
        break;
      case 'delay':
        this.delay.processBlock(inL, inR, outL, outR, count);
        break;
      case 'modulation':
        this.mod.processBlock(inL, inR, outL, outR, count);
        break;
      case 'eq':
        for (let n = 0; n < count; n++) {
          outL[n] = this.eq3.processFrame(0, inL[n]!);
          outR[n] = this.eq3.processFrame(1, inR[n]!);
        }
        break;
      case 'drive':
        this.drive.processBlock(inL, inR, outL, outR, count);
        break;
      case 'exciter':
        this.exciter.processBlock(inL, inR, outL, outR, count);
        break;
      case 'symphonic':
        this.symphonic.processBlock(inL, inR, outL, outR, count);
        break;
      case 'rotary':
        this.rotary.processBlock(inL, inR, outL, outR, count);
        break;
      case 'delayPlus':
        break; // handled by processDelayPlus
    }
  }

  /** MONO-SUM IN, STEREO OUT — the reverbs' defining behaviour. */
  private renderReverb(
    rev: Reverb,
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    count: number,
  ): void {
    const pair = this.revOut;
    for (let n = 0; n < count; n++) {
      rev.process((inL[n]! + inR[n]!) * 0.5, pair);
      outL[n] = pair[0]!;
      outR[n] = pair[1]!;
    }
  }
}

/**
 * The whole effect section: two slots, the routing bit, and the output stage.
 */
export class EffectChain {
  private readonly slot1: EffectSlot;
  private readonly slot2: EffectSlot;
  private serial = true;
  private fx1L = true;
  private fx1R = true;
  private fx2L = true;
  private fx2R = true;

  private out3Pan = 0;
  private out4Pan = 0;

  private readonly midL = new Float32Array(MAX_FX_BLOCK);
  private readonly midR = new Float32Array(MAX_FX_BLOCK);
  private readonly dryL = new Float32Array(MAX_FX_BLOCK);
  private readonly dryR = new Float32Array(MAX_FX_BLOCK);
  /** Effect 2's own output in PARALLEL, before Pan 3/4 fold it back into the stereo pair. */
  private readonly cdL = new Float32Array(MAX_FX_BLOCK);
  private readonly cdR = new Float32Array(MAX_FX_BLOCK);
  private readonly dac: DacQuantizer;

  constructor(readonly sampleRate: number) {
    this.slot1 = new EffectSlot(sampleRate);
    this.slot2 = new EffectSlot(sampleRate);
    this.dac = new DacQuantizer();
  }

  reset(): void {
    this.slot1.reset();
    this.slot2.reset();
    this.dac.reset();
  }

  set(state: EffectsState): void {
    this.slot1.set(state.slots[0]);
    this.slot2.set(state.slots[1]);
    this.serial = state.serial;
    this.fx1L = state.fx1L;
    this.fx1R = state.fx1R;
    this.fx2L = state.fx2L;
    this.fx2R = state.fx2R;
    this.out3Pan = state.out3Pan;
    this.out4Pan = state.out4Pan;
  }

  /** Turn the 16-bit gain-ranged DAC model on or off. On is the hardware. */
  setDacModel(on: boolean): void {
    this.dac.enabled = on;
  }

  /** True when both slots are Through, so the caller can skip the whole section. */
  get isBypassed(): boolean {
    return !this.slot1.isActive && !this.slot2.isActive;
  }

  /**
   * Process in place, with buses C and D silent. Program mode's whole signal path.
   */
  process(l: Float32Array, r: Float32Array, count: number): void {
    this.processBuses(l, r, null, null, count);
  }

  /**
   * The full four-bus matrix. `a`/`b` carry the result out; `c`/`d` are read-only inputs and
   * may be null, which is Program mode.
   *
   * `count` must not exceed MAX_FX_BLOCK — the worklet subdivides.
   */
  processBuses(
    a: Float32Array,
    b: Float32Array,
    c: Float32Array | null,
    d: Float32Array | null,
    count: number,
  ): void {
    const n = Math.min(count, MAX_FX_BLOCK);
    // Keep the untouched input for the per-channel I/O bits, which bypass an effect for one
    // channel rather than muting it.
    this.dryL.set(a.subarray(0, n));
    this.dryR.set(b.subarray(0, n));

    this.slot1.process(a, b, this.midL, this.midR, n);
    applyBypass(this.midL, this.dryL, this.fx1L, n);
    applyBypass(this.midR, this.dryR, this.fx1R, n);

    if (this.serial) {
      // SERIAL. Manual p.36: "Inputs A and B send signals to both Effect 1 and Effect 2 and
      // are output from 1/L and 2/R. Signals from C and D are output through 3 and 4
      // unprocessed. The output signals from 3 and 4 can also be mixed with the A and B
      // inputs to be routed together through Effect 2." So C/D SKIP effect 1 and join at
      // effect 2's input through Pan 3 and Pan 4 — which is how a Combination gets "some
      // programs through effect 1, all of them through effect 2".
      mixPanned(this.midL, this.midR, c, this.out3Pan, n);
      mixPanned(this.midL, this.midR, d, this.out4Pan, n);
      this.dryL.set(this.midL.subarray(0, n));
      this.dryR.set(this.midR.subarray(0, n));
      this.slot2.process(this.midL, this.midR, a, b, n);
      applyBypass(a, this.dryL, this.fx2L, n);
      applyBypass(b, this.dryR, this.fx2R, n);
    } else {
      // PARALLEL. A,B stop at Effect 1; C,D get Effect 2 and come back through Pan 3/4.
      // A PROGRAM CANNOT REACH EFFECT 2 HERE and that is the hardware — it has no panpot
      // page, so C and D are silent and this branch contributes nothing. A COMBINATION can,
      // and that is the whole point of the panpot. Manual p.37 even gives the recipe:
      // "stereo out mixed outputs of Effect 1 and Effect 2 can be used by setting Output 3
      // Pan to 100:0, and Output 4 Pan to 0:100" — which 41 of Korg's 100 factory
      // combinations do exactly.
      a.set(this.midL.subarray(0, n));
      b.set(this.midR.subarray(0, n));
      if (c || d) {
        this.cdL.fill(0, 0, n);
        this.cdR.fill(0, 0, n);
        if (c) this.cdL.set(c.subarray(0, n));
        if (d) this.cdR.set(d.subarray(0, n));
        this.slot2.process(this.cdL, this.cdR, this.midL, this.midR, n);
        applyBypass(this.midL, this.cdL, this.fx2L, n);
        applyBypass(this.midR, this.cdR, this.fx2R, n);
        mixPanned(a, b, this.midL, this.out3Pan, n);
        mixPanned(a, b, this.midR, this.out4Pan, n);
      }
    }

    this.dac.process(a, b, n);
  }
}

/**
 * Fold one of outputs 3 and 4 into the main stereo pair at its pan setting.
 *
 * p.129: `0 = OFF, 1 = R, 2..100 = L:R ratio 1:99..99:1, 101 = L`. That whole range collapses
 * to one expression — `L = (v-1)/100, R = (101-v)/100` — with 0 meaning the output stays on
 * its own physical jack and never reaches the stereo pair. **OFF is therefore silent in a
 * browser, and that is authentic**: 37 of Korg's 100 factory combinations set both pans to 0
 * because they expected a mixer on outputs 3 and 4.
 */
function mixPanned(
  outL: Float32Array,
  outR: Float32Array,
  src: Float32Array | null,
  pan: number,
  count: number,
): void {
  if (!src || pan <= 0) return;
  const v = Math.min(101, pan);
  const gl = (v - 1) / 100;
  const gr = (101 - v) / 100;
  for (let i = 0; i < count; i++) {
    const s = src[i]!;
    outL[i] = outL[i]! + s * gl;
    outR[i] = outR[i]! + s * gr;
  }
}

/** Replace `buf` with `dry` when the channel's effect enable bit is clear. */
function applyBypass(buf: Float32Array, dry: Float32Array, enabled: boolean, count: number): void {
  if (enabled) return;
  buf.set(dry.subarray(0, count));
}

/**
 * The breathing noise floor — a 16-bit DAC behind a 3-bit analog gain range.
 *
 * BRIEF.md: "The DAC is 16-bit plus a 3-bit analog gain range, so quantization noise tracks
 * signal level — stepping down as a tail decays, up on the next transient. That is what 1988
 * reviewers heard as 'graininess on drums'." Confirmed by the service manual's DAC section.
 *
 * NO PRNG. CLAUDE.md is explicit: "derive it from the signal level, not from `Math.random`".
 * The absence of randomness in the signal path is what makes byte-exact golden-buffer tests
 * possible, and it is the sharpest test in the project — spending it for a dither effect
 * would be a bad trade. Quantization error IS the noise here, exactly as on the hardware:
 * the error is a deterministic function of the signal, and it is audible for the same reason.
 */
export class DacQuantizer {
  enabled = true;
  /** Slow peak follower that chooses the gain range. */
  private envelope = 0;
  /** Current range exponent, 0..7 (the 3 bits). */
  private range = 0;
  /** Frames until the range may step again — the ranging logic is not instantaneous. */
  private hold = 0;

  reset(): void {
    this.envelope = 0;
    this.range = 0;
    this.hold = 0;
  }

  process(l: Float32Array, r: Float32Array, count: number): void {
    if (!this.enabled) return;
    for (let n = 0; n < count; n++) {
      const peak = Math.max(Math.abs(l[n]!), Math.abs(r[n]!));
      // Fast attack, slow release: the range must jump up instantly on a transient or the
      // first milliseconds of every note clip, and fall back slowly or it chatters.
      this.envelope = peak > this.envelope ? peak : this.envelope * 0.99995 + peak * 0.00005;

      if (this.hold > 0) this.hold--;
      else {
        // Pick the smallest range that still contains the signal, capped at the 3 bits the
        // hardware has. Each step is 6 dB, and stepping is what makes the floor "breathe".
        let want = 0;
        let ref = 0.5;
        while (want < 7 && this.envelope < ref) {
          want++;
          ref *= 0.5;
        }
        if (want !== this.range) {
          this.range = want;
          this.hold = 256;
        }
      }

      // 16-bit conversion at the chosen range: quantize finely, then scale back out. The
      // residual error rides at 2^-range * 2^-15 of full scale.
      const scale = 32768 * Math.pow(2, this.range);
      l[n] = Math.round(l[n]! * scale) / scale;
      r[n] = Math.round(r[n]! * scale) / scale;
    }
  }
}
