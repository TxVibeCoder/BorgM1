/**
 * Sample-rate conversion — PURE, no Web Audio types, Node-testable.
 *
 * Windowed-sinc (Blackman) interpolation. This runs at BUILD TIME, once per sample, so
 * quality is worth far more than speed here: the ~32 kHz band-limiting IS a large part of
 * the M1's character, and an aliased downsample would bake artefacts into every note the
 * instrument can play. A cheap linear or cubic resampler would be ~40 dB worse and there
 * is no runtime budget being spent to avoid it.
 *
 * ANTI-ALIAS ON THE WAY DOWN. When `outRate < inRate` the kernel cutoff moves to the
 * OUTPUT Nyquist, not the input's — otherwise everything between the two Nyquists folds
 * back as inharmonic aliasing. This is the whole reason to resample properly rather than
 * decimate. The kernel widens in input samples by the same factor, so the tap count per
 * output sample is preserved.
 */

/** Zero-crossings of sinc retained either side of centre. 32 is transparent for audio. */
export const DEFAULT_HALF_WIDTH = 32;

/** sinc(x) = sin(pi x) / (pi x), with the removable singularity at 0 filled in. */
export function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

/**
 * Blackman window over t in [-1, 1]; 0 outside. Chosen over Hann for its −74 dB sidelobes
 * — with a 32-tap kernel the stopband, not the tap count, is what limits the noise floor.
 */
export function blackman(t: number): number {
  if (t <= -1 || t >= 1) return 0;
  const u = (t + 1) / 2; // 0..1
  return 0.42 - 0.5 * Math.cos(2 * Math.PI * u) + 0.08 * Math.cos(4 * Math.PI * u);
}

/**
 * Resample `input` from `inRate` to `outRate`.
 *
 * Returns a new Float32Array of length `ceil(input.length * outRate / inRate)`. Outside
 * the input the signal reads as zero (an instrument sample starts and ends at silence, so
 * zero-padding is the physically correct edge, not a convenience).
 *
 * Pass the FULL sample here, before any truncation. Resampling a sample that has already
 * been cut at its loop end makes the kernel read zeros where real signal used to be, which
 * puts a dip in exactly the region the loop crossfade is about to rely on.
 */
export function resample(
  input: Float32Array,
  inRate: number,
  outRate: number,
  halfWidth: number = DEFAULT_HALF_WIDTH,
): Float32Array {
  if (!(inRate > 0) || !(outRate > 0)) throw new Error('resample: rates must be positive');
  if (!Number.isInteger(halfWidth) || halfWidth < 1) {
    throw new Error('resample: halfWidth must be a positive integer');
  }
  if (inRate === outRate) return Float32Array.from(input);
  if (input.length === 0) return new Float32Array(0);

  const ratio = outRate / inRate;
  const outLen = Math.ceil(input.length * ratio);
  const out = new Float32Array(outLen);

  // Kernel cutoff, normalized to the INPUT Nyquist. Downsampling (ratio < 1) pulls it
  // down to the output Nyquist; upsampling leaves it at 1 (nothing new to band-limit).
  const cutoff = Math.min(1, ratio);
  // Kernel support in input samples. Widens as the cutoff falls, keeping the tap count
  // (and therefore the transition-band sharpness) constant.
  const support = halfWidth / cutoff;
  const len = input.length;

  for (let n = 0; n < outLen; n++) {
    const centre = n / ratio; // position in input-sample coordinates
    const i0 = Math.max(0, Math.ceil(centre - support));
    const i1 = Math.min(len - 1, Math.floor(centre + support));
    let sum = 0;
    for (let i = i0; i <= i1; i++) {
      const d = i - centre;
      sum += input[i]! * sinc(cutoff * d) * blackman(d / support);
    }
    // cutoff scales the kernel's DC gain back to unity after the widening above.
    out[n] = sum * cutoff;
  }
  return out;
}

/**
 * Scale a loop region to a new sample rate.
 *
 * LENGTH IS SCALED, NOT THE END POINT. Rounding `loopStart` and `loopEnd` independently
 * lets the loop LENGTH drift by a sample, and the loop length is the pitch-critical
 * quantity — a one-sample error in a 200-sample loop is roughly 8 cents of detune on the
 * sustained portion only, so the note audibly bends the moment it reaches its loop. Rounding
 * the start and the length separately keeps that error off the pitch.
 */
export function scaleLoop(
  loopStart: number,
  loopEnd: number,
  ratio: number,
): { loopStart: number; loopEnd: number } {
  const start = Math.round(loopStart * ratio);
  const length = Math.max(1, Math.round((loopEnd - loopStart) * ratio));
  return { loopStart: start, loopEnd: start + length };
}
