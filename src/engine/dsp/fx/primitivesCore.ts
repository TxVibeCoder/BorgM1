/**
 * Shared building blocks for the effect section. PURE — no Web Audio types, Node-testable.
 *
 * Everything here preallocates in its constructor and allocates NOTHING per block, because
 * all of it runs inside the voice worklet's `process()` (CLAUDE.md).
 *
 * THE HARDWARE BUDGET IS REAL AND IT SHAPES THESE. The service manual identifies the effects
 * chip as an MB87405 "MDE" with a 65,536-word x 20-bit delay RAM. At ~32 kHz that is about
 * 2.05 seconds of TOTAL delay memory shared by both effect slots — which is exactly why the
 * longest delay the parameter set can ask for is 500 ms and why the reverbs are mono-sum in.
 * The tunings below are sized to fit that budget rather than to be as lush as possible.
 */

/**
 * A fractional-delay line with 4-point cubic Hermite interpolation.
 *
 * SAME INTERPOLATOR AS THE SAMPLE PLAYER, and for the same reason (DECISIONS.md, Phase 0):
 * 44 dB of image rejection at 4x against linear's 34. It matters more here than it looks,
 * because a chorus sweeps its read pointer continuously — linear interpolation puts a
 * level-dependent lowpass on the wet path that moves with the LFO, which is audible as a
 * dullness that breathes.
 */
export class DelayLine {
  private readonly buf: Float32Array;
  private readonly mask: number;
  private write = 0;

  /** `maxDelaySamples` is rounded up to a power of two so the wrap is a mask, not a modulo. */
  constructor(maxDelaySamples: number) {
    // +4 for the interpolator's reach, exactly like the sample bank's guard region.
    const need = Math.max(8, Math.ceil(maxDelaySamples) + 4);
    let size = 1;
    while (size < need) size <<= 1;
    this.buf = new Float32Array(size);
    this.mask = size - 1;
  }

  get capacity(): number {
    return this.buf.length - 4;
  }

  reset(): void {
    this.buf.fill(0);
    this.write = 0;
  }

  /** Push one sample. Call exactly once per frame, after every `read` for that frame. */
  push(x: number): void {
    this.write = (this.write + 1) & this.mask;
    this.buf[this.write] = x;
  }

  /** Read `delay` samples back (fractional, >= 1). */
  read(delay: number): number {
    const d = Math.min(this.capacity, Math.max(1, delay));
    const i = Math.floor(d);
    const f = d - i;
    const b = this.buf;
    const m = this.mask;
    const w = this.write;
    // y0 is one sample NEWER than the integer tap, which is what the 4-point kernel needs.
    const y0 = b[(w - i + 1) & m]!;
    const y1 = b[(w - i) & m]!;
    const y2 = b[(w - i - 1) & m]!;
    const y3 = b[(w - i - 2) & m]!;
    // Catmull-Rom, evaluated at (1 - f) because the tap runs backwards through the buffer.
    const t = 1 - f;
    const c0 = y1;
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * t + c2) * t + c1) * t + c0;
  }

  /** Integer read, for taps that never move. Cheaper and exact. */
  readInt(delay: number): number {
    const d = Math.min(this.capacity, Math.max(0, Math.round(delay)));
    return this.buf[(this.write - d) & this.mask]!;
  }
}

/** One-pole lowpass. The damping element in every comb and delay feedback path. */
export class OnePole {
  private z = 0;
  /** 0 = wide open (no damping), approaching 1 = heavily damped. */
  private a = 0;

  setDamping(amount01: number): void {
    this.a = Math.min(0.98, Math.max(0, amount01));
  }

  /** Set by corner frequency instead, for the EQ and exciter paths. */
  setCutoff(hz: number, sampleRate: number): void {
    const w = (2 * Math.PI * Math.min(hz, sampleRate * 0.45)) / sampleRate;
    this.a = Math.max(0, Math.min(0.999, 1 - Math.min(1, w)));
  }

  reset(): void {
    this.z = 0;
  }

  process(x: number): number {
    this.z = x * (1 - this.a) + this.z * this.a;
    return this.z;
  }

  /** The complementary highpass, free once the lowpass state exists. */
  processHighpass(x: number): number {
    return x - this.process(x);
  }
}

/** Schroeder allpass — the diffuser that turns a comb bank into a reverb tail. */
export class Allpass {
  private readonly line: DelayLine;
  private readonly delay: number;

  constructor(delaySamples: number, private g = 0.5) {
    this.delay = Math.max(1, Math.round(delaySamples));
    this.line = new DelayLine(this.delay + 4);
  }

  reset(): void {
    this.line.reset();
  }

  process(x: number): number {
    const d = this.line.readInt(this.delay);
    const v = x + this.g * d;
    this.line.push(v);
    return d - this.g * v;
  }
}

/** Damped feedback comb — the energy store that sets reverb time. */
export class DampedComb {
  private readonly line: DelayLine;
  private readonly lp = new OnePole();
  private feedback = 0;

  constructor(readonly delaySamples: number) {
    this.line = new DelayLine(delaySamples + 4);
  }

