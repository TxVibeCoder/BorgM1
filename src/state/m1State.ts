/**
 * THE state tree. One serializable object; `JSON.parse(JSON.stringify(getState()))`
 * round-trips exactly, enforced by test/unit/stateRoundTrip.test.ts from day one
 * (CLAUDE.md). Nothing non-serializable ever lands here — no AudioBuffers, no nodes,
 * no functions, no Infinity/NaN. Sample bytes live in sampleStore/the Cache API and
 * are referenced by id.
 *
 * Phase 0 populates only what is real: mode, master, keyboard, extensions and the
 * program/combi shells. Phases 3 and 5 fill `program.params` from the 143-byte SysEx
 * table and `combi.timbres` from the 124-byte one. The SHAPE is settled now so those
 * phases extend the tree rather than replace it.
 *
 * COALESCE, DON'T TRUST. Every slice has a `coalesce*` that heals a partial, stale or
 * hand-edited tree into a valid one — clamping ranges, filling fields a older bundle
 * lacked, and forcing non-finite numbers back to defaults. A loaded bundle is untrusted
 * input; the store is the only place that fact is handled.
 */

import { coalesceProgramParams, defaultProgramParams } from '../../data/programParams';

/** Tree schema version. Bump only on a BREAKING shape change; additive slices don't. */
export const STATE_VERSION = 1;

/** The M1's two performance modes. SEQUENCER is Phase 7 and deliberately absent. */
export const MODES = ['PROGRAM', 'COMBI'] as const;
export type Mode = (typeof MODES)[number];

/**
 * Plugin-era additions the 1988 hardware did not have. They ship as switchable
 * extensions and MUST default to off — the Phase 4 fidelity gate (`I17 Organ 2` vs the
 * StoneBridge mix) has to pass with them off, exactly as Korg's own plugin ships
 * resonance as an opt-in so factory presets reproduce the original.
 */
export interface ExtensionsState {
  /** VDF resonance. The hardware filter has none, confirmed three ways. */
  resonance: boolean;
  /** Per-timbre insert FX rack. Not on the hardware. */
  insertFx: boolean;
}

export interface MasterState {
  /** 0..1, straight into the master gain. */
  volume: number;
}

export interface KeyboardState {
  /** Octave transpose of the on-screen keybed, -3..+3. */
  octave: number;
  /** Web MIDI receive channel: -1 = OMNI, else 0..15. */
  midiChannel: number;
}

/**
 * One Program. `params` is the 143-parameter bag keyed by ControlDef id; Phase 3
 * populates it from the SysEx table. Values are number | string because the table
 * mixes scalars with enumerated switch positions (OSC MODE, waveform names).
 */
export interface ProgramState {
  /** Display name, ≤ 10 chars on the hardware. */
  name: string;
  /** Factory/user bank slot this was loaded from, or null for an unsaved edit. */
  slot: string | null;
  params: Record<string, number | string>;
}

/** One Combination timbre. Phase 5 fills this out; the shell pins the shape. */
export interface CombiState {
  name: string;
  slot: string | null;
  /** Phase 5: SINGLE | LAYER | SPLIT | VELOCITY SWITCH | MULTI — five real types. */
  type: string;
  timbres: TimbreState[];
}

export interface TimbreState {
  /** Program slot this timbre plays, or null for an empty timbre. */
  program: string | null;
  /** MIDI channel 0..15. */
  channel: number;
  /** Inclusive key window [low, high], 0..127. */
  keyLow: number;
  keyHigh: number;
  /** Inclusive velocity window [low, high], 1..127. */
  velLow: number;
  velHigh: number;
  muted: boolean;
  solo: boolean;
}

export const TIMBRE_COUNT = 8;

export interface M1State {
  version: number;
  mode: Mode;
  master: MasterState;
  keyboard: KeyboardState;
  extensions: ExtensionsState;
  program: ProgramState;
  combi: CombiState;
}

// ---- defaults ---------------------------------------------------------------------

export function defaultMasterState(): MasterState {
  return { volume: 0.8 };
}

