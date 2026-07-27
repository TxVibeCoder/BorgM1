/**
 * The sample bake pipeline — PURE, no Web Audio types, Node-testable.
 *
 * Composes the individual cores in the ONE order that works. Each step consumes signal a
 * later step would otherwise find missing, so the ordering is the actual content of this
 * file; the arithmetic all lives in the cores it calls.
 *
 *   1. REBASE     absolute SF2 offsets -> indices into this sample
 *   2. RESAMPLE   full data, loop length scaled by the same ratio
 *   3. NORMALIZE  peak, per multisound
 *   4. CROSSFADE  bake the seam
 *   5. TRUNCATE   cut at loopEnd, append the 4-sample guard
 *   6. INT16      convert
 *
 * Why not truncate early (it would make everything after it faster): the resampler's
 * kernel and the crossfade's read window both reach past `loopEnd` into the release tail.
 * Cut first and both silently read zeros, which puts a notch right at the seam — the exact
 * defect this pipeline exists to prevent, arrived at by "optimising".
 */

import {
  bakeLoopCrossfade,
  isLoopValid,
  LOOP_GUARD_SAMPLES,
  rebaseLoop,
  truncateWithGuard,
  type LoopRegion,
} from './loopCore';
import { floatToInt16, normalizeInPlace } from './pcmCore';
import { DEFAULT_HALF_WIDTH, resample, scaleLoop } from './resampleCore';

/**
 * Target bank rate. A TUNABLE CONSTANT, not a Korg specification — two independent
 * derivations bracket the hardware's real rate (~31.2 kHz from PCM-card capacity, and
 * <= 32,768 Hz from the effects RAM, where 32.768 makes 500 ms exactly 2^14 words and
 * partitions memory into four clean 16K blocks). Neither is documented. The band-limiting
 * this imposes IS a large part of the M1 sound, so treat this as a character control.
 */
export const DEFAULT_BANK_RATE = 32000;

/** Default loop crossfade length, in samples at the BANK rate (~6 ms at 32 kHz). */
export const DEFAULT_CROSSFADE = 192;

/** One sample as it arrives from the source file, before any processing. */
export interface RawSample {
  /** Float samples in [-1, 1], the FULL extracted sample including any release tail. */
  data: Float32Array;
  sampleRate: number;
  /** Absolute SF2 offsets. Ignored when `looped` is false. */
  dwStart: number;
  dwStartloop: number;
  dwEndloop: number;
  looped: boolean;
}

/** One baked sample, ready to serialize into the bank. */
export interface BakedSample {
  pcm: Int16Array;
  sampleRate: number;
  /** -1 when the sample is a one-shot. */
  loopStart: number;
  /** -1 when the sample is a one-shot. */
  loopEnd: number;
  /** Samples actually crossfaded (may be less than requested, or 0). */
  crossfadeApplied: number;
  /** Guard samples appended after loopEnd; 0 for a one-shot. */
  guard: number;
}

export interface BakeOptions {
  targetRate?: number;
  crossfade?: number;
  /** Peak-normalize target, or null to leave levels untouched. */
  normalizeTo?: number | null;
  resamplerHalfWidth?: number;
}

export function bakeSample(raw: RawSample, options: BakeOptions = {}): BakedSample {
  const targetRate = options.targetRate ?? DEFAULT_BANK_RATE;
  const crossfade = options.crossfade ?? DEFAULT_CROSSFADE;
  const normalizeTo = options.normalizeTo === undefined ? 0.99 : options.normalizeTo;
  const halfWidth = options.resamplerHalfWidth ?? DEFAULT_HALF_WIDTH;

  // 1. REBASE — before anything touches the data, so a bad region is caught on the
  //    original indices where the numbers are still comparable to the file.
  let region: LoopRegion | null = null;
  if (raw.looped) {
    const rebased = rebaseLoop(raw.dwStart, raw.dwStartloop, raw.dwEndloop);
    region = isLoopValid(rebased, raw.data.length) ? rebased : null;
  }

  // 2. RESAMPLE the FULL data (tail included — see the header note).
  const ratio = targetRate / raw.sampleRate;
  const data = resample(raw.data, raw.sampleRate, targetRate, halfWidth);
  if (region) {
    const scaled = scaleLoop(region.loopStart, region.loopEnd, ratio);
    // Re-validate: rounding can push loopEnd past the resampled length by a sample.
    region = isLoopValid(scaled, data.length)
      ? scaled
      : isLoopValid({ ...scaled, loopEnd: Math.min(scaled.loopEnd, data.length) }, data.length)
        ? { ...scaled, loopEnd: Math.min(scaled.loopEnd, data.length) }
        : null;
  }

  // 3. NORMALIZE before the crossfade so the fade blends already-final levels.
  if (normalizeTo !== null) normalizeInPlace(data, normalizeTo);

  // One-shot: no loop, no fade, no guard. Done.
  if (!region) {
    return {
      pcm: floatToInt16(data),
      sampleRate: targetRate,
      loopStart: -1,
      loopEnd: -1,
      crossfadeApplied: 0,
      guard: 0,
    };
  }

  // 4. CROSSFADE the seam.
  const crossfadeApplied = bakeLoopCrossfade(data, region, crossfade);

  // 5. TRUNCATE + GUARD.
  const out = truncateWithGuard(data, region);

  return {
    pcm: floatToInt16(out),
    sampleRate: targetRate,
    loopStart: region.loopStart,
    loopEnd: region.loopEnd,
    crossfadeApplied,
    guard: LOOP_GUARD_SAMPLES,
  };
}
