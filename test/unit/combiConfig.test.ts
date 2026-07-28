/**
 * The Combination engine layer: the five types, the eight timbres, the panpot, and the
 * audibility sweep that proves each of them reaches the DSP.
 *
 * THE SWEEP IS THE POINT, and it is the cheapest insurance in the project. Phase 3's version
 * found two program parameters that were in the table and wired to nothing; Phase 4's found a
 * grid-snapping bug on the single most load-bearing bit of the phase. The pattern is always
 * the same: set every field live, change ONE, require the render to differ. It is the only
 * test that catches a parameter which exists in the table and never reaches the engine.
 */

import { describe, expect, it } from 'vitest';
import {
  COMBI_PARAMS,
  combiCodecSpec,
  combiParam,
  defaultCombiParams,
  PANPOT_POSITIONS,
  panpotGains,
  writeSplitPoint,
  writeVelSwitchPoint,
  TIMBRE_COUNT,
} from '../../data/combiParams';
import {
  buildCombiTimbres,
  silentTimbre,
  timbreLevelToGain,
  timbreIsSilent,
  windowIsEmpty,
} from '../../src/engine/program/combiConfigCore';
import { SLOT_COUNT } from '../../src/engine/voice/voiceAllocCore';
import {
  neutralControllers,
  timbreMatches,
  VoiceEngine,
  type ProgramConfig,
  type TimbreConfig,
} from '../../src/engine/voice/voiceEngineCore';
import { testOsc, testProgram, testSample } from '../helpers/testProgram';

const SR = 32000;

/**
 * Programs distinguished ONLY by their sample frequency, so a render that mixes two timbres
 * is measurably different from one that plays either alone.
 *
 * THE CONTROLLER DEPTHS ARE NOT DECORATION. The three MIDI-filter bits gate the joystick and
 * aftertouch, so against `neutralControllers()` — which is what `testProgram` gives — flipping
 * a filter changes nothing and the sweep reports the field as dead. It said exactly that, and
 * it was right about the probe rather than the engine: a filter can only be shown to work
 * against a program that has something to filter.
 */
function programAt(freq: number): ProgramConfig {
  const sample = testSample(freq);
  return testProgram({
    osc: [testOsc({ samples: [sample] }), testOsc({ samples: [sample] })],
    controllers: {
      ...neutralControllers(),
      atPitch: 2,
      atCutoff: 0.5,
      atAmp: -0.3,
      jsPitchBend: 2,
      jsCutoffSweep: 0.4,
    },
  });
}

const RESOLVER = (ref: string | null): ProgramConfig | null => {
  if (ref === null) return null;
  // A different pitch per slot, so which program a pointer resolved to is audible.
  const n = Number(ref.slice(1));
  return programAt(180 + n * 20);
};

function timbresFrom(params: Record<string, number | string>, solo?: boolean[]): TimbreConfig[] {
  const resolved = buildCombiTimbres<never>({
    params,
    solo,
    resolveProgram: (ref) => RESOLVER(ref) as never,
  });
  return resolved.map((t) => (t ?? silentTimbre(programAt(220) as never)) as TimbreConfig);
}

