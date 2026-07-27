/**
 * Loop preparation — PURE, no Web Audio types, Node-testable.
 *
 * Three jobs, in a strict order that matters:
 *   1. REBASE  SF2 loop offsets are absolute indices into the file's single global sample
 *              chunk, not into the individual sample. Subtract `dwStart` per sample or
 *              every loop points somewhere in a different instrument.
 *   2. CROSSFADE  blend the material approaching `loopEnd` into the material approaching
 *              `loopStart`, so the wrap is continuous instead of a step.
 *   3. GUARD   append 4 samples after `loopEnd` holding the first 4 loop samples, so a
 *              4-point interpolator can read past the wrap without a branch in the
 *              per-sample path.
 *
 * The ordering constraint the whole file exists to enforce: resample BEFORE crossfading,
 * crossfade BEFORE truncating. Each step consumes signal the next one would otherwise
 * find missing.
 */

/**
 * Samples appended after `loopEnd`, holding copies of the first loop samples.
 *
 * WHY 4, and why a copy rather than a branch: playback uses 4-point cubic Hermite, which
 * reads `[i-1, i, i+1, i+2]`. With the phase sitting just below `loopEnd`, `i+1` and `i+2`
 * land past the end, and the correct values there are the ones the loop is about to wrap
 * to. Two would cover an increment of exactly 1; 4 covers playing the sample back at up to
 * roughly double speed (an octave up) before the wrap is applied. Materialising them costs
 * 8 bytes a sample and removes a conditional from the innermost loop in the engine.
 */
export const LOOP_GUARD_SAMPLES = 4;

export interface LoopRegion {
  /** First sample of the loop, inclusive. */
  loopStart: number;
  /**
   * One PAST the last sample of the loop, matching the SF2 convention: playback runs
   * ... loopEnd-1 and then wraps to loopStart, so the loop length is loopEnd - loopStart.
   * Treating it as inclusive repeats one sample per cycle — a slow, tiny pitch error that
   * is maddening to trace back from "the sustain sounds a hair flat".
   */
  loopEnd: number;
}

/**
 * Rebase absolute SF2 loop offsets onto a single extracted sample.
 *
 * `dwStart` / `dwStartloop` / `dwEndloop` come straight from the SF2 sample header, where
 * every offset is measured from the start of the whole `smpl` chunk.
 */
export function rebaseLoop(dwStart: number, dwStartloop: number, dwEndloop: number): LoopRegion {
  return { loopStart: dwStartloop - dwStart, loopEnd: dwEndloop - dwStart };
}

/** True when a rebased region is usable: inside the data, non-empty, correctly ordered. */
export function isLoopValid(region: LoopRegion, sampleLength: number): boolean {
  const { loopStart, loopEnd } = region;
  return (
    Number.isInteger(loopStart) &&
    Number.isInteger(loopEnd) &&
    loopStart >= 0 &&
    loopEnd > loopStart &&
    loopEnd <= sampleLength
  );
}

/**
 * Largest crossfade that fits, given where the loop sits.
 *
 * Bounded by two things: the material available BEFORE `loopStart` (the fade reads from
 * there, and reading before index 0 would pull in silence and punch a hole in the seam),
 * and the loop length itself (the fade writes inside the loop, and a fade longer than the
 * loop would wrap onto its own output).
 */
export function maxCrossfade(region: LoopRegion): number {
  return Math.max(0, Math.min(region.loopStart, region.loopEnd - region.loopStart));
}

/**
 * Bake a crossfade across the loop seam, in place, returning the samples actually faded.
 *
 * For each of the last `xf` samples of the loop, blend in the sample the same distance
 * before `loopStart`. By the final sample the output has become what precedes `loopStart`,
 * so wrapping to `loopStart` continues the waveform instead of stepping.
 *
 * LINEAR (equal-gain), not equal-power. The two regions being blended are the same
 * sustained tone one loop-period apart, so they are strongly correlated — and summing
 * correlated signals under an equal-power (sin/cos) pair produces a bulge of up to +3 dB
 * through the middle of the fade, audible as a periodic swell at exactly the loop rate.
 * Equal-gain holds the level flat for correlated material. LABEL THIS A CHOICE: it is the
 * right default for pitched loops, not a fact about the M1.
 */
