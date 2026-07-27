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
import {
  coalesceCombiState,
  coalesceExtensionsState,
  coalesceKeyboardState,
  coalesceM1State,
  coalesceMasterState,
  coalesceMode,
  coalesceProgramState,
  coalesceTimbre,
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
    store.setProgramParam('VDF_CUTOFF', 76);
    store.setProgramParam('OSC_MODE', 'DOUBLE');
    const s = store.getState();
    const restored = new M1Store(JSON.parse(JSON.stringify(s)));
    expect(restored.getState()).toEqual(s);
  });

  it('getState() is a deep copy — mutating it cannot reach into the store', () => {
    const store = new M1Store();
    const snapshot = store.getState();
    store.setMasterVolume(0.123);
    store.setProgramParam('VDF_CUTOFF', 99);
    expect(snapshot.master.volume).toBe(0.8);
    expect(snapshot.program.params['VDF_CUTOFF']).toBeUndefined();
    // and mutating the snapshot does not reach back the other way
    snapshot.combi.timbres[0]!.channel = 9;
    expect(store.getState().combi.timbres[0]!.channel).toBe(0);
  });

  it('round-trips a fully populated combi', () => {
    const store = new M1Store();
    const s = store.getState();
    s.mode = 'COMBI';
    s.combi.name = 'Ensemble 2';
    s.combi.type = 'MULTI';
    for (let i = 0; i < TIMBRE_COUNT; i++) {
      const t = s.combi.timbres[i]!;
      t.program = `I${String(i).padStart(2, '0')}`;
      t.channel = i;
      t.keyLow = i * 8;
      t.keyHigh = 60 + i;
      t.velLow = 1 + i;
      t.velHigh = 100 + i;
      t.muted = i % 2 === 0;
    }
    store.setState(s);
    expect(store.getState()).toEqual(s);
    expect(JSON.parse(JSON.stringify(store.getState()))).toEqual(s);
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

  it('coalesceProgramState drops JSON-hostile param values and keeps the rest', () => {
    const raw = {
      name: 'Organ 2',
      slot: 'I17',
      params: {
        VDF_CUTOFF: 99,
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
    expect(p.params).toEqual({ VDF_CUTOFF: 99, OSC_MODE: 'DOUBLE' });
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });

  it('coalesceProgramState defaults a missing name and a non-string slot', () => {
    expect(coalesceProgramState(undefined)).toEqual({
      name: 'INIT PROG',
      slot: null,
      params: {},
    });
    const badSlot = { slot: 42 } as unknown as Parameters<typeof coalesceProgramState>[0];
    expect(coalesceProgramState(badSlot).slot).toBeNull();
  });

  it('coalesceCombiState always yields exactly 8 timbres', () => {
    expect(coalesceCombiState(undefined).timbres).toHaveLength(TIMBRE_COUNT);
    expect(coalesceCombiState({ timbres: [] }).timbres).toHaveLength(TIMBRE_COUNT);
    const short = coalesceCombiState({ timbres: [{ channel: 4 }] } as unknown as Parameters<
      typeof coalesceCombiState
    >[0]);
    expect(short.timbres).toHaveLength(TIMBRE_COUNT);
    expect(short.timbres[0]!.channel).toBe(4);
    expect(short.timbres[7]).toEqual(defaultCombiState().timbres[7]);
  });

  it('coalesceTimbre clamps windows and ORDERS an inverted one', () => {
    // An inverted window silences the timbre with no visible cause — the single most
    // confusing way for a Combination to "not work". Order it instead of trusting it.
    const t = coalesceTimbre({ keyLow: 100, keyHigh: 20, velLow: 120, velHigh: 30 });
    expect(t.keyLow).toBe(20);
    expect(t.keyHigh).toBe(100);
    expect(t.velLow).toBe(30);
    expect(t.velHigh).toBe(120);
  });

  it('coalesceTimbre clamps out-of-range keys, velocities and channels', () => {
    const t = coalesceTimbre({
      channel: 99,
      keyLow: -5,
      keyHigh: 999,
      velLow: 0,
      velHigh: 999,
    });
    expect(t.channel).toBe(15);
    expect(t.keyLow).toBe(0);
    expect(t.keyHigh).toBe(127);
    expect(t.velLow).toBe(1); // velocity 0 is note-off, never a window bound
    expect(t.velHigh).toBe(127);
  });

  it('a hand-mangled tree still coalesces to something that round-trips', () => {
    const mangled = {
      version: 'x',
      mode: 'NOPE',
      master: { volume: 'loud' },
      keyboard: { octave: 'huge' },
      extensions: 'on',
      program: { params: 7 },
      combi: { timbres: 'none' },
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