export function defaultKeyboardState(): KeyboardState {
  return { octave: 0, midiChannel: -1 };
}

export function defaultExtensionsState(): ExtensionsState {
  return { resonance: false, insertFx: false };
}

export function defaultProgramState(): ProgramState {
  return { name: 'INIT PROG', slot: null, params: defaultProgramParams() };
}

export function defaultTimbre(): TimbreState {
  return {
    program: null,
    channel: 0,
    keyLow: 0,
    keyHigh: 127,
    velLow: 1,
    velHigh: 127,
    muted: false,
    solo: false,
  };
}

export function defaultCombiState(): CombiState {
  return {
    name: 'INIT COMBI',
    slot: null,
    type: 'SINGLE',
    timbres: Array.from({ length: TIMBRE_COUNT }, defaultTimbre),
  };
}

export function defaultM1State(): M1State {
  return {
    version: STATE_VERSION,
    mode: 'PROGRAM',
    master: defaultMasterState(),
    keyboard: defaultKeyboardState(),
    extensions: defaultExtensionsState(),
    program: defaultProgramState(),
    combi: defaultCombiState(),
  };
}

// ---- coalesce ---------------------------------------------------------------------

function num(raw: unknown, fallback: number, lo: number, hi: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.min(hi, Math.max(lo, raw));
}

function int(raw: unknown, fallback: number, lo: number, hi: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(raw)));
}

function str(raw: unknown, fallback: string): string {
  return typeof raw === 'string' ? raw : fallback;
}

function nullableStr(raw: unknown): string | null {
  return typeof raw === 'string' ? raw : null;
}

function bool(raw: unknown): boolean {
  return raw === true;
}

export function coalesceMode(raw: unknown): Mode {
  return (MODES as readonly string[]).includes(raw as string) ? (raw as Mode) : 'PROGRAM';
}

export function coalesceMasterState(raw: Partial<MasterState> | undefined): MasterState {
  return { volume: num(raw?.volume, 0.8, 0, 1) };
}

export function coalesceKeyboardState(raw: Partial<KeyboardState> | undefined): KeyboardState {
  const octave = int(raw?.octave, 0, -3, 3);
  // OMNI (-1) is the fallback for anything out of 0..15, including -1 itself.
  const ch = raw?.midiChannel;
  const midiChannel =
    typeof ch === 'number' && Number.isInteger(ch) && ch >= 0 && ch <= 15 ? ch : -1;
  return { octave, midiChannel };
}

/**
 * Extensions heal to OFF, never on. A tree that predates an extension, or carries junk
 * in its place, must not silently enable a feature the hardware never had — that would
 * quietly break the fidelity gate.
 */
export function coalesceExtensionsState(raw: Partial<ExtensionsState> | undefined): ExtensionsState {
  return { resonance: bool(raw?.resonance), insertFx: bool(raw?.insertFx) };
}

/**
 * Heal the program.
 *
 * Since Phase 3 the params bag is not a free-form map: it is the 143-byte SysEx table, so
 * coalescing means filling every missing parameter from its default, clamping numbers into
 * the range the manual gives them, and rejecting any enumerated value that is not a legal
 * position. Unknown keys are DROPPED rather than carried, which also removes the last route
 * for a JSON-hostile value (NaN, Infinity, a nested object) to reach the tree.
 */
export function coalesceProgramState(raw: Partial<ProgramState> | undefined): ProgramState {
  return {
    name: str(raw?.name, 'INIT PROG'),
    slot: nullableStr(raw?.slot),
    params: coalesceProgramParams(raw?.params),
  };
}

export function coalesceTimbre(raw: Partial<TimbreState> | undefined): TimbreState {
  const keyLow = int(raw?.keyLow, 0, 0, 127);
  const keyHigh = int(raw?.keyHigh, 127, 0, 127);
  const velLow = int(raw?.velLow, 1, 1, 127);
  const velHigh = int(raw?.velHigh, 127, 1, 127);
  return {
    program: nullableStr(raw?.program),
    channel: int(raw?.channel, 0, 0, 15),
    // An inverted window would silence the timbre with no visible cause; order it.
    keyLow: Math.min(keyLow, keyHigh),
    keyHigh: Math.max(keyLow, keyHigh),
    velLow: Math.min(velLow, velHigh),
    velHigh: Math.max(velLow, velHigh),
    muted: bool(raw?.muted),
    solo: bool(raw?.solo),
  };
}

