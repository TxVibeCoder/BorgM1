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

import {
  coalesceEffectsState,
  defaultEffectParams,
  defaultEffectsState,
  effectAlgorithm,
  effectPairAllowed,
  snapEffectParam,
  EFFECT_COUNT,
  type EffectSlotState,
  type EffectsState,
} from '../../data/effectParams';
import { coalesceProgramParams, defaultProgramParams } from '../../data/programParams';
import {
  coalesceCombiParams,
  COMBI_TYPES,
  defaultCombiParams,
  TIMBRE_COUNT,
} from '../../data/combiParams';

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
  /**
   * Bytes 38-62 of the same 143-byte record — the two effect slots and their routing.
   *
   * Kept OUT of `params` rather than folded into it, because a slot's parameter set depends
   * on which of the 33 algorithms it holds: a flat `id -> value` bag would have to carry all
   * 33 algorithms' parameters at once, or lose them on every type change. The hardware itself
   * resets an effect's parameters when its type changes (manual p.56), so a slot only ever
   * needs the current algorithm's.
   */
  effects: EffectsState;
}

/**
 * One Combination. `params` is the 124-byte record's parameter bag keyed by ControlDef id —
 * the same contract `program.params` uses, so the SysEx codec, the coalescer and Phase 6's
 * importer are all shared.
 *
 * A COMBINATION HAS ITS OWN EFFECT SECTION. Bytes 11-35 of its record are the same 25-byte
 * block as a program's 38-62, so the store's effect methods act on whichever of the two the
 * current mode selects — see `currentEffects`.
 */
export interface CombiState {
  name: string;
  slot: string | null;
  params: Record<string, number | string>;
  effects: EffectsState;
  /**
   * SOLO, one flag per timbre. **UI only, and deliberately outside the params bag**: the
   * hardware has TIMBRE ON/OFF (which is MUTE, and IS in the record at byte+10 bit4) but no
   * solo at all. Solo is the plugin's addition and a transient performance control, so it
   * must not travel in a saved combination or it would silence seven timbres on load.
   */
  solo: boolean[];
}

export { TIMBRE_COUNT };

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
  return {
    name: 'INIT PROG',
    slot: null,
    params: defaultProgramParams(),
    effects: defaultEffectsState(),
  };
}

export function defaultCombiState(): CombiState {
  return {
    name: 'INIT COMBI',
    slot: null,
    params: defaultCombiParams(),
    effects: defaultEffectsState(),
    solo: Array.from({ length: TIMBRE_COUNT }, () => false),
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
    effects: coalesceEffectsState(raw?.effects),
  };
}

/**
 * Heal the combination.
 *
 * AN INVERTED WINDOW IS NO LONGER ORDERED, AND THAT REVERSES A PHASE 0 DECISION. The Phase 0
 * shell ordered `low > high` on the reasoning that an inverted window "silences a timbre with
 * no visible cause". Phase 5 measured the hardware and the reasoning does not survive: an
 * empty velocity window is Korg's own MECHANISM, not a mistake. The manual states it outright
 * — "If the Velocity SW point is set to 1, the soft Program will not sound" (p.70), which is
 * exactly `velTop = 0 < velBottom = 1` — and the factory bank writes `VEL TOP = 0` on all 174
 * unused timbres of its non-MULTI combinations. Ordering those would make every unused timbre
 * sound. The real concern behind the old decision is answered instead by the timbre strip,
 * which greys a row whose window can never match, so the cause IS visible.
 */