  /**
   * Feedback from the requested RT60. `g = 10^(-3 D / RT60)` is the standard Schroeder
   * relation: it is exactly the gain that makes D seconds of round trip lose 60 dB over
   * RT60 seconds. Capped just under 1 so a 9.9 s tail on a short comb still decays.
   */
  setReverbTime(rt60S: number, sampleRate: number): void {
    const d = this.delaySamples / sampleRate;
    const rt = Math.max(0.05, rt60S);
    this.feedback = Math.min(0.9995, Math.pow(10, (-3 * d) / rt));
  }

  setDamping(amount01: number): void {
    this.lp.setDamping(amount01);
  }

  reset(): void {
    this.line.reset();
    this.lp.reset();
  }

  process(x: number): number {
    const y = this.line.readInt(this.delaySamples);
    this.line.push(x + this.lp.process(y) * this.feedback);
    return y;
  }
}

/**
 * The effect section's LFO.
 *
 * WAVEFORM IS SIN OR TRI ONLY — p.129 note `*11-3-3` bit0. That is a different and smaller
 * set than the program MGs' four waveforms in `mgCore.ts`, which is why this is its own
 * generator rather than a reuse: sharing them would invite someone to "unify" the two and
 * quietly give the chorus a sawtooth the hardware never had.
 *
 * `shape` skews the waveform, for Tremolo's SHAPE parameter (-99..99). At 0 the wave is
 * unmodified; positive values push it toward a squarer shape and negative toward a spikier
 * one. THE CURVE IS A CHOICE — the manual says only "changing the modulation waveform".
 */
export class EffectLfo {
  /** Normalised phase 0..1. */
  private phase = 0;
  private inc = 0;
  private triangle = false;
  private shapeAmount = 0;

  setRate(hz: number, sampleRate: number): void {
    this.inc = Math.max(0, hz) / Math.max(1, sampleRate);
  }

  setWaveform(triangle: boolean): void {
    this.triangle = triangle;
  }

  /** -1..1. Tremolo's SHAPE; 0 leaves the waveform alone. */
  setShape(shape: number): void {
    this.shapeAmount = Math.min(1, Math.max(-1, shape));
  }

  reset(phase01 = 0): void {
    this.phase = phase01 - Math.floor(phase01);
  }

  /** Advance by `frames` and return the value at the END of that span, in -1..1. */
  advance(frames: number): number {
    this.phase += this.inc * frames;
    this.phase -= Math.floor(this.phase);
    return this.valueAt(this.phase);
  }

  /** The value `offset01` of a cycle away from the current phase — the 180 deg partner. */
  valueOffset(offset01: number): number {
    let p = this.phase + offset01;
    p -= Math.floor(p);
    return this.valueAt(p);
  }

  private valueAt(p: number): number {
    let v: number;
    if (this.triangle) {
      // 0 -> 0, 0.25 -> 1, 0.75 -> -1, matching the sine's phase so switching waveform
      // does not jump the modulation.
      v = p < 0.25 ? p * 4 : p < 0.75 ? 2 - p * 4 : p * 4 - 4;
    } else {
      v = Math.sin(2 * Math.PI * p);
    }
    return this.shapeAmount === 0 ? v : shapeWave(v, this.shapeAmount);
  }
}

/**
 * Skew a -1..1 waveform. A CHOICE, not an M1 fact (see EffectLfo.setShape).
 *
 * Positive `amount` drives the wave toward a square by scaling then clipping — the tremolo
 * gets a harder on/off edge. Negative rounds it toward a narrower pulse by raising it to a
 * power, which thins the peaks. Both are continuous at `amount = 0`.
 */
export function shapeWave(v: number, amount: number): number {
  if (amount > 0) {
    const drive = 1 + amount * 8;
    return Math.max(-1, Math.min(1, v * drive));
  }
  const p = 1 + -amount * 3;
  return Math.sign(v) * Math.pow(Math.abs(v), p);
}

/**
 * A first-order allpass section, the phaser's element. `coefficient` places the pole, and
 * sweeping it is what moves the notches.
 */
export class AllpassSection {
  private z = 0;
  private a = 0;

  /** Place the 90-degree point at `hz`. */
  setFrequency(hz: number, sampleRate: number): void {
    const t = Math.tan(Math.PI * Math.min(0.49, Math.max(1e-5, hz / sampleRate)));
    this.a = (t - 1) / (t + 1);
  }

  reset(): void {
    this.z = 0;
  }

  process(x: number): number {
    const y = this.a * x + this.z;
    this.z = x - this.a * y;
    return y;
  }
}

/** Equal-power-ish pan from a 0..1 position. Used by the tremolo's auto-pan. */
export function panGains(pos01: number): [number, number] {
  const p = Math.min(1, Math.max(0, pos01)) * (Math.PI / 2);
  return [Math.cos(p), Math.sin(p)];
}

/** Convert a 0..99 "damp" parameter to a one-pole coefficient. A CHOICE — the taper is ours. */
export function dampToCoefficient(damp099: number): number {
  return Math.min(0.95, Math.max(0, damp099 / 99) * 0.95);
}

/** Convert a 0..99 depth to 0..1. */
export function unit99(v: number): number {
  return Math.min(1, Math.max(0, v / 99));
}

/** Convert a -99..99 signed parameter to -1..1. */
export function signed99(v: number): number {
  return Math.min(1, Math.max(-1, v / 99));
}

/** dB to linear gain. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}
