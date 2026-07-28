/**
 * THE state round-trip gate (CLAUDE.md, PLAN.md Phase 0).
 *
 * `JSON.parse(JSON.stringify(getState()))` must equal `getState()`, from day one and
 * for every slice added later. This exists before the engine so that no phase can add
 * a non-serializable field without a red test — retrofitting it after Phase 4 would
 * mean auditing 143 parameters plus 33 effect algorithms by hand.
 *
 * The coalesce tests are the other half: a saved bundle is untrusted input, and the
 * store is the only place that fact gets handled.
 */

import { describe, expect, it } from 'vitest';
import { defaultCombiParams } from '../../data/combiParams';
import { defaultProgramParams, PROGRAM_PARAMS } from '../../data/programParams';
import {
  coalesceCombiState,
  coalesceExtensionsState,
  coalesceKeyboardState,
  coalesceM1State,
  coalesceMasterState,
  coalesceMode,
  coalesceProgramState,
  defaultCombiState,
  defaultExtensionsState,
  defaultM1State,
  M1Store,
  MODES,
  STATE_VERSION,
  TIMBRE_COUNT,
  type M1State,
} from '../../src/state/m1State';

describe('state round-trip', () => {
  it('JSON round-trips the default state', () => {
    const store = new M1Store();
    const s = store.getState();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('setState(getState()) is idempotent', () => {
    const store = new M1Store();
    const before = store.getState();
    store.setState(before);
    expect(store.getState()).toEqual(before);
  });

  it('round-trips through a fresh store built from the serialized tree', () => {
    const store = new M1Store();
    store.setMode('COMBI');
    store.setMasterVolume(0.42);
    store.setExtension('resonance', true);
    store.setProgramParam('OSC1_VDF_CUTOFF', 76);
    store.setProgramParam('OSC_MODE', 'DOUBLE');
    const s = store.getState();
    const restored = new M1Store(JSON.parse(JSON.stringify(s)));
    expect(restored.getState()).toEqual(s);
    // The edits survive the trip, not just the shape.
    expect(restored.getState().program.params.OSC1_VDF_CUTOFF).toBe(76);
    expect(restored.getState().program.params.OSC_MODE).toBe('DOUBLE');
  });

  it('getState() is a deep copy — mutating it cannot reach into the store', () => {
    const store = new M1Store();
    const snapshot = store.getState();
    store.setMasterVolume(0.123);
    store.setProgramParam('VDF_CUTOFF', 99);
    expect(snapshot.master.volume).toBe(0.8);
    expect(snapshot.program.params['VDF_CUTOFF']).toBeUndefined();
    // and mutating the snapshot does not reach back the other way
    snapshot.combi.params['T1_CHANNEL'] = 9;
    expect(store.getState().combi.params['T1_CHANNEL']).toBe(1);
  });

  it('round-trips a fully populated combi', () => {
    const store = new M1Store();
    const s = store.getState();
    s.mode = 'COMBI';
    s.combi.name = 'Ensemble 2';
    s.combi.params['COMBI_TYPE'] = 'MULTI';
    for (let i = 1; i <= TIMBRE_COUNT; i++) {
      s.combi.params[`T${i}_PROGRAM`] = `I${String(i - 1).padStart(2, '0')}`;
      s.combi.params[`T${i}_CHANNEL`] = i;
      s.combi.params[`T${i}_KEY_BOTTOM`] = (i - 1) * 8;
      s.combi.params[`T${i}_KEY_TOP`] = 60 + i;
      s.combi.params[`T${i}_VEL_BOTTOM`] = i;
      s.combi.params[`T${i}_VEL_TOP`] = 100 + i;
      s.combi.params[`T${i}_PAN`] = i % 2 === 0 ? 'C+D' : '5:5';
      s.combi.params[`T${i}_TIMBRE_OFF`] = i % 3 === 0 ? 'OFF' : 'ON';
      s.combi.solo[i - 1] = i === 2;
    }
    store.setState(s);
    expect(store.getState()).toEqual(s);
    expect(JSON.parse(JSON.stringify(store.getState()))).toEqual(s);
  });

  /**
   * SOLO is UI-only and must not survive into the saved record, but it DOES have to survive a
   * state round trip — it lives in the tree, just not in the 124 bytes.
   */
  it('keeps SOLO in the tree as exactly eight booleans', () => {
    expect(defaultCombiState().solo).toEqual(Array(TIMBRE_COUNT).fill(false));
    expect(coalesceCombiState({ solo: [true] } as Partial<M1State['combi']>).solo).toEqual([
      true,
      ...Array(TIMBRE_COUNT - 1).fill(false),
    ]);
    expect(coalesceCombiState({ solo: 'yes' } as unknown as Partial<M1State['combi']>).solo).toEqual(
      Array(TIMBRE_COUNT).fill(false),
    );
  });

  it('a non-finite parameter value never enters the tree', () => {
    // Infinity/NaN serialize to null, which is how a round-trip silently corrupts.
    const store = new M1Store();
    store.setProgramParam('VDF_CUTOFF', Infinity);
    store.setProgramParam('VDA_ATTACK', NaN);
    const s = store.getState();
    expect(s.program.params['VDF_CUTOFF']).toBeUndefined();
    expect(s.program.params['VDA_ATTACK']).toBeUndefined();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('extensions default OFF', () => {
  // CLAUDE.md: plugin-era additions ship switchable and default off, and the Phase 4
  // fidelity gate must pass with them off. A hard invariant, not a preference.
  it('the default tree has every extension off', () => {
    expect(defaultExtensionsState()).toEqual({ resonance: false, insertFx: false });
    expect(defaultM1State().extensions).toEqual({ resonance: false, insertFx: false });
  });

  it('coalesce heals a missing / junk extensions slice to OFF, never ON', () => {
    expect(coalesceExtensionsState(undefined)).toEqual({ resonance: false, insertFx: false });
    expect(coalesceM1State({}).extensions).toEqual({ resonance: false, insertFx: false });
    const junk = { resonance: 1, insertFx: 'yes' } as unknown as Parameters<
      typeof coalesceExtensionsState
    >[0];
    expect(coalesceExtensionsState(junk)).toEqual({ resonance: false, insertFx: false });
  });

  it('an explicit true still round-trips (the switch works, it just never defaults on)', () => {
    expect(coalesceExtensionsState({ resonance: true, insertFx: true })).toEqual({
      resonance: true,
      insertFx: true,
    });
  });
});

describe('coalesce', () => {
  it('coalesceM1State(undefined-ish) yields the default tree', () => {
    expect(coalesceM1State(undefined)).toEqual(defaultM1State());
    expect(coalesceM1State({})).toEqual(defaultM1State());
  });

  it('always stamps the current STATE_VERSION', () => {
    expect(coalesceM1State({ version: 99 } as Partial<M1State>).version).toBe(STATE_VERSION);
  });

  it('coalesceMode passes every real mode and rejects the rest', () => {
    for (const m of MODES) expect(coalesceMode(m)).toBe(m);
    expect(coalesceMode('SEQUENCER')).toBe('PROGRAM'); // Phase 7, not a mode yet
    expect(coalesceMode(3)).toBe('PROGRAM');
    expect(coalesceMode(undefined)).toBe('PROGRAM');
  });

  it('coalesceMasterState clamps volume to 0..1 and defaults non-finite', () => {
    expect(coalesceMasterState({ volume: 5 }).volume).toBe(1);
    expect(coalesceMasterState({ volume: -1 }).volume).toBe(0);
    expect(coalesceMasterState({ volume: NaN }).volume).toBe(0.8);
    expect(coalesceMasterState(undefined).volume).toBe(0.8);
  });

  it('coalesceKeyboardState clamps octave and falls back to OMNI off-range', () => {
    expect(coalesceKeyboardState({ octave: 99, midiChannel: 9 })).toEqual({
      octave: 3,
      midiChannel: 9,
    });
    expect(coalesceKeyboardState({ octave: -99, midiChannel: 16 })).toEqual({
      octave: -3,
      midiChannel: -1,
    });
    expect(coalesceKeyboardState({ midiChannel: 3.5 }).midiChannel).toBe(-1);
    expect(coalesceKeyboardState(undefined)).toEqual({ octave: 0, midiChannel: -1 });
  });

  it('coalesceProgramState keeps valid params, heals the rest, and drops unknowns', () => {
    // Since Phase 3 the params bag IS the 143-byte SysEx table, not a free-form map: every
    // known parameter is present afterwards, unknown keys are dropped, and JSON-hostile
    // values can no longer reach the tree at all.
    const raw = {
      name: 'Organ 2',
      slot: 'I17',
      params: {
        OSC1_VDF_CUTOFF: 99,
        OSC_MODE: 'DOUBLE',
        BAD_INF: Infinity,
        BAD_NAN: NaN,
        BAD_OBJ: { nope: true },
        BAD_UNDEF: undefined,
      },
    } as unknown as Parameters<typeof coalesceProgramState>[0];
    const p = coalesceProgramState(raw);
    expect(p.name).toBe('Organ 2');
    expect(p.slot).toBe('I17');
    expect(p.params.OSC1_VDF_CUTOFF).toBe(99);
    expect(p.params.OSC_MODE).toBe('DOUBLE');
    for (const bad of ['BAD_INF', 'BAD_NAN', 'BAD_OBJ', 'BAD_UNDEF']) {
      expect(p.params[bad], bad).toBeUndefined();
    }
    expect(Object.keys(p.params)).toHaveLength(PROGRAM_PARAMS.length);
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });

  it('coalesceProgramState defaults a missing name and a non-string slot', () => {
    const healed = coalesceProgramState(undefined);
    expect(healed.name).toBe('INIT PROG');
    expect(healed.slot).toBeNull();
    expect(healed.params).toEqual(defaultProgramParams());
    const badSlot = { slot: 42 } as unknown as Parameters<typeof coalesceProgramState>[0];
    expect(coalesceProgramState(badSlot).slot).toBeNull();
  });

  it('coalesceCombiState always yields all eight timbres’ parameters', () => {
    const healed = coalesceCombiState(undefined);
    expect(healed.params).toEqual(defaultCombiParams());
    for (let t = 1; t <= TIMBRE_COUNT; t++) {
      expect(healed.params[`T${t}_PROGRAM`]).toBeDefined();
      expect(healed.params[`T${t}_CHANNEL`]).toBeDefined();
    }
    const partial = coalesceCombiState({ params: { T1_CHANNEL: 5 } });
    expect(partial.params['T1_CHANNEL']).toBe(5);
    expect(partial.params['T8_CHANNEL']).toBe(defaultCombiParams()['T8_CHANNEL']);
  });

  /**
   * PHASE 5 REVERSES A PHASE 0 DECISION, WITH EVIDENCE. The shell ordered an inverted window
   * because it "silences a timbre with no visible cause". Measured against the hardware, an
   * empty window is Korg's OWN mechanism: manual p.70 says a velocity switch point of 1 must
   * silence the soft program, which is `velTop = 0 < velBottom = 1`, and the factory bank
   * writes exactly that on all 174 unused timbres of its non-MULTI combinations. Ordering
   * them would make every unused timbre sound.
   */
  it('does NOT order an inverted window — an empty one is the hardware’s own mechanism', () => {
    const healed = coalesceCombiState({
      params: { T1_KEY_BOTTOM: 100, T1_KEY_TOP: 20, T1_VEL_BOTTOM: 120, T1_VEL_TOP: 0 },
    });
    expect(healed.params['T1_KEY_BOTTOM']).toBe(100);
    expect(healed.params['T1_KEY_TOP']).toBe(20);
    expect(healed.params['T1_VEL_BOTTOM']).toBe(120);
    expect(healed.params['T1_VEL_TOP']).toBe(0);
  });

  it('clamps out-of-range keys, velocities and channels', () => {
    const healed = coalesceCombiState({
      params: {
        T1_CHANNEL: 99,
        T1_KEY_BOTTOM: -5,
        T1_KEY_TOP: 999,
        T1_VEL_BOTTOM: 0,
        T1_VEL_TOP: 999,
      },
    });
    expect(healed.params['T1_CHANNEL']).toBe(16);
    expect(healed.params['T1_KEY_BOTTOM']).toBe(0);
    expect(healed.params['T1_KEY_TOP']).toBe(127);
    // VEL BOTTOM's range is 01~7F: velocity 0 is note-off, never a window bound.
    expect(healed.params['T1_VEL_BOTTOM']).toBe(1);
    expect(healed.params['T1_VEL_TOP']).toBe(127);
  });

  it('a hand-mangled tree still coalesces to something that round-trips', () => {
    const mangled = {
      version: 'x',
      mode: 'NOPE',
      master: { volume: 'loud' },
      keyboard: { octave: 'huge' },
      extensions: 'on',
      program: { params: 7 },
      combi: { params: 'none', solo: 'none' },
    } as unknown as Partial<M1State>;
    const healed = coalesceM1State(mangled);
    expect(healed).toEqual(defaultM1State());
    expect(JSON.parse(JSON.stringify(healed))).toEqual(healed);
  });
});

describe('store subscriptions', () => {
  it('notifies subscribers on write and stops after unsubscribe', () => {
    const store = new M1Store();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.setMasterVolume(0.5);
    store.setMode('COMBI');
    expect(calls).toBe(2);
    off();
    store.setMasterVolume(0.6);
    expect(calls).toBe(2);
  });
});