/** Render a fixed performance and return the A bus. Deterministic — no PRNG anywhere. */
function renderProbe(params: Record<string, number | string>, solo?: boolean[]): Float32Array {
  const engine = new VoiceEngine(SR);
  engine.setTimbres(timbresFrom(params, solo));
  engine.setGlobalChannel(0);
  engine.setJoystick(0.6, 0.5);
  engine.setAftertouch(0.7);

  const BLOCK = 512;
  const out: number[] = [];
  const a = new Float32Array(BLOCK);
  const b = new Float32Array(BLOCK);
  const c = new Float32Array(BLOCK);
  const d = new Float32Array(BLOCK);
  const run = (blocks: number) => {
    for (let i = 0; i < blocks; i++) {
      engine.renderBuses(a, b, c, d, BLOCK);
      // ALL FOUR BUSES, summed. A sweep that read only A would call the panpot dead for every
      // position that leaves the A/B pair — which is the half of the matrix this phase exists
      // to reach.
      for (let n = 0; n < BLOCK; n++) out.push(a[n]! + b[n]! + c[n]! + d[n]!);
    }
  };

  // Two notes, two velocities, two channels — enough for a key window, a velocity window and
  // a channel filter each to change the result.
  engine.noteOn(48, 110, 0);
  run(10);
  // THE PEDAL, so the per-timbre damper filter has something to gate. Without it, DAMPER is a
  // field that exists in the record and provably changes nothing, which is indistinguishable
  // from a field that is not wired.
  engine.setSustain(true);
  engine.noteOff(48, 0);
  run(8);
  engine.setSustain(false);
  run(4);

  engine.noteOn(84, 30, 0);
  run(10);
  engine.noteOff(84, 0);

  // THE GLOBAL CHANNEL MOVES. Manual p.73: the joystick and aftertouch reach only the timbres
  // on the global channel, so a probe that never moves it can only exercise the AFTER TOUCH
  // and CONTROL CHANGE filters of half the timbres.
  engine.setGlobalChannel(1);
  engine.setJoystick(-0.5, -0.6);
  engine.setAftertouch(0.9);
  engine.noteOn(60, 64, 1);
  run(8);
  // The pedal again, on the OTHER channel — the timbres that sound here are a different four,
  // and each one's damper filter has to be reachable too.
  engine.setSustain(true);
  engine.noteOff(60, 1);
  run(6);
  engine.setSustain(false);
  run(6);
  return Float32Array.from(out);
}

function differs(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
  return false;
}

/**
 * A probe combination with EVERYTHING live: MULTI, all eight timbres sounding, spread across
 * two channels, overlapping windows, distinct programs and pans. A parameter can only be shown
 * to reach the engine against a configuration in which it has something to do.
 */
function probeParams(): Record<string, number | string> {
  const p = defaultCombiParams();
  p['COMBI_TYPE'] = 'MULTI';
  for (let t = 1; t <= TIMBRE_COUNT; t++) {
    p[`T${t}_PROGRAM`] = `I${String(t * 3).padStart(2, '0')}`;
    p[`T${t}_LEVEL`] = 40 + t * 5;
    p[`T${t}_TRANSPOSE`] = t - 4;
    p[`T${t}_DETUNE`] = (t - 4) * 6;
    // Two pans in the A/B half, two in C/D, so both halves of the matrix are exercised.
    p[`T${t}_PAN`] = PANPOT_POSITIONS[(t * 3) % PANPOT_POSITIONS.length]!;
    p[`T${t}_KEY_BOTTOM`] = t * 2;
    p[`T${t}_KEY_TOP`] = 120 - t;
    p[`T${t}_VEL_BOTTOM`] = t;
    p[`T${t}_VEL_TOP`] = 127 - t;
    // Timbres alternate between the global channel and channel 2.
    p[`T${t}_CHANNEL`] = t % 2 === 0 ? 2 : 1;
  }
  return p;
}

/**
 * Fields the sweep cannot judge, each with its reason. Kept explicit and short: a long skip
 * list is how "every parameter is audible" quietly stops being true.
 */
const NOT_AUDIBLE_HERE: Record<string, string> = {
  FILTER_PROGRAM_CHANGE: 'gates incoming MIDI program change, which the engine never receives',
  FILTER_RESERVED: 'undocumented bits, carried verbatim and deliberately not modelled',
  PAN_SOURCE: 'the drum-kit pan source — an honest unknown the factory bank refutes; not modelled',
};

