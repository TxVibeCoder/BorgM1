/**
 * Tempo grid — pure boundary math, Web-Audio-free.
 *
 * Snaps an event to a bar/beat grid: QUANTIZE picks the division and a `PhaseRef`
 * supplies the phase (anchor = the un-swung bar downbeat). Inherited verbatim from
 * SynthStack, where it drove sampler loop launch; here it is the grid the Phase 7
 * sequencer's quantize and the Combination metronome build on.
 *
 * Semantics: division OFF or no running clock => events fire immediately
 * (`nextBoundary` returns `afterTime` unchanged).
 */

export type QuantDivision = 'OFF' | '1/16' | '1/8' | '1/4' | '1/2' | '1 BAR';

/** Selector positions, in order. */
export const QUANT_CYCLE: QuantDivision[] = ['OFF', '1/16', '1/8', '1/4', '1/2', '1 BAR'];

/** A snapshot of the master clock's grid phase at a moment in audio-clock time. */
export interface PhaseRef {
  running: boolean;
  tempoBpm: number;
  /** Audio time of the current bar's downbeat (un-swung, invariant within a bar). */
  anchorTime: number;
  /** Duration of one 16th note at the current tempo. */
  sixteenthDurS: number;
}

/** A bar is 16 sixteenths (4/4 — locked scope). */
export const RELAUNCH_SIXTEENTHS = 16;

/** Tempo (BPM) -> 16th-note step duration in seconds. */
export function stepDurS(bpm: number): number {
  return 60 / Math.min(300, Math.max(20, bpm)) / 4;
}

/** Swing offset applied to ODD 16th ticks: (swing−50)/50 × 0.5 × stepDur.
 *  Gate placement only — the grid itself never inherits it (see nextBoundary). */
export function swingOffsetS(swingPct: number, stepDurSeconds: number): number {
  return ((Math.min(100, Math.max(0, swingPct)) - 50) / 50) * 0.5 * stepDurSeconds;
}

/** Division -> its length in 16th notes (OFF -> 0, i.e. no grid). */
export function divisionSixteenths(d: QuantDivision): number {
  switch (d) {
    case 'OFF':
      return 0;
    case '1/16':
      return 1;
    case '1/8':
      return 2;
    case '1/4':
      return 4;
    case '1/2':
      return 8;
    case '1 BAR':
      return 16;
  }
}

/** Seconds per bar at the phase's tempo. */
export function barPeriodS(phase: PhaseRef): number {
  return RELAUNCH_SIXTEENTHS * phase.sixteenthDurS;
}

/**
 * The first grid boundary strictly at or after `afterTime`. OFF or a stopped clock
 * degrades to immediate (returns `afterTime` unchanged). Otherwise the boundary is a
 * multiply from the bar anchor — anchor + k·gridS, k = ceil((afterTime − anchor)/gridS)
 * — so every sub-bar boundary stays phase-coherent with the bar downbeat and the
 * result never accumulates per-call error.
 */
export function nextBoundary(afterTime: number, division: QuantDivision, phase: PhaseRef): number {
  if (division === 'OFF' || !phase.running) return afterTime;
  const gridS = divisionSixteenths(division) * phase.sixteenthDurS;
  const EPS = 1e-9; // an afterTime already sitting on a boundary fires there, not a grid later
  const k = Math.ceil((afterTime - phase.anchorTime - EPS) / gridS);
  return phase.anchorTime + k * gridS;
}
