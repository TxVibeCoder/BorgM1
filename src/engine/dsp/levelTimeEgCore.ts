/**
 * ONE generic level/time envelope — PURE, no Web Audio types, Node-testable.
 *
 * The M1 has three envelopes with three different shapes, and the tempting move is three
 * classes. Don't. They are the same machine with different stage lists:
 *
 *   FILTER (VDF)  attack -> decay -> slope -> [sustain] -> release, SIGNED and bipolar
 *                 around the cutoff, scaled by EG Intensity. Releases to a LEVEL.
 *   AMP (VDA)     the same five stages, unsigned, and NO RELEASE LEVEL — it falls to
 *                 zero, because an amplifier that released to a non-zero level would
 *                 never stop sounding.
 *   PITCH         no sustain and no break point, clamped to +/-1 octave.
 *
 * That asymmetry is not a detail to smooth over: the filter EG's release-to-a-level and
 * the amp EG's release-to-zero are why UI-SPEC calls for two different EG graph
 * components. Modelling it once here is what keeps the two honest.
 */

/** Minimum release, in seconds. */
export const MIN_RELEASE_S = 0.005;

/**
 * One stage: ramp to `level` over `time` seconds.
 * `level` is in the envelope's own units (0..1 unsigned, -1..1 signed).
 */
export interface EgStage {
  timeS: number;
  level: number;
}

export interface EgConfig {
  /** Stages walked in order from note-on. */
  stages: EgStage[];
  /**
   * Index of the stage whose END level is held until note-off. -1 = no sustain, i.e. the
   * envelope runs to completion regardless of key state (the pitch EG).
   */
  sustainStage: number;
  /** Applied on note-off. */
  release: EgStage;
  /** Starting level at note-on. 0 for amp/filter; pitch EGs can start displaced. */
  startLevel: number;
}

export type EgPhase = 'idle' | 'running' | 'sustain' | 'release' | 'done';

export interface EgState {
  phase: EgPhase;
  /** Index into config.stages while running. */
  stage: number;
  /** Current output. */
  level: number;
  /** Level the current segment started from. */
  from: number;
  /** Level the current segment is heading to. */
  to: number;
  /** Seconds elapsed within the current segment. */
  elapsed: number;
  /** Duration of the current segment. */
  duration: number;
}

export function makeEgState(): EgState {
  return { phase: 'idle', stage: -1, level: 0, from: 0, to: 0, elapsed: 0, duration: 0 };
}

/**
 * EG time parameter (0..99) -> seconds.
 *
 * UNDOCUMENTED. Korg never published the curve, so this is a DESIGN CHOICE, not an M1
 * fact — label it as such anywhere fidelity is discussed. An exponential mapping is the
 * defensible default: it puts useful resolution at the short end, where the ear
 * discriminates, and still reaches the long times the hardware's pads need.
 *
 * 0 -> 1 ms, 99 -> 30 s, exponential between.
 */
export const EG_TIME_MIN_S = 0.001;
export const EG_TIME_MAX_S = 30;
const EG_TIME_K = 6;

export function egTimeToSeconds(v: number): number {
  const t = Math.min(99, Math.max(0, v)) / 99;
  const shaped = (Math.exp(EG_TIME_K * t) - 1) / (Math.exp(EG_TIME_K) - 1);
  return EG_TIME_MIN_S + (EG_TIME_MAX_S - EG_TIME_MIN_S) * shaped;
}

function beginSegment(st: EgState, from: number, to: number, timeS: number): void {
  st.from = from;
  st.to = to;
  st.duration = Math.max(0, timeS);
  st.elapsed = 0;
  st.level = from;
}

/** Start the envelope from `config.startLevel`. */
export function noteOn(st: EgState, config: EgConfig): void {
  st.phase = 'running';
  st.stage = 0;
  if (config.stages.length === 0) {
    st.phase = 'sustain';
    st.level = config.startLevel;
    return;
  }
  beginSegment(st, config.startLevel, config.stages[0]!.level, config.stages[0]!.timeS);
}

/**
 * Move to the release segment.
 *
 * THE RELEASE IS CLAMPED TO A FLOOR. A release time of zero is a step to the release
 * level, which is a click — and zero is a perfectly reachable parameter value, so this is
 * not an edge case but a setting a user will actually dial in. ~5 ms is below the
 * threshold of hearing it as a fade and above the threshold of hearing it as a click.
 */
export function noteOff(st: EgState, config: EgConfig): void {
  if (st.phase === 'idle' || st.phase === 'done') return;
  st.phase = 'release';
  beginSegment(st, st.level, config.release.level, Math.max(MIN_RELEASE_S, config.release.timeS));
}

