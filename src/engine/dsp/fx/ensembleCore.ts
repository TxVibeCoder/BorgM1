/**
 * Symphonic Ensemble (24) and Rotary Speaker (25). PURE, Node-testable.
 *
 * These two are grouped because the hardware groups them: they are the only algorithms whose
 * presence BARS others. M1R manual p.57, verbatim: "When using an effect marked with an
 * asterisk (*) for one of the effects, neither #24 SYMPHONIC ENS nor #25 ROTARY SPEAKER can
 * be selected for the other one." They are the two that ate the whole DSP budget, which is
 * also the clue to what they are internally — many more modulated taps than a chorus.
 *
 * BOTH ARE MONO-SUM IN, STEREO OUT (BRIEF.md).
 *
 * Both have exactly one depth control and no speed control (Rotary has a speed RATIO, not a
 * rate), so every rate below is a CHOICE. They are collected at the top for the A/B to move.
 */

import { EffectEq } from './eqCore';
import { DelayLine, EffectLfo, OnePole, panGains, unit99 } from './primitivesCore';

// ---- the labelled choices ----------------------------------------------------------------

/** Symphonic Ensemble voice rates, Hz. A CHOICE — deliberately non-harmonic so the voices
 *  never re-align into a single audible sweep. Six voices is what makes it "symphonic"
 *  rather than a chorus, and is consistent with it being one of the two DSP-hungry ones. */
const ENSEMBLE_RATES = [0.14, 0.19, 0.27, 0.33, 0.41, 0.53];
/** Base delay per ensemble voice, ms. A CHOICE. */
const ENSEMBLE_BASE_MS = [11, 14, 17, 20, 23, 26];
/** Peak deviation at DEPTH 99, ms. A CHOICE. */
const ENSEMBLE_DEPTH_MS = 4;

/** Rotor (low horn) base rate at SPEED RATE 0, Hz. A CHOICE — a fast-setting Leslie. */
const ROTARY_ROTOR_HZ = 5.0;
/** Horn (high) base rate at SPEED RATE 0, Hz. A CHOICE. */
const ROTARY_HORN_HZ = 6.0;
/** Crossover between rotor and horn bands, Hz. A CHOICE — a real Leslie sits near 800. */
const ROTARY_CROSSOVER_HZ = 800;
/** Doppler delay swing at full depth, ms. A CHOICE. */
const ROTARY_DOPPLER_MS = 1.4;

/** Symphonic Ensemble — a six-voice modulated-delay bank across a mono-summed input. */
export class SymphonicEnsemble {
  private readonly lines: DelayLine[] = [];
  private readonly lfos: EffectLfo[] = [];
  private readonly eq = new EffectEq();
  private depth01 = 0;
  private readonly prev: number[] = [];

  constructor(readonly sampleRate: number) {
    const perMs = sampleRate / 1000;
    for (let i = 0; i < ENSEMBLE_RATES.length; i++) {
      this.lines.push(new DelayLine((ENSEMBLE_BASE_MS[i]! + ENSEMBLE_DEPTH_MS + 2) * perMs));
      const lfo = new EffectLfo();
      lfo.setRate(ENSEMBLE_RATES[i]!, sampleRate);
      // Stagger the starting phases so the voices are spread through the cycle from the
      // first sample rather than all sweeping together until they drift apart.
      lfo.reset(i / ENSEMBLE_RATES.length);
      this.lfos.push(lfo);
      this.prev.push(0);
    }
  }

  reset(): void {
    for (const l of this.lines) l.reset();
    this.eq.reset();
  }

  set(p: { depth: number; eqLowDb: number; eqHighDb: number }): void {
    this.depth01 = unit99(p.depth);
    this.eq.set(p.eqLowDb, p.eqHighDb, this.sampleRate);
  }

  processBlock(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    count: number,
  ): void {
    const perMs = this.sampleRate / 1000;
    const swing = ENSEMBLE_DEPTH_MS * this.depth01 * perMs;
    const n0 = this.lines.length;

    // One LFO evaluation per block, interpolated across it — same rule as the modulation
    // block, and the reason a control-block-sized `count` is expected.
    const ends: number[] = [];
    for (let i = 0; i < n0; i++) ends.push(this.lfos[i]!.advance(count));

    for (let n = 0; n < count; n++) {
      const mono = (inL[n]! + inR[n]!) * 0.5;
      let l = 0;
      let r = 0;
      for (let i = 0; i < n0; i++) {
        const t = (n + 1) / count;
        const m = this.prev[i]! + (ends[i]! - this.prev[i]!) * t;
        const d = Math.max(1, ENSEMBLE_BASE_MS[i]! * perMs + swing * m);
        const v = this.lines[i]!.read(d);
        this.lines[i]!.push(mono);
        // Alternate voices to opposite sides — the stereo spread IS the ensemble effect.
        const [gl, gr] = panGains(i % 2 === 0 ? 0.15 : 0.85);
        l += v * gl;
        r += v * gr;
      }
      const norm = 1 / Math.sqrt(n0);
      outL[n] = this.eq.processFrame(0, l * norm);
      outR[n] = this.eq.processFrame(1, r * norm);
    }
    for (let i = 0; i < n0; i++) this.prev[i] = ends[i]!;
  }
}

