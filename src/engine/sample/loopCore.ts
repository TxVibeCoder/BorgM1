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
 * the wrap (`loopEnd-1` -> `loopStart`) against the largest adjacent-sample step anywhere
 * in the loop. Self-relative on purpose: an absolute threshold fails every bright sample
 * and passes every quiet one, because a loud 5 kHz tone moves further between consecutive
 * samples than a quiet 200 Hz one does at a genuine cut.
 *
 * The question it actually asks is "is the move at the wrap UNUSUAL for this waveform?" —
 * which is why the scale comes from the whole loop. A square wave steps from rail to rail
 * once per cycle, so a step at the wrap is only a defect if it is bigger than that.
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
  const loopLength = loopEnd - loopStart;
  if (loopLength < 2) return step;

  // Steepest adjacent-sample step anywhere IN THE LOOP — the waveform's own character.
  //
  // Scanning the WHOLE loop, not just the tail. A square, saw or pulse is flat across most
  // of its cycle and steps hugely once at its edge; measuring the scale from the last few
  // dozen samples usually misses that edge entirely, under-reads the natural step size by
  // orders of magnitude, and reports a mathematically exact single-cycle table as badly
  // broken. Found exactly that way — the first three failures of this gate on a real build
  // were the square, saw and comb tables, all of which are periodic by construction.
  let localMax = 0;
  for (let i = loopStart + 1; i < loopEnd; i++) {
    const d = Math.abs(data[i]! - data[i - 1]!);
    if (d > localMax) localMax = d;
  }
  // A perfectly flat loop (digital silence) with a step at the wrap is infinitely bad;
  // with no step it is fine.
  if (localMax === 0) return step === 0 ? 0 : Infinity;
  return step / localMax;
}