/**
 * Advance by `dt` seconds and return the new level.
 *
 * Linear within a segment. The M1's envelopes are level/time pairs, so the segment
 * endpoints carry the shape and interpolating between them linearly is the model, not an
 * approximation of an exponential one.
 */
export function process(st: EgState, config: EgConfig, dt: number): number {
  if (st.phase === 'idle' || st.phase === 'done') return st.level;
  if (st.phase === 'sustain') return st.level;

  st.elapsed += dt;

  // Walk forward through as many segments as `dt` spans — a long block or a very short
  // stage must not lose stages, or a fast attack silently becomes a slow one.
  for (;;) {
    if (st.duration <= 0 || st.elapsed >= st.duration) {
      const overshoot = st.duration <= 0 ? st.elapsed : st.elapsed - st.duration;
      st.level = st.to;

      if (st.phase === 'release') {
        st.phase = 'done';
        return st.level;
      }

      // Reached the sustain point?
      if (st.stage === config.sustainStage) {
        st.phase = 'sustain';
        return st.level;
      }

      const next = st.stage + 1;
      if (next >= config.stages.length) {
        // Ran off the end with no sustain (the pitch EG): hold the final level.
        st.phase = config.sustainStage === -1 ? 'done' : 'sustain';
        return st.level;
      }
      st.stage = next;
      const seg = config.stages[next]!;
      beginSegment(st, st.level, seg.level, seg.timeS);
      st.elapsed = overshoot;
      continue;
    }
    st.level = st.from + (st.to - st.from) * (st.elapsed / st.duration);
    return st.level;
  }
}

// ---- the three configurations ----------------------------------------------------------

/**
 * FILTER (VDF) envelope. Signed: the output is added to the cutoff, so it swings both
 * ways around it. `intensity` scales the whole thing (EG Intensity, -99..99 on the
 * hardware, normalized to -1..1 here).
 *
 * Releases to a LEVEL, not to zero — the filter can settle anywhere.
 */
export function filterEgConfig(p: {
  attackTime: number;
  attackLevel: number;
  decayTime: number;
  breakPoint: number;
  slopeTime: number;
  sustainLevel: number;
  releaseTime: number;
  releaseLevel: number;
}): EgConfig {
  return {
    startLevel: 0,
    stages: [
      { timeS: egTimeToSeconds(p.attackTime), level: p.attackLevel },
      { timeS: egTimeToSeconds(p.decayTime), level: p.breakPoint },
      { timeS: egTimeToSeconds(p.slopeTime), level: p.sustainLevel },
    ],
    sustainStage: 2,
    release: { timeS: egTimeToSeconds(p.releaseTime), level: p.releaseLevel },
  };
}

/**
 * AMP (VDA) envelope. Unsigned, and the release level is NOT a parameter: it is always
 * zero. Seven parameters, not eight — that missing eighth is the difference between the
 * two EG graph components in the UI.
 */
export function ampEgConfig(p: {
  attackTime: number;
  attackLevel: number;
  decayTime: number;
  breakPoint: number;
  slopeTime: number;
  sustainLevel: number;
  releaseTime: number;
}): EgConfig {
  return {
    startLevel: 0,
    stages: [
      { timeS: egTimeToSeconds(p.attackTime), level: Math.max(0, p.attackLevel) },
      { timeS: egTimeToSeconds(p.decayTime), level: Math.max(0, p.breakPoint) },
      { timeS: egTimeToSeconds(p.slopeTime), level: Math.max(0, p.sustainLevel) },
    ],
    sustainStage: 2,
    // No release LEVEL. An amplifier envelope that released to anything but zero would
    // leave the voice sounding forever and its slot never freed.
    release: { timeS: egTimeToSeconds(p.releaseTime), level: 0 },
  };
}

/** Pitch EG output is clamped to +/-1 octave, in semitones. */
export const PITCH_EG_MAX_SEMITONES = 12;

/**
 * PITCH envelope. No sustain and no break point — it runs start -> attack -> decay ->
 * done and never waits for the key. Output is in semitones, clamped to +/-12.
 */
export function pitchEgConfig(p: {
  startLevel: number;
  attackTime: number;
  attackLevel: number;
  decayTime: number;
  releaseTime: number;
  releaseLevel: number;
}): EgConfig {
  const clamp = (v: number) =>
    Math.max(-PITCH_EG_MAX_SEMITONES, Math.min(PITCH_EG_MAX_SEMITONES, v));
  return {
    startLevel: clamp(p.startLevel),
    stages: [
      { timeS: egTimeToSeconds(p.attackTime), level: clamp(p.attackLevel) },
      { timeS: egTimeToSeconds(p.decayTime), level: 0 },
    ],
    // -1: no sustain. The pitch EG is a transient shape, not a held one.
    sustainStage: -1,
    release: { timeS: egTimeToSeconds(p.releaseTime), level: clamp(p.releaseLevel) },
  };
}