export function bakeLoopCrossfade(
  data: Float32Array,
  region: LoopRegion,
  requestedFade: number,
): number {
  const xf = Math.min(Math.max(0, Math.floor(requestedFade)), maxCrossfade(region));
  if (xf === 0) return 0;
  const { loopStart, loopEnd } = region;

  // Snapshot the source material first: the write region and the read region can overlap
  // when the fade is as long as the loop, and blending from already-blended samples would
  // smear the fade into itself.
  const pre = data.slice(loopStart - xf, loopStart);

  for (let i = 0; i < xf; i++) {
    const t = (i + 1) / xf; // (0, 1] — at t=1 the output IS the pre-loop material
    const w = loopEnd - xf + i;
    data[w] = data[w]! * (1 - t) + pre[i]! * t;
  }
  return xf;
}

/**
 * Cut a looped sample down to `loopEnd` and append the guard region.
 *
 * Everything after `loopEnd` is discarded: a looped multisound repeats until the amp
 * envelope releases it, so the original release tail is never reached and only costs
 * bank size. Do this LAST — the discarded tail is real signal that the resampler and the
 * crossfade both want to see.
 */
export function truncateWithGuard(data: Float32Array, region: LoopRegion): Float32Array {
  const { loopStart, loopEnd } = region;
  const loopLength = loopEnd - loopStart;
  const out = new Float32Array(loopEnd + LOOP_GUARD_SAMPLES);
  out.set(data.subarray(0, loopEnd));
  for (let i = 0; i < LOOP_GUARD_SAMPLES; i++) {
    // Modulo the loop length so a loop shorter than the guard still wraps correctly
    // rather than reading past its own end.
    out[loopEnd + i] = data[loopStart + (i % loopLength)]!;
  }
  return out;
}

/**
 * Wrap discontinuity, measured in units of the sample's OWN steepest local step.
 *
 * This is the Phase 1 gate's measurement. It compares the jump playback actually takes at
 * the wrap (`loopEnd-1` -> `loopStart`) against the largest adjacent-sample step just
 * inside the loop. Self-relative on purpose: an absolute threshold fails every bright
 * sample and passes every quiet one, because a loud 5 kHz tone moves further between
 * consecutive samples than a quiet 200 Hz one does at a genuine cut.
 *
 * READING THE SCALE — it does not bottom out at 0:
 *   ~1  a perfect loop. The wrap still moves one sample's worth, because that is what the
 *       next sample was always going to do. On a sine whose loop lands on an exact cycle
 *       the wrap sits at the zero crossing, the steepest point, so the ratio is ~1.0.
 *   <2  indistinguishable from ordinary sample-to-sample motion. Passing.
 *   >5  a real step. Audible as a click at the loop rate.
 */
export function loopSeamDiscontinuity(data: Float32Array, region: LoopRegion): number {
  const { loopStart, loopEnd } = region;
  const last = data[loopEnd - 1]!;
  const first = data[loopStart]!;
  const step = Math.abs(first - last);
  // Typical adjacent-sample step just inside the loop, as the scale to judge against.
  let localMax = 0;
  const window = Math.min(64, loopEnd - loopStart - 1);
  for (let i = 0; i < window; i++) {
    const a = data[loopEnd - 2 - i];
    const b = data[loopEnd - 1 - i];
    if (a === undefined || b === undefined) break;
    const d = Math.abs(b - a);
    if (d > localMax) localMax = d;
  }
  // A wrap step no larger than the sample's own steepest local move is not a seam.
  if (localMax === 0) return step;
  return step / localMax;
}
