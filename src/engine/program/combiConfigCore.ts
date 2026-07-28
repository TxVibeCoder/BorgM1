/**
 * Combination -> engine timbres. PURE, no Web Audio types, Node-testable.
 *
 * The Phase 5 seam, and the file where the five Combination types stop being five things.
 * `SINGLE`, `LAYER`, `SPLIT`, `VELOCITY SWITCH` and MULTI are five REAL types in the data —
 * each has its own edit pages and its own SysEx meaning, and `combiParams.ts` keeps them that
 * way — but they are not five behaviours in the engine. Each resolves to a list of
 * `TimbreConfig`s with effective windows, and `voiceEngineCore` then applies one rule:
 * a timbre sounds when its channel, key window and velocity window all match.
 *
 * SPLIT is two timbres whose key windows meet at the split point. VELOCITY SWITCH is two
 * whose velocity windows meet at the switch point. LAYER is two with everything wide open.
 * SINGLE is one. MULTI is whatever the eight rows say. Writing the type logic here, once,
 * rather than in the voice engine is what keeps the engine's play path a single test.
 *
 * GENERIC IN THE SAMPLE TYPE for the same reason `programConfigCore` is: the bridge holds
 * offsets into a transferred buffer, the worklet holds live views, and one mapping serves both.
 */

import {
  panpotGains,
  PANPOT_POSITIONS,
  programRefToIndex,
  timbresInType,
  TIMBRE_COUNT,
  type ProgramRef,
} from '../../../data/combiParams';
import type { TimbreConfig } from '../voice/voiceEngineCore';
import type { ProgramConfigOf } from './programConfigCore';

/** A timbre carrying whichever sample representation the caller holds. */
export type TimbreConfigOf<S> = Omit<TimbreConfig, 'program'> & { program: ProgramConfigOf<S> };

/**
 * Resolves a timbre's PROGRAM POINTER into an actual program.
 *
 * The 124-byte record stores only a number (`I00`..`C99`), which is also why editing a program
 * in PROGRAM mode changes every timbre that points at it. Injected rather than imported so
 * this file stays pure, and so Phase 6 can swap "the edit buffer" for "the factory bank"
 * without touching a line of it.
 *
 * Returning `null` means "no such program" and the timbre is dropped — the same outcome as
 * TIMBRE OFF, which is what an unloadable pointer should do.
 */
export type ProgramResolver<S> = (ref: ProgramRef, index: number | null) => ProgramConfigOf<S> | null;

