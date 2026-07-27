/**
 * Offline render helpers — the reusable half of SynthStack's `factorySamples.ts`,
 * with its Moog drum kit stripped out.
 *
 * WHAT THIS IS FOR: multisounds 77–99 were *computed* DWGS waveforms on the M1, not
 * sampled, so Phase 1 renders them rather than sourcing them. Anything built from
 * stock nodes (OscillatorNode / GainNode / BiquadFilterNode / AudioBufferSourceNode)
 * renders into an OfflineAudioContext with no worklets involved.
 *
 * Two rules survive from the original, both learned the hard way:
 *   - `exponentialRampToValueAtTime` must NEVER target 0 — Web Audio throws and the
 *     whole offline render rejects. Ramp toward `MIN_RAMP` from a nonzero
 *     `setValueAtTime(peak, t)`.
 *   - Every source MUST be `.start()`-ed or it renders silence.
 *
 * The control-voltage scaling the original carried went with the patchbay: renders land
 * at ±1.0 float, the same convention a decoded sample uses.
 */

/** Trigger lead — sources fire at T0 so onset detectors have a zero run to lock onto. */
export const T0 = 0.1;

/** Floor for exponential ramps. Never ramp to 0. */
export const MIN_RAMP = 0.001;

/**
 * Fill `target` with white noise in [-1, 1). `rng` is REQUIRED — a defaulted
 * `Math.random` is exactly how nondeterminism leaks into a golden-buffer test.
 * Pass `mulberry32(seed)` from src/engine/rng.ts.
 */
export function fillWhiteNoise(target: Float32Array, rng: () => number): void {
  for (let i = 0; i < target.length; i++) target[i] = rng() * 2 - 1;
}

/**
 * Copy `raw` into a fresh ±1.0 mono buffer scaled by 1/peak, dropping the first
 * `startFrame` frames. Guards divide-by-zero on silence.
 *
 * `startFrame` trims the render's leading T0 silence so the returned buffer begins AT
 * the transient — otherwise every rendered sound plays T0 late wherever it is
 * triggered, and the gap repeats on every loop.
 */
export function normalizeToBuffer(
  ctx: BaseAudioContext,
  raw: Float32Array,
  sampleRate: number,
  startFrame = 0,
): AudioBuffer {
  const start = Math.min(Math.max(0, startFrame), raw.length);
  let peak = 0;
  for (let i = start; i < raw.length; i++) {
    const a = Math.abs(raw[i]!);
    if (a > peak) peak = a;
  }
  const norm = peak > 0 ? 1 / peak : 1;
  const len = Math.max(1, raw.length - start);
  const buffer = ctx.createBuffer(1, len, sampleRate);
  const out = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) out[i] = (raw[start + i] ?? 0) * norm;
  return buffer;
}

/** A single-use oscillator at `type`/`freq`, started at T0, stopped at T0 + durS. */
export function osc(
  ctx: BaseAudioContext,
  durS: number,
  type: OscillatorType,
  freq: number,
): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, T0);
  o.start(T0);
  o.stop(T0 + durS);
  return o;
}

/** A single-use noise source of `durS` seconds, started at T0. */
export function noiseSource(
  ctx: BaseAudioContext,
  durS: number,
  sampleRate: number,
  rng: () => number,
): AudioBufferSourceNode {
  const buffer = ctx.createBuffer(1, Math.ceil(durS * sampleRate), sampleRate);
  fillWhiteNoise(buffer.getChannelData(0), rng);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.start(T0);
  src.stop(T0 + durS);
  return src;
}

/** A gain node with a percussive decay: set(peak, T0) → expRamp(MIN_RAMP, T0 + decayS). */
export function decayGain(ctx: BaseAudioContext, peak: number, decayS: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, T0);
  g.gain.exponentialRampToValueAtTime(MIN_RAMP, T0 + decayS);
  return g;
}

/** A spec builds its node graph into `ctx` and returns the node to capture. */
export type OfflineBuild = (ctx: OfflineAudioContext, durS: number) => AudioNode;

/**
 * Render one stock-node graph to a peak-normalized ±1.0 mono buffer, with the T0
 * lead trimmed off the front. No worklets — a stock-node graph needs none, which is
 * what keeps this usable from a plain Node build script.
 */
export async function renderOffline(
  build: OfflineBuild,
  durS: number,
  sampleRate: number,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.ceil((T0 + durS) * sampleRate), sampleRate);
  build(ctx, durS).connect(ctx.destination);
  const rendered = await ctx.startRendering();
  return normalizeToBuffer(
    ctx,
    rendered.getChannelData(0),
    sampleRate,
    Math.round(T0 * sampleRate),
  );
}