/**
 * Rotary Speaker — a two-band rotating-source model.
 *
 * The horn (above the crossover) and the rotor (below it) turn at DIFFERENT rates, which is
 * exactly what the one exposed parameter controls: `Speed Rate -10..10` is "ratio of rotation
 * speed of high range / low range speaker". There is deliberately no absolute rate control,
 * so the base rates are a CHOICE.
 *
 * Each band gets amplitude modulation (the horn sweeping past the listener) and a small
 * delay modulation (Doppler), panned in opposition.
 */
export class RotarySpeaker {
  /** The crossover. One pole, and the horn band is its COMPLEMENT — see processBlock. */
  private readonly split = new OnePole();
  private readonly hornLine: DelayLine;
  private readonly rotorLine: DelayLine;
  private readonly hornLfo = new EffectLfo();
  private readonly rotorLfo = new EffectLfo();
  private depth01 = 0;
  private prevHorn = 0;
  private prevRotor = 0;

  constructor(readonly sampleRate: number) {
    const perMs = sampleRate / 1000;
    this.hornLine = new DelayLine((ROTARY_DOPPLER_MS * 2 + 2) * perMs);
    this.rotorLine = new DelayLine((ROTARY_DOPPLER_MS * 2 + 2) * perMs);
    // The two bands start a quarter turn apart, as two physical rotors would.
    this.hornLfo.reset(0);
    this.rotorLfo.reset(0.25);
    this.split.setCutoff(ROTARY_CROSSOVER_HZ, sampleRate);
  }

  reset(): void {
    this.hornLine.reset();
    this.rotorLine.reset();
    this.split.reset();
  }

  /** `speedRate` is the raw -10..10 display value. */
  set(p: { depth: number; speedRate: number }): void {
    this.depth01 = unit99(p.depth);
    // The ratio pushes the two rates apart symmetrically, so 0 leaves them at their bases
    // and +10 spins the horn about 40% faster than nominal while the rotor slows to match.
    const k = Math.pow(2, Math.min(10, Math.max(-10, p.speedRate)) / 20);
    this.hornLfo.setRate(ROTARY_HORN_HZ * k, this.sampleRate);
    this.rotorLfo.setRate(ROTARY_ROTOR_HZ / k, this.sampleRate);
  }

  processBlock(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    count: number,
  ): void {
    const perMs = this.sampleRate / 1000;
    const swing = ROTARY_DOPPLER_MS * this.depth01 * perMs;
    const hornEnd = this.hornLfo.advance(count);
    const rotorEnd = this.rotorLfo.advance(count);
    const hornStep = (hornEnd - this.prevHorn) / count;
    const rotorStep = (rotorEnd - this.prevRotor) / count;
    const base = ROTARY_DOPPLER_MS * perMs + 2;

    for (let n = 0; n < count; n++) {
      const mono = (inL[n]! + inR[n]!) * 0.5;
      const h = this.prevHorn + hornStep * (n + 1);
      const rr = this.prevRotor + rotorStep * (n + 1);

      // Split into two bands. The lowpass is the rotor's; its complement is the horn's, so
      // the two always reconstruct to the input when the modulation is off.
      const low = this.split.process(mono);
      const high = mono - low;

      const hv = this.hornLine.read(Math.max(1, base + swing * h));
      this.hornLine.push(high);
      const rv = this.rotorLine.read(Math.max(1, base + swing * rr));
      this.rotorLine.push(low);

      // Amplitude modulation plus opposed panning: the source swings across the image.
      const hAm = 1 - this.depth01 * 0.5 * (1 - (h + 1) * 0.5);
      const rAm = 1 - this.depth01 * 0.35 * (1 - (rr + 1) * 0.5);
      const [hl, hr] = panGains(0.5 + h * 0.45 * this.depth01);
      const [rl, rrr] = panGains(0.5 + rr * 0.3 * this.depth01);

      outL[n] = hv * hAm * hl + rv * rAm * rl;
      outR[n] = hv * hAm * hr + rv * rAm * rrr;
    }
    this.prevHorn = hornEnd;
    this.prevRotor = rotorEnd;
  }
}
