/**
 * PCM word conversion — PURE, no Web Audio types, Node-testable.
 *
 * The bank ships Int16: it is what the 1988 hardware's DAC delivered, it halves the
 * download against Float32, and the engine converts to float once at load rather than
 * per sample. Phase 4 models the DAC's gain-ranged noise floor on top of this; the bank
 * itself is plain linear PCM.
 */

/**
 * Scale factor for float -> int16.
 *
 * 32767, not 32768. int16 runs [-32768, 32767], so the range is asymmetric by one code.
 * Scaling by 32768 makes an input of exactly +1.0 land on 32768, which does not exist and
 * wraps to -32768 — a full-scale positive peak inverting to a full-scale negative one, the
 * loudest possible click, on precisely the samples most likely to hit 1.0. Scaling by
 * 32767 costs 0.0003 dB of headroom and cannot produce that.
 */
export const INT16_SCALE = 32767;

/** Convert float samples in [-1, 1] to Int16, rounding and clamping. */
export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = Math.round(input[i]! * INT16_SCALE);
    out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
  return out;
}

/** Convert Int16 back to float in [-1, 1]. Exact inverse of the scale, not of the rounding. */
export function int16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i]! / INT16_SCALE;
  return out;
}

/** Peak absolute value. 0 for an empty or silent buffer. */
export function peak(input: Float32Array): number {
  let p = 0;
  for (let i = 0; i < input.length; i++) {
    const a = Math.abs(input[i]!);
    if (a > p) p = a;
  }
  return p;
}

/**
 * Scale so the peak sits at `target`, in place. No-op on silence.
 *
 * Applied per multisound, NOT per zone: normalizing each key zone independently would
 * flatten the natural level differences across an instrument's range and make the seams
 * between zones audible as level steps — the one artefact a multisample most needs to
 * avoid.
 */
export function normalizeInPlace(data: Float32Array, target = 0.99): Float32Array {
  const p = peak(data);
  if (p === 0) return data;
  const g = target / p;
  for (let i = 0; i < data.length; i++) data[i] = data[i]! * g;
  return data;
}