function num(params: Record<string, number | string>, id: string, fallback = 0): number {
  const v = params[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(params: Record<string, number | string>, id: string, fallback = ''): string {
  const v = params[id];
  return typeof v === 'string' ? v : fallback;
}

/**
 * OUTPUT LEVEL 0..99 -> gain.
 *
 * Manual p.65: "The volume, when set to 99 is the full volume as set in the Program parameter,
 * and 0 mutes the Program completely." So 99 is UNITY and the law is linear in the parameter,
 * not in decibels. The linearity is A CHOICE — the manual gives the endpoints and nothing
 * between them — but the endpoints are not, and they are the part that matters: a timbre at 99
 * must be exactly as loud as the program it points at.
 */
export function timbreLevelToGain(level: number): number {
  return Math.min(1, Math.max(0, level / 99));
}

/** What one timbre row of the record says, before the type gets a vote. */
interface RawTimbre {
  index: number;
  programRef: ProgramRef;
  level: number;
  transpose: number;
  detune: number;
  pan: number;
  keyLow: number;
  keyHigh: number;
  velLow: number;
  velHigh: number;
  channel: number;
  damper: boolean;
  afterTouch: boolean;
  controlChange: boolean;
  on: boolean;
}

function readTimbre(params: Record<string, number | string>, i: number): RawTimbre {
  const p = `T${i + 1}_`;
  const ref = str(params, `${p}PROGRAM`, 'OFF');
  return {
    index: i,
    programRef: ref === 'OFF' ? null : ref,
    level: num(params, `${p}LEVEL`, 99),
    transpose: num(params, `${p}TRANSPOSE`),
    detune: num(params, `${p}DETUNE`),
    pan: Math.max(0, PANPOT_POSITIONS.indexOf(str(params, `${p}PAN`, '5:5') as never)),
    keyLow: num(params, `${p}KEY_BOTTOM`, 0),
    keyHigh: num(params, `${p}KEY_TOP`, 127),
    velLow: num(params, `${p}VEL_BOTTOM`, 1),
    velHigh: num(params, `${p}VEL_TOP`, 127),
    // The record stores 1..16; the engine and Web MIDI both speak 0..15.
    channel: num(params, `${p}CHANNEL`, 1) - 1,
    damper: str(params, `${p}FILTER_DAMPER`, 'ENA') === 'ENA',
    afterTouch: str(params, `${p}FILTER_AFTER_TOUCH`, 'ENA') === 'ENA',
    controlChange: str(params, `${p}FILTER_CONTROL_CHANGE`, 'ENA') === 'ENA',
    on: str(params, `${p}TIMBRE_OFF`, 'ON') === 'ON',
  };
}

/**
 * Whether this timbre sounds at all.
 *
 * TWO MECHANISMS, AND THE HARDWARE USES BOTH. `TIMBRE ON/OFF` (byte+10 bit4, inverted) and —
 * in MULTI only — a program byte of 00H. MEASURED across Korg's 100 factory combinations: bit4
 * is set on 478 timbres and the MULTI program byte is 00H on 293, agreeing on 286 of them and
 * disagreeing on the rest. Neither is redundant, so a timbre is off if EITHER says so.
 */
function timbreIsOff(t: RawTimbre): boolean {
  return !t.on || t.programRef === null;
}

/**
 * Effective windows per type.
 *
 * SPLIT and VELOCITY SWITCH do not store their point anywhere else — it IS the pair of
 * windows, contiguous, exactly as Korg's own two factory SPLITs store it (see
 * `SPLIT_POINT_DERIVED` in `combiParams`). So these types need no special handling at all
 * beyond using the two timbres the record already describes; the type only decides HOW MANY
 * rows are live.
 */
function timbresForType(params: Record<string, number | string>, type: string): RawTimbre[] {
  const used = timbresInType(type);
  const rows: RawTimbre[] = [];
  for (let i = 0; i < Math.min(used, TIMBRE_COUNT); i++) rows.push(readTimbre(params, i));
  return rows;
}

export interface ResolveOptions<S> {
  params: Record<string, number | string>;
  /** UI-only SOLO flags, one per timbre. When any is set, only those timbres sound. */
  solo?: readonly boolean[];
  resolveProgram: ProgramResolver<S>;
}

/**
 * Build the engine's timbre list from a combination.
 *
 * Timbres keep their ROW INDEX as their position in the returned array — `voiceEngineCore`
 * keys the allocator's same-note rule and its per-timbre MG phases on that index, so a dropped
 * timbre leaves a hole rather than shifting the ones after it. A hole is a `null`, filtered by
 * the caller; shifting would silently retune every timbre above a muted one.
 */
export function buildCombiTimbres<S>(opts: ResolveOptions<S>): (TimbreConfigOf<S> | null)[] {
  const type = str(opts.params, 'COMBI_TYPE', 'SINGLE');
  const rows = timbresForType(opts.params, type);
  const soloing = (opts.solo ?? []).some(Boolean);

  return rows.map((t) => {
    if (timbreIsOff(t)) return null;
    if (soloing && !opts.solo?.[t.index]) return null;
    const program = opts.resolveProgram(t.programRef, programRefToIndex(t.programRef));
    if (!program) return null;
    const bus = panpotGains(t.pan);
    return {
      program,
      channel: t.channel,
      keyLow: t.keyLow,
      keyHigh: t.keyHigh,
      velLow: t.velLow,
      velHigh: t.velHigh,
      transpose: t.transpose,
      detune: t.detune,
      level: timbreLevelToGain(t.level),
      bus,
      damper: t.damper,
      afterTouch: t.afterTouch,
      controlChange: t.controlChange,
    };
  });
}

/**
 * A silent placeholder, so a dropped timbre keeps its index without costing a program.
 *
 * An empty key window means `timbreMatches` can never return true, so this never allocates a
 * slot and never renders — it exists only to hold position.
 */
export function silentTimbre<S>(program: ProgramConfigOf<S>): TimbreConfigOf<S> {
  return {
    program,
    channel: -1,
    keyLow: 1,
    keyHigh: 0,
    velLow: 1,
    velHigh: 0,
    transpose: 0,
    detune: 0,
    level: 0,
    bus: [0, 0, 0, 0],
    damper: true,
    afterTouch: true,
    controlChange: true,
  };
}

/** True when this row can never match any note — what the timbre strip greys out. */
export function windowIsEmpty(params: Record<string, number | string>, timbre: number): boolean {
  const t = readTimbre(params, timbre);
  return t.keyLow > t.keyHigh || t.velLow > t.velHigh;
}

/** True when this row is silent for any reason. Drives the strip's dimmed state. */
export function timbreIsSilent(
  params: Record<string, number | string>,
  timbre: number,
  solo?: readonly boolean[],
): boolean {
  const t = readTimbre(params, timbre);
  if (timbreIsOff(t) || t.level <= 0) return true;
  if (t.keyLow > t.keyHigh || t.velLow > t.velHigh) return true;
  return (solo ?? []).some(Boolean) && !solo?.[timbre];
}