describe('combination audibility sweep — every field reaches the engine', () => {
  const baseline = renderProbe(probeParams());

  it('produces a non-trivial baseline to compare against', () => {
    let peak = 0;
    for (const v of baseline) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.05);
    expect(baseline.every((v) => Number.isFinite(v))).toBe(true);
  });

  /** A legal value for this parameter that is NOT the one the probe already uses. */
  function alternative(id: string, current: number | string): number | string {
    const def = combiParam(id);
    if (def.codec === 'program') return current === 'I01' ? 'I44' : 'I01';
    const spec = combiCodecSpec(def.codec);
    if (spec.positions) {
      return spec.positions.find((v) => v !== current) ?? spec.positions[0]!;
    }
    const mid = (spec.min! + spec.max!) / 2;
    return Number(current) >= mid ? spec.min! : spec.max!;
  }

  for (const def of COMBI_PARAMS) {
    const skip = NOT_AUDIBLE_HERE[def.id.replace(/^T\d_/, '')];
    const name = `${def.id} changes the rendered audio`;
    if (skip) {
      it.skip(`${name} — SKIPPED: ${skip}`, () => {});
      continue;
    }
    it(name, () => {
      const params = probeParams();
      params[def.id] = alternative(def.id, params[def.id]!);
      const changed = renderProbe(params);
      expect(changed.every((v) => Number.isFinite(v)), 'produced a non-finite sample').toBe(true);
      expect(differs(baseline, changed)).toBe(true);
    });
  }

  /** SOLO is not in the record, so the sweep above cannot see it. It is still audible. */
  it('SOLO changes the rendered audio', () => {
    const solo = [false, false, true, false, false, false, false, false];
    expect(differs(baseline, renderProbe(probeParams(), solo))).toBe(true);
  });
});

describe('the panpot is the routing', () => {
  /**
   * The measured constraint, restated as a unit test: a SINGLE Combination timbre at level 99
   * and pan 5:5 must be EXACTLY as loud as the program it points at is in Program mode. In the
   * browser the sum-preserving law made it half — 0.2464 against 0.4927 at note 60, with an
   * identical spectral centroid.
   */
  it('makes a centred timbre identical to Program mode’s fixed 5:5 wiring', () => {
    expect(panpotGains(5)).toEqual([1, 1, 0, 0]);
  });

  /**
   * THE HALF OF THE MATRIX A PROGRAM CANNOT REACH. Buses C and D are silent for every A/B
   * panpot position and carry the whole timbre for `C`, `C+D` and `D` — which is what makes
   * PARALLEL routing mean anything in a Combination and nothing in a Program.
   */
  it('puts a timbre on C/D only when its panpot says so', () => {
    const render = (pan: string): { ab: number; cd: number } => {
      const params = defaultCombiParams();
      params['COMBI_TYPE'] = 'SINGLE';
      params['T1_PAN'] = pan;
      const engine = new VoiceEngine(SR);
      engine.setTimbres(timbresFrom(params));
      const N = 512;
      const [a, b, c, d] = [0, 1, 2, 3].map(() => new Float32Array(N));
      engine.noteOn(60, 100, 0);
      let ab = 0;
      let cd = 0;
      for (let i = 0; i < 12; i++) {
        engine.renderBuses(a!, b!, c!, d!, N);
        for (let n = 0; n < N; n++) {
          ab = Math.max(ab, Math.abs(a![n]!) + Math.abs(b![n]!));
          cd = Math.max(cd, Math.abs(c![n]!) + Math.abs(d![n]!));
        }
      }
      return { ab, cd };
    };

    const centre = render('5:5');
    expect(centre.ab).toBeGreaterThan(0.01);
    expect(centre.cd).toBe(0);

    for (const pan of ['C', 'C+D', 'D']) {
      const r = render(pan);
      expect(r.cd, `${pan} should reach C/D`).toBeGreaterThan(0.01);
      expect(r.ab, `${pan} should leave A/B`).toBe(0);
    }
  });

  it('maps OUTPUT LEVEL so that 99 is unity and 0 is silent', () => {
    // Manual p.65: "when set to 99 is the full volume as set in the Program parameter, and 0
    // mutes the Program completely".
    expect(timbreLevelToGain(99)).toBe(1);
    expect(timbreLevelToGain(0)).toBe(0);
    expect(timbreLevelToGain(50)).toBeCloseTo(50 / 99, 10);
  });
});