export function coalesceCombiState(raw: Partial<CombiState> | undefined): CombiState {
  const src = Array.isArray(raw?.timbres) ? raw.timbres : [];
  return {
    name: str(raw?.name, 'INIT COMBI'),
    slot: nullableStr(raw?.slot),
    type: str(raw?.type, 'SINGLE'),
    // Always exactly TIMBRE_COUNT — a short or ragged array is padded with defaults.
    timbres: Array.from({ length: TIMBRE_COUNT }, (_, i) => coalesceTimbre(src[i])),
  };
}

export function coalesceM1State(raw: Partial<M1State> | undefined): M1State {
  return {
    version: STATE_VERSION,
    mode: coalesceMode(raw?.mode),
    master: coalesceMasterState(raw?.master),
    keyboard: coalesceKeyboardState(raw?.keyboard),
    extensions: coalesceExtensionsState(raw?.extensions),
    program: coalesceProgramState(raw?.program),
    combi: coalesceCombiState(raw?.combi),
  };
}

// ---- store ------------------------------------------------------------------------

type Listener = () => void;

/**
 * The single state store. Lives OUTSIDE React; components subscribe and select.
 * getState() returns a DEEP COPY, so a caller mutating the result cannot reach into
 * the store — that is what makes the round-trip test meaningful rather than tautological.
 */
export class M1Store {
  private state: M1State;
  private listeners = new Set<Listener>();

  constructor(initial?: Partial<M1State>) {
    this.state = initial ? coalesceM1State(initial) : defaultM1State();
  }

  getState(): M1State {
    return structuredCloneish(this.state);
  }

  setState(next: Partial<M1State>): void {
    this.state = coalesceM1State(next);
    this.emit();
  }

  setMode(mode: Mode): void {
    this.state.mode = coalesceMode(mode);
    this.emit();
  }

  setMasterVolume(v: number): void {
    this.state.master.volume = num(v, 0.8, 0, 1);
    this.emit();
  }

  setExtension(id: keyof ExtensionsState, on: boolean): void {
    this.state.extensions[id] = on === true;
    this.emit();
  }

  setProgramParam(id: string, value: number | string): void {
    if (typeof value === 'number' && !Number.isFinite(value)) return;
    this.state.program.params[id] = value;
    this.emit();
  }

  setProgramName(name: string): void {
    // 10 characters is the hardware's field width (bytes 0-9 of the record).
    this.state.program.name = name.slice(0, 10);
    this.emit();
  }

  /**
   * Direct readers, for `useSyncExternalStore` snapshots.
   *
   * These deliberately do NOT go through `getState()`. That deep-copies through the JSON
   * codec, so it returns a fresh object on every call — which would make every snapshot
   * compare unequal and re-render all 139 panel controls on every knob movement. The deep
   * copy is the right default for anyone taking a whole tree; it is the wrong thing on the
   * hot path, so the hot path reads scalars straight out.
   */
  getProgramParam(id: string): number | string | undefined {
    return this.state.program.params[id];
  }

  get oscMode(): string {
    return String(this.state.program.params.OSC_MODE ?? 'SINGLE');
  }

  get programName(): string {
    return this.state.program.name;
  }

  getExtension(id: keyof ExtensionsState): boolean {
    return this.state.extensions[id];
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

/**
 * Deep copy via the JSON codec. Deliberately NOT `structuredClone`: the JSON round trip
 * is the invariant this tree must satisfy, so cloning through it means any value that
 * would not survive serialization fails loudly here, in every getState(), rather than
 * silently at save time. structuredClone would happily carry a Map or an Infinity
 * through and hide the bug until a bundle was written.
 */
function structuredCloneish<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