export function coalesceCombiState(raw: Partial<CombiState> | undefined): CombiState {
  const solo = Array.isArray(raw?.solo) ? raw.solo : [];
  return {
    name: str(raw?.name, 'INIT COMBI'),
    slot: nullableStr(raw?.slot),
    params: coalesceCombiParams(raw?.params),
    effects: coalesceEffectsState(raw?.effects),
    solo: Array.from({ length: TIMBRE_COUNT }, (_, i) => bool(solo[i])),
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

  // ---- combinations -------------------------------------------------------------------

  setCombiParam(id: string, value: number | string): void {
    if (typeof value === 'number' && !Number.isFinite(value)) return;
    this.state.combi.params[id] = value;
    this.emit();
  }

  /** Replace several parameters at once — what the derived split-point writers need. */
  setCombiParams(patch: Record<string, number | string>): void {
    for (const [id, value] of Object.entries(patch)) {
      if (typeof value === 'number' && !Number.isFinite(value)) continue;
      this.state.combi.params[id] = value;
    }
    this.emit();
  }

  setCombiName(name: string): void {
    this.state.combi.name = name.slice(0, 10);
    this.emit();
  }

  setCombiType(type: string): void {
    if (!(COMBI_TYPES as readonly string[]).includes(type)) return;
    this.state.combi.params['COMBI_TYPE'] = type;
    this.emit();
  }

  /** SOLO is UI-only and transient — see `CombiState.solo`. */
  setTimbreSolo(timbre: number, on: boolean): void {
    if (timbre < 0 || timbre >= TIMBRE_COUNT) return;
    this.state.combi.solo[timbre] = on === true;
    this.emit();
  }

  getCombiParam(id: string): number | string | undefined {
    return this.state.combi.params[id];
  }

  get combiType(): string {
    return String(this.state.combi.params['COMBI_TYPE'] ?? 'SINGLE');
  }

  get combiName(): string {
    return this.state.combi.name;
  }

  /**
   * Direct scalar reader, NOT `getState().mode`. Same reasoning as `getProgramParam`: the
   * deep copy through the JSON codec returns a fresh tree on every call, so a snapshot taken
   * that way never compares equal and re-renders the whole panel every frame.
   */
  get mode(): Mode {
    return this.state.mode;
  }

  getTimbreSolo(timbre: number): boolean {
    return this.state.combi.solo[timbre] === true;
  }

  get anySolo(): boolean {
    return this.state.combi.solo.some(Boolean);
  }

  // ---- effects ----------------------------------------------------------------------
  //
  // Kept out of the params bags for the reason ProgramState.effects documents: a slot's
  // parameter set depends on its algorithm.
  //
  // THE EFFECT SECTION BELONGS TO WHICHEVER MODE IS CURRENT. A Program carries one at record
  // bytes 38-62 and a Combination carries its own at 11-35 — the same 25-byte block, edited
  // on the same page. Resolving it by mode here is what lets the whole FX panel serve both
  // without knowing which it is looking at.

  private currentEffects(): EffectsState {
    return this.state.mode === 'COMBI' ? this.state.combi.effects : this.state.program.effects;
  }

  /**
   * Select an algorithm for a slot. RESETS that slot's parameters and balances to the
   * algorithm's defaults, which is the hardware's own behaviour (manual p.56: "When
   * selecting the effect type again, effect parameters will be set to the default value").
   *
   * Returns false and changes nothing if the pairing restriction forbids it — Symphonic
   * Ensemble and Rotary Speaker cannot sit opposite an asterisked modulation effect. The UI
   * greys those entries, but enforcing it here too means MIDI and a loaded bundle cannot
   * route around the panel.
   */
  setEffectType(slot: 1 | 2, type: number): boolean {
    const fx = this.currentEffects();
    const other = fx.slots[slot === 1 ? 1 : 0].type;
    const t = Math.min(EFFECT_COUNT, Math.max(0, Math.round(type)));
    if (!effectPairAllowed(t, other)) return false;
    const algo = effectAlgorithm(t);
    fx.slots[slot - 1] = {
      type: t,
      balanceA: algo?.defaultBalance[0] ?? 0,
      balanceB: algo?.defaultBalance[1] ?? 0,
      params: defaultEffectParams(t),
    };
    this.emit();
    return true;
  }

  /** Snaps onto the hardware's quantization grid on the way in — see `snapEffectParam`. */
  setEffectParam(slot: 1 | 2, id: string, value: number | string): void {
    if (typeof value === 'number' && !Number.isFinite(value)) return;
    const s = this.currentEffects().slots[slot - 1]!;
    s.params[id] = snapEffectParam(s.type, id, value);
    this.emit();
  }

  /** Wet percent, 0..100. `which` is A or B — for effects 26-33 those are the two halves. */
  setEffectBalance(slot: 1 | 2, which: 'A' | 'B', value: number): void {
    const v = int(value, 0, 0, 100);
    const s = this.currentEffects().slots[slot - 1]!;
    if (which === 'A') s.balanceA = v;
    else s.balanceB = v;
    this.emit();
  }

  setEffectRouting(serial: boolean): void {
    this.currentEffects().serial = serial === true;
    this.emit();
  }

  setEffectIo(id: 'fx1L' | 'fx1R' | 'fx2L' | 'fx2R', on: boolean): void {
    this.currentEffects()[id] = on === true;
    this.emit();
  }

  /** Output 3/4 pan: 0 = OFF, 1 = R, 2..100 = ratio, 101 = L. Only a Combination can hear it. */
  setEffectOutPan(which: 3 | 4, value: number): void {
    const fx = this.currentEffects();
    const v = int(value, 0, 0, 101);
    if (which === 3) fx.out3Pan = v;
    else fx.out4Pan = v;
    this.emit();
  }

  /** Direct reader for `useSyncExternalStore`, same reasoning as `getProgramParam`. */
  getEffectSlot(slot: 1 | 2): EffectSlotState {
    return this.currentEffects().slots[slot - 1]!;
  }

  getEffectParam(slot: 1 | 2, id: string): number | string | undefined {
    return this.currentEffects().slots[slot - 1]!.params[id];
  }

  get effects(): EffectsState {
    return this.currentEffects();
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