describe('the five types resolve to windows, not to five behaviours', () => {
  function windowsFor(type: string, edit?: (p: Record<string, number | string>) => void) {
    const p = defaultCombiParams();
    p['COMBI_TYPE'] = type;
    edit?.(p);
    return timbresFrom(p);
  }

  it('SINGLE uses one timbre and LAYER two, both wide open', () => {
    expect(windowsFor('SINGLE').length).toBe(1);
    const layer = windowsFor('LAYER');
    expect(layer.length).toBe(2);
    for (const t of layer) {
      expect(t.keyLow).toBe(0);
      expect(t.keyHigh).toBe(127);
    }
  });

  /** Manual p.68: "Split point is the lowest key in the upper Program." */
  it('SPLIT puts the point at the boundary, lower timbre below it', () => {
    const t = windowsFor('SPLIT', (p) => Object.assign(p, writeSplitPoint(p, 60)));
    expect(t.length).toBe(2);
    expect(timbreMatches(t[0]!, 59, 100, 0)).toBe(true);
    expect(timbreMatches(t[0]!, 60, 100, 0)).toBe(false);
    expect(timbreMatches(t[1]!, 59, 100, 0)).toBe(false);
    expect(timbreMatches(t[1]!, 60, 100, 0)).toBe(true);
  });

  /** Manual p.70: "If the Velocity SW point is set to 1, the soft Program will not sound." */
  it('VELOCITY SWITCH splits on velocity, and point 1 silences the soft half', () => {
    const t = windowsFor('VELOCITY SWITCH', (p) => Object.assign(p, writeVelSwitchPoint(p, 64)));
    expect(timbreMatches(t[0]!, 60, 63, 0)).toBe(true);
    expect(timbreMatches(t[0]!, 60, 64, 0)).toBe(false);
    expect(timbreMatches(t[1]!, 60, 64, 0)).toBe(true);

    const one = windowsFor('VELOCITY SWITCH', (p) => Object.assign(p, writeVelSwitchPoint(p, 1)));
    for (let v = 1; v <= 127; v++) {
      expect(timbreMatches(one[0]!, 60, v, 0), `velocity ${v}`).toBe(false);
    }
  });

  it('MULTI exposes all eight, and OFF drops a timbre either way it is expressed', () => {
    const p = defaultCombiParams();
    p['COMBI_TYPE'] = 'MULTI';
    p['T3_TIMBRE_OFF'] = 'OFF'; // the inverted bit
    p['T5_PROGRAM'] = 'OFF'; // the MULTI-only 00H program byte
    const resolved = buildCombiTimbres<never>({
      params: p,
      resolveProgram: (ref) => RESOLVER(ref) as never,
    });
    expect(resolved.length).toBe(TIMBRE_COUNT);
    expect(resolved[2]).toBeNull();
    expect(resolved[4]).toBeNull();
    expect(resolved.filter(Boolean).length).toBe(TIMBRE_COUNT - 2);
  });

  /**
   * A dropped timbre must keep its INDEX. The allocator's same-note rule and the engine's
   * per-timbre MG phases both key on it, so closing the gap would silently retune every
   * timbre above a muted one.
   */
  it('leaves a hole rather than shifting the timbres after a dropped one', () => {
    const p = defaultCombiParams();
    p['COMBI_TYPE'] = 'MULTI';
    p['T1_TIMBRE_OFF'] = 'OFF';
    p['T8_PROGRAM'] = 'I77';
    const resolved = buildCombiTimbres<never>({
      params: p,
      resolveProgram: (ref) => RESOLVER(ref) as never,
    });
    expect(resolved[0]).toBeNull();
    expect(resolved.length).toBe(TIMBRE_COUNT);
    expect(resolved[7]).not.toBeNull();
  });

  it('an empty window is reported rather than silently repaired', () => {
    const p = defaultCombiParams();
    p['COMBI_TYPE'] = 'MULTI';
    Object.assign(p, writeVelSwitchPoint(p, 1));
    expect(windowIsEmpty(p, 0)).toBe(true);
    expect(timbreIsSilent(p, 0)).toBe(true);
    expect(windowIsEmpty(p, 1)).toBe(false);
  });
});

