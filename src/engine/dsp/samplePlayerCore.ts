/**
 * Multisample playback — PURE, no Web Audio types, Node-testable, fully deterministic.
 *
 * That determinism is not incidental: there is no PRNG anywhere in this path, so Phase 2's
 * gate can be a BYTE-EXACT golden-buffer comparison rather than a spectral tolerance band.
 * Keep it that way — a single `Math.random` here would cost the sharpest test in the
 * project.
 *
 * FLOAT64 PHASE, NOT FLOAT32. A float32 accumulator has ~24 bits of mantissa, so past a
 * few hundred thousand samples the increment stops resolving and the pitch drifts audibly
 * on long samples. float64 makes that unreachable.
 */

import { LOOP_GUARD_SAMPLES } from '../sample/loopCore';

export interface SampleRef {
  /** PCM as float. Includes the baked guard samples after `loopEnd`. */
  data: Float32Array;
  /** -1 for a one-shot. */
  loopStart: number;
  /** Exclusive. Playback wraps from loopEnd-1 back to loopStart. */
  loopEnd: number;
}

export interface PlayerState {
  /** Position in source samples. float64 — see the header. */
  phase: number;
  /** false once a one-shot has run off the end. */
  active: boolean;
}

export function makePlayerState(): PlayerState {
  return { phase: 0, active: false };
}

export function startPlayer(st: PlayerState, startPhase = 0): void {
  st.phase = startPhase;
  st.active = true;
}

/**
 * 4-point cubic Hermite. 19 operations, ~44 dB SNR at 4x oversampling against linear's
 * ~34 — what sfizz and SpessaSynth both use, and the reason the bank can get away with
 * moderate zone density.
 */
export function hermite(ym1: number, y0: number, y1: number, y2: number, t: number): number {
  const c0 = y0;
  const c1 = 0.5 * (y1 - ym1);
  const c2 = ym1 - 2.5 * y0 + 2 * y1 - 0.5 * y2;
  const c3 = 0.5 * (y2 - ym1) + 1.5 * (y0 - y1);
  return ((c3 * t + c2) * t + c1) * t + c0;
}

/**
 * Read the sample one step BEFORE index `i`, honouring the loop.
 *
 * The guard region after `loopEnd` covers the interpolator's forward reach (i+1, i+2). Its
 * backward reach is the case the guard does not cover: at i === loopStart the correct
 * predecessor is the last sample of the loop, not whatever precedes loopStart in the file.
 *
 * For a normal sample this does not matter, because the bake's crossfade ends ON the
 * pre-loop material — data[loopStart-1] and data[loopEnd-1] are equal by construction.
 * It matters for loopStart === 0 (the single-cycle DWGS tables), where there IS no
 * data[-1] and reading one would be out of bounds. Hence the wrap.
 */
function readBefore(data: Float32Array, i: number, loopStart: number, loopEnd: number): number {
  if (i > 0) return data[i - 1]!;
  if (loopStart >= 0 && loopEnd > loopStart) return data[loopEnd - 1]!;
  return data[0]!;
}

/**
 * Render `count` samples into `out`, ADDING (so callers can sum oscillators).
 *
 * THE INCREMENT IS INTERPOLATED ACROSS THE BLOCK. Holding one increment for a whole block
 * and stepping it at the boundary is audible as a staircase whenever the pitch is moving
 * quickly — which on this instrument is whenever the pitch EG is doing its job, since its
 * whole purpose is fast transient bends. Recomputing per block is right; STEPPING per
 * block is the bug.
 *
 * Returns the number of samples actually written before the voice ended (== count for a
 * looped sample, possibly fewer for a one-shot).
 */
export function renderInto(
  out: Float32Array,
  outOffset: number,
  count: number,
  ref: SampleRef,
  st: PlayerState,
  incStart: number,
  incEnd: number,
  gainStart: number,
  gainEnd: number,
): number {
  if (!st.active) return 0;
  const { data, loopStart, loopEnd } = ref;
  const looped = loopStart >= 0 && loopEnd > loopStart;
  const loopLength = looped ? loopEnd - loopStart : 0;
  // A one-shot must stop with room for the interpolator's forward reach.
  const hardEnd = looped ? loopEnd : data.length - 2;

  const incStep = count > 1 ? (incEnd - incStart) / count : 0;
  const gainStep = count > 1 ? (gainEnd - gainStart) / count : 0;
  let inc = incStart;
  let gain = gainStart;
  let phase = st.phase;
  let written = 0;

  for (let n = 0; n < count; n++) {
    if (looped) {
      // `while`, not `if`: a high increment (playing a low sample far up the keyboard) can
      // cross the loop more than once in a single step.
      while (phase >= loopEnd) phase -= loopLength;
    } else if (phase >= hardEnd) {
      st.active = false;
      break;
    }

    const i = phase | 0;
    const t = phase - i;
    const ym1 = readBefore(data, i, looped ? loopStart : -1, loopEnd);
    const y0 = data[i]!;
    const y1 = data[i + 1]!;
    const y2 = data[i + 2]!;
    out[outOffset + n] = out[outOffset + n]! + hermite(ym1, y0, y1, y2, t) * gain;

    phase += inc;
    inc += incStep;
    gain += gainStep;
    written++;
  }

  // Normalize before storing, so the saved phase is always inside the loop. Wrapping only
  // at the top of the read would leave an out-of-range phase in the state between blocks —
  // harmless for the next render, but it makes the state unreadable for anything that
  // inspects it (tests, the UI's playhead, a future sample-accurate scheduler).
  if (looped) {
    while (phase >= loopEnd) phase -= loopLength;
  }
  st.phase = phase;
  return written;
}

/**
 * Playback increment for a note, given the sample's root key and detune.
 *
 * `pitchOffsetSemis` carries the pitch EG, transpose, detune and bend, all of which are
 * additive in semitones and therefore multiplicative here.
 */
export function incrementFor(
  note: number,
  rootKey: number,
  fineCents: number,
  sourceRate: number,
  outputRate: number,
  pitchOffsetSemis = 0,
): number {
  const semis = note - rootKey + fineCents / 100 + pitchOffsetSemis;
  return Math.pow(2, semis / 12) * (sourceRate / outputRate);
}

/**
 * A sample is safe to play iff its guard region is present.
 *
 * Cheap invariant, worth asserting at load rather than discovering as a read past the end
 * of the buffer in `process()` — where an uncaught throw silences the whole node
 * permanently.
 */
export function hasGuard(ref: SampleRef): boolean {
  if (ref.loopStart < 0) return ref.data.length >= 4;
  return ref.data.length >= ref.loopEnd + LOOP_GUARD_SAMPLES;
}