describe('allocation is dynamic and unreserved across all eight timbres', () => {
  function engineWith(params: Record<string, number | string>): VoiceEngine {
    const e = new VoiceEngine(SR);
    e.setTimbres(timbresFrom(params));
    e.setGlobalChannel(0);
    return e;
  }

  /**
   * THE RULE THIS PHASE NEEDED FROM THE ALLOCATOR. Two timbres of a LAYER are a different
   * sound on the SAME note and the SAME channel — Korg's own factory bank puts all eight
   * timbres on channel 1 — so without a timbre term in the same-note rule, timbre 2's note-on
   * would steal timbre 1's slot and the layer would collapse to one sound.
   */
  it('gives each timbre of a layer its own slot on the same note and channel', () => {
    const p = defaultCombiParams();
    p['COMBI_TYPE'] = 'LAYER';
    const e = engineWith(p);
    e.noteOn(60, 100, 0);
    expect(e.activeSlots).toBe(2);
    expect(e.activeSlotsOf(0)).toBe(1);
    expect(e.activeSlotsOf(1)).toBe(1);
    // ...and a retrigger reuses those two rather than stacking four.
    e.noteOn(60, 100, 0);
    expect(e.activeSlots).toBe(2);
  });

  it('never exceeds the 16-slot pool, however many timbres want in', () => {
    const p = probeParams();
    for (let t = 1; t <= TIMBRE_COUNT; t++) {
      p[`T${t}_CHANNEL`] = 1; // every timbre on the global channel
      p[`T${t}_KEY_BOTTOM`] = 0;
      p[`T${t}_KEY_TOP`] = 127;
      p[`T${t}_VEL_BOTTOM`] = 1;
      p[`T${t}_VEL_TOP`] = 127;
    }
    const e = engineWith(p);
    for (let n = 48; n < 72; n++) e.noteOn(n, 100, 0);
    expect(e.activeSlots).toBeLessThanOrEqual(SLOT_COUNT);
    // Nothing is reserved and nothing is protected: the last timbres in simply lose.
    let total = 0;
    for (let t = 0; t < TIMBRE_COUNT; t++) total += e.activeSlotsOf(t);
    expect(total).toBe(e.activeSlots);
  });

  it('routes a note only to the timbres whose channel matches', () => {
    const p = defaultCombiParams();
    p['COMBI_TYPE'] = 'MULTI';
    for (let t = 1; t <= TIMBRE_COUNT; t++) p[`T${t}_CHANNEL`] = t; // 1..8 -> channels 0..7
    const e = engineWith(p);
    e.noteOn(60, 100, 3);
    expect(e.activeSlots).toBe(1);
    expect(e.activeSlotsOf(3)).toBe(1);
  });

  /** The damper filter is PER TIMBRE, so one held note can release and another sustain. */
  it('honours a per-timbre damper filter at note-off', () => {
    const p = defaultCombiParams();
    p['COMBI_TYPE'] = 'LAYER';
    p['T1_FILTER_DAMPER'] = 'DIS';
    p['T2_FILTER_DAMPER'] = 'ENA';
    const e = engineWith(p);
    e.setSustain(true);
    e.noteOn(60, 100, 0);
    expect(e.activeSlots).toBe(2);
    e.noteOff(60, 0);
    const a = new Float32Array(512);
    const b = new Float32Array(512);
    // Timbre 1 ignores the pedal and releases; timbre 2 is held by it. The released voice
    // needs a few blocks to run its release out before the slot is freed.
    for (let i = 0; i < 200; i++) e.renderBuses(a, b, null, null, 512);
    expect(e.activeSlotsOf(0)).toBe(0);
    expect(e.activeSlotsOf(1)).toBe(1);
  });
});
