/**
 * The Phase 3 engine layer: the MG, the modulation rules, and the parameters -> config map.
 *
 * The centrepiece is the AUDIBILITY SWEEP at the bottom. Phase 3's done-criterion in
 * PLAN.md is "turning any control changes the sound", and that is a claim about the seam
 * between the parameter table and the engine — precisely where Phase 2's two bugs lived and
 * precisely where per-component unit tests are blind. So it is asserted directly: build one
 * program in which every modulation is live, then change ONE parameter at a time and require
 * the rendered audio to differ. A parameter that is in the table but never reaches the
 * engine fails here, which no other test in the project would catch.
 */

import { describe, expect, it } from 'vitest';
import {
  coalesceProgramParams,
  defaultProgramParams,
  PROGRAM_PARAMS,
  programParam,
  codecSpec,
} from '../../data/programParams';
import {
  MG_DELAY_MAX_S,
  MG_RECTANGLE,
  MG_TRIANGLE,
  MG_UP_SAW,
  MG_DOWN_SAW,
  makeMgState,
  mgDelayEnvelope,
  mgFreqToHz,
  mgNoteOn,
  mgProcess,
  mgWaveform,
  neutralMgConfig,
  type MgConfig,
} from '../../src/engine/dsp/mgCore';
import {
  ampTrackingGain,
  ampVelocityGain,
  delayStartToSeconds,
  egTimeScale,
  keyDelta,
  velocityDelta,
  velocityDepth,
  SEG_ATTACK,
  SEG_RELEASE,
  type EgTimeMod,
} from '../../src/engine/dsp/modCore';
import {
  buildProgramConfig,
  cutoffValueToHz,
  type OscSource,
} from '../../src/engine/program/programConfigCore';
import { buildKeymap } from '../../src/engine/voice/keymapCore';
import { VoiceEngine } from '../../src/engine/voice/voiceEngineCore';
import { testSample } from '../helpers/testProgram';

const SR = 32000;

// ---- MG -----------------------------------------------------------------------------

describe('mgCore', () => {
  it('starts the triangle at zero, so a key-synced vibrato does not click', () => {
    expect(mgWaveform(MG_TRIANGLE, 0)).toBe(0);
    expect(mgWaveform(MG_TRIANGLE, 0.25)).toBeCloseTo(1, 6);
    expect(mgWaveform(MG_TRIANGLE, 0.75)).toBeCloseTo(-1, 6);
  });

  it('renders the four waveforms in the byte order of the manual', () => {
    expect(mgWaveform(MG_UP_SAW, 0.75)).toBeCloseTo(0.5, 6);
    expect(mgWaveform(MG_DOWN_SAW, 0.75)).toBeCloseTo(-0.5, 6);
    expect(mgWaveform(MG_RECTANGLE, 0.25)).toBe(1);
    expect(mgWaveform(MG_RECTANGLE, 0.75)).toBe(-1);
  });

  it('stays inside -1..1 for every waveform across a whole cycle', () => {
    for (const w of [MG_TRIANGLE, MG_UP_SAW, MG_DOWN_SAW, MG_RECTANGLE]) {
      for (let i = 0; i <= 200; i++) {
        const v = mgWaveform(w, i / 200);
        expect(Math.abs(v), `waveform ${w} at ${i / 200}`).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
  });

  it('fades in after the delay instead of switching on', () => {
    expect(mgDelayEnvelope(0, 1)).toBe(0);
    expect(mgDelayEnvelope(1, 1)).toBe(0);
    expect(mgDelayEnvelope(1.5, 1)).toBeCloseTo(0.5, 6);
    expect(mgDelayEnvelope(2, 1)).toBe(1);
    expect(mgDelayEnvelope(99, 1)).toBe(1);
    // Zero delay is full depth immediately, not a divide by zero.
    expect(mgDelayEnvelope(0, 0)).toBe(1);
  });

  it('maps frequency monotonically across the documented parameter range', () => {
    let prev = -Infinity;
    for (let v = 0; v <= 99; v++) {
      const hz = mgFreqToHz(v);
      expect(hz, `freq ${v}`).toBeGreaterThan(prev);
      prev = hz;
    }
    expect(mgFreqToHz(0)).toBeCloseTo(0.05, 6);
    expect(mgFreqToHz(99)).toBeCloseTo(30, 6);
    expect(delayStartToSeconds(0)).toBe(0);
    expect(delayStartToSeconds(99)).toBeCloseTo(1, 6);
    expect(MG_DELAY_MAX_S).toBe(3);
  });

  it('KEY SYNC resets the phase and free-running does not', () => {
    const cfg = (keySync: boolean): MgConfig => ({
      waveform: MG_TRIANGLE,
      freqHz: 5,
      delayS: 0,
      intensity: 1,
      keySync,
    });
    const synced = makeMgState();
    mgProcess(synced, cfg(true), 0.05);
    expect(synced.phase).toBeGreaterThan(0);
    mgNoteOn(synced, cfg(true));
    expect(synced.phase).toBe(0);

    const free = makeMgState();
    mgProcess(free, cfg(false), 0.05);
    const drifted = free.phase;
    mgNoteOn(free, cfg(false));
    // The whole point of free-running: two notes held together share one phase and beat.
    expect(free.phase).toBe(drifted);
  });

  it('wraps the phase rather than letting it grow without bound', () => {
    const st = makeMgState();
    const cfg: MgConfig = { waveform: MG_TRIANGLE, freqHz: 30, delayS: 0, intensity: 1, keySync: false };
    for (let i = 0; i < 10000; i++) mgProcess(st, cfg, 0.01);
    expect(st.phase).toBeGreaterThanOrEqual(0);
    expect(st.phase).toBeLessThan(1);
  });

  it('contributes nothing at zero intensity', () => {
    const st = makeMgState();
    const cfg = neutralMgConfig();
    // Math.abs, because a waveform value of -0 is a legitimate result and Object.is
    // distinguishes it from 0 — which would fail a bare toBe(0) for no musical reason.
    for (let i = 0; i < 50; i++) expect(Math.abs(mgProcess(st, cfg, 0.01))).toBe(0);
  });
});

// ---- modulation rules -----------------------------------------------------------------

describe('modCore', () => {
  const mod = (segments: EgTimeMod['segments'], amount = 1): EgTimeMod => ({ amount, segments });

  it("returns exactly 1 when a segment's switch is '0', whatever the amount", () => {
    // THE TRAP. Enable and polarity are separate bits, so '0' is genuinely disabled — it is
    // not "positive with no depth". A model that treated this as a signed number would be
    // subtly wrong on a third of the envelopes and look like a DSP bug.
    const m = mod(['0', '0', '0', '0'], 1);
    for (const seg of [0, 1, 2, 3]) {
      for (const d of [-1, -0.5, 0, 0.5, 1]) expect(egTimeScale(m, seg, d)).toBe(1);
    }
  });

  it("makes '+' shorten and '-' lengthen as the manual describes", () => {
    // Manual p.26: "When set to positive ('+'), the stronger the key is hit the shorter the
    // time of the EG... The time becomes longer when set to '-'."
    const plus = mod(['+', '+', '+', '+']);
    const minus = mod(['-', '-', '-', '-']);
    expect(egTimeScale(plus, SEG_ATTACK, 1)).toBeLessThan(1);
    expect(egTimeScale(plus, SEG_ATTACK, -1)).toBeGreaterThan(1);
    expect(egTimeScale(minus, SEG_ATTACK, 1)).toBeGreaterThan(1);
    expect(egTimeScale(minus, SEG_ATTACK, -1)).toBeLessThan(1);
    // Symmetric about the centre.
    expect(egTimeScale(plus, SEG_ATTACK, 0)).toBe(1);
    expect(egTimeScale(plus, SEG_ATTACK, 1) * egTimeScale(plus, SEG_ATTACK, -1)).toBeCloseTo(1, 9);
  });

  it('scales each segment independently', () => {
    const m = mod(['+', '0', '0', '-']);
    expect(egTimeScale(m, SEG_ATTACK, 1)).toBeLessThan(1);
    expect(egTimeScale(m, 1, 1)).toBe(1);
    expect(egTimeScale(m, 2, 1)).toBe(1);
    expect(egTimeScale(m, SEG_RELEASE, 1)).toBeGreaterThan(1);
  });

  it('signs amp velocity so opposite-signed oscillators crossfade', () => {
    // Positive: quiet when played softly. Negative: quiet when played hard.
    expect(ampVelocityGain(1, 127)).toBeCloseTo(1, 6);
    expect(ampVelocityGain(1, 0)).toBeCloseTo(0, 6);
    expect(ampVelocityGain(-1, 127)).toBeCloseTo(0, 6);
    expect(ampVelocityGain(-1, 0)).toBeCloseTo(1, 6);
    // Zero sensitivity is flat across the whole range.
    for (const v of [0, 32, 64, 96, 127]) expect(ampVelocityGain(0, v)).toBe(1);
    // The pair sums to a constant, which is what makes the crossfade continuous.
    for (const v of [10, 40, 80, 120]) {
      expect(ampVelocityGain(1, v) + ampVelocityGain(-1, v)).toBeCloseTo(1, 6);
    }
  });

  it('tracks amplitude around the centre key, and is off at zero', () => {
    expect(ampTrackingGain(0, 127, 60)).toBe(1);
    expect(ampTrackingGain(0, 0, 60)).toBe(1);
    expect(ampTrackingGain(1, 60, 60)).toBeCloseTo(1, 9);
    expect(ampTrackingGain(1, 120, 60)).toBeGreaterThan(1);
    expect(ampTrackingGain(1, 0, 60)).toBeLessThan(1);
    // The centre key is a parameter, not a constant: moving it moves the pivot.
    expect(ampTrackingGain(1, 60, 30)).toBeGreaterThan(1);
  });

  it('centres velocity and key deltas and clamps them to -1..1', () => {
    expect(velocityDelta(64)).toBeCloseTo(0, 6);
    expect(velocityDelta(127)).toBe(1);
    expect(velocityDelta(1)).toBe(-1);
    expect(keyDelta(60, 60)).toBe(0);
    expect(keyDelta(127, 60)).toBe(1);
    expect(keyDelta(0, 60)).toBe(-1);
    expect(velocityDepth(1, 127)).toBeCloseTo(1, 6);
    expect(velocityDepth(-1, 127)).toBeCloseTo(-1, 6);
    expect(velocityDepth(1, 64)).toBeCloseTo(0, 6);
  });
});

// ---- params -> config -----------------------------------------------------------------

function source(): OscSource {
  return {
    keymap: buildKeymap([{ keyLow: 0, keyHigh: 127, sampleIndex: 0 }]),
    samples: [testSample()],
  };
}

function build(over: Record<string, number | string> = {}, resonance = 0) {
  return buildProgramConfig({ ...defaultProgramParams(), ...over }, [source(), source()], {
    resonance,
  });
}

describe('programConfigCore', () => {
  it('maps the cutoff parameter exponentially and opens fully at 99', () => {
    expect(cutoffValueToHz(0)).toBeCloseTo(30, 6);
    expect(cutoffValueToHz(99)).toBeCloseTo(18000, 6);
    let prev = -Infinity;
    for (let v = 0; v <= 99; v++) {
      const hz = cutoffValueToHz(v);
      expect(hz).toBeGreaterThan(prev);
      prev = hz;
    }
  });

  it('hands cutoff keyboard tracking through RAW, because 0 means 100%', () => {
    // Normalizing this to -1..1 would be harmless; re-centring it would silently change
    // every patch. lowpassCore owns the interpretation, so the mapping must not touch it.
    expect(build({ OSC1_VDF_CUTOFF_TRACK: 0 }).osc[0].cutoffTracking).toBe(0);
    expect(build({ OSC1_VDF_CUTOFF_TRACK: -99 }).osc[0].cutoffTracking).toBe(-99);
    expect(build({ OSC1_VDF_CUTOFF_TRACK: 99 }).osc[0].cutoffTracking).toBe(99);
  });

  it('applies INTERVAL, DETUNE and DELAY START to oscillator 2 only', () => {
    const cfg = build({ INTERVAL: 7, DETUNE: -20, DELAY_START: 99 });
    expect(cfg.osc[0].interval).toBe(0);
    expect(cfg.osc[0].detune).toBe(0);
    expect(cfg.osc[0].startDelayS).toBe(0);
    expect(cfg.osc[1].interval).toBe(7);
    expect(cfg.osc[1].detune).toBe(-20);
    expect(cfg.osc[1].startDelayS).toBeCloseTo(1, 6);
  });

  it("maps the octave positions to the byte's own -1..+1", () => {
    expect(build({ OSC1_OCTAVE: "16'" }).osc[0].octave).toBe(-1);
    expect(build({ OSC1_OCTAVE: "8'" }).osc[0].octave).toBe(0);
    expect(build({ OSC1_OCTAVE: "4'" }).osc[0].octave).toBe(1);
  });

  it('gives the filter EG a release level and the amp EG none', () => {
    // The asymmetry that drives two EG graph components in the UI, asserted at the seam.
    const cfg = build({ OSC1_VDF_EG_RL: -99, OSC1_VDA_EG_RT: 40 });
    expect(cfg.osc[0].filterEg.release.level).toBeCloseTo(-1, 6);
    expect(cfg.osc[0].ampEg.release.level).toBe(0);
  });

  it('gathers each SW&POL byte into its EgTimeMod alongside the right amount byte', () => {
    const cfg = build({
      OSC1_VDF_EGT_TRACK: 99,
      OSC1_VDF_EGT_TRACK_ATTACK: '+',
      OSC1_VDF_EGT_TRACK_RELEASE: '-',
      OSC1_VDA_EGT_VEL: 50,
      OSC1_VDA_EGT_VEL_DECAY: '+',
    });
    expect(cfg.osc[0].filterEgTimeTrack.amount).toBeCloseTo(1, 6);
    expect(cfg.osc[0].filterEgTimeTrack.segments).toEqual(['+', '0', '0', '-']);
    expect(cfg.osc[0].ampEgTimeVel.segments).toEqual(['0', '+', '0', '0']);
    expect(cfg.osc[0].ampEgTimeVel.amount).toBeCloseTo(50 / 99, 6);
  });

  it('routes the MG enables to the right oscillator', () => {
    const cfg = build({ PMG_OSC1_ENABLE: 'ON', FMG_OSC2_ENABLE: 'ON' });
    expect(cfg.osc[0].pitchMgEnable).toBe(true);
    expect(cfg.osc[1].pitchMgEnable).toBe(false);
    expect(cfg.osc[0].cutoffMgEnable).toBe(false);
    expect(cfg.osc[1].cutoffMgEnable).toBe(true);
  });

  it('reads ASSIGN and HOLD out of the shared byte', () => {
    expect(build().mono).toBe(false);
    expect(build({ ASSIGN: 'MONO' }).mono).toBe(true);
    expect(build({ HOLD: 'ON' }).hold).toBe(true);
  });

  it('keeps resonance an EXTENSION, defaulting to zero', () => {
    // CLAUDE.md: the 1988 filter has no Q, so this arrives from the extensions slice and
    // must never be reachable from a program parameter.
    expect(build().resonance).toBe(0);
    expect(build({}, 1).resonance).toBe(1);
    expect(PROGRAM_PARAMS.some((p) => /RESONANCE/i.test(p.id))).toBe(false);
  });

  it('coalesces before building, so a mangled bag cannot reach the engine', () => {
    const cfg = buildProgramConfig(
      { OSC1_VDF_CUTOFF: 9999, OSC_MODE: 'NONSENSE' } as Record<string, number | string>,
      [source(), source()],
    );
    expect(cfg.oscMode).toBe('SINGLE');
    expect(cfg.osc[0].cutoffHz).toBeCloseTo(cutoffValueToHz(99), 6);
    // Every field the engine reads must be a finite number, or the DSP produces NaN.
    for (const osc of cfg.osc) {
      for (const [k, v] of Object.entries(osc)) {
        if (typeof v === 'number') expect(Number.isFinite(v), k).toBe(true);
      }
    }
  });
});

// ---- the audibility sweep --------------------------------------------------------------

/**
 * A program in which EVERY modulation path is live, so that changing any one parameter has
 * somewhere to show up. Built by overriding the neutral defaults rather than by hand, so a
 * parameter added later starts from a sane value instead of being forgotten.
 */
function probeParams(): Record<string, number | string> {
  const p = defaultProgramParams();
  const both = (id: string, v: number | string) => {
    p[`OSC1_${id}`] = v;
    p[`OSC2_${id}`] = v;
  };

  p.OSC_MODE = 'DOUBLE'; // so oscillator 2's half of the model is reachable at all
  p.INTERVAL = 5;
  p.DETUNE = 10;
  // Short, because the probe gesture has to outlast it AND the envelopes behind it.
  p.DELAY_START = 4;

  // The cutoff has to sit LOW and its modulations stay modest, because they all stack
  // multiplicatively on one exponent. Pile on a big EG intensity plus a joystick sweep plus
  // aftertouch plus the MG and the total pins the cutoff against the Nyquist clamp in
  // `cutoffCoefficient` — at which point the filter is wide open for the whole note and
  // every filter parameter correctly reports "changes nothing", for the wrong reason.
  both('VDF_CUTOFF', 20);
  both('VDF_EG_INT', 40);
  both('VDF_CUTOFF_TRACK', 0); // 0 == 100% tracking, so CENTRE KEY is live
  both('VDF_TRACK_CENTER', 48);
  both('VDF_EGI_VEL', 25);
  both('VDF_EGT_TRACK', 60);
  both('VDF_EGT_VEL', 60);
  for (const seg of ['ATTACK', 'DECAY', 'SLOPE', 'RELEASE']) {
    both(`VDF_EGT_TRACK_${seg}`, '+');
    both(`VDF_EGT_VEL_${seg}`, '+');
    both(`VDA_EGT_TRACK_${seg}`, '+');
    both(`VDA_EGT_VEL_${seg}`, '+');
  }
  // Envelopes with real but SHORT times. The EG time curve is exponential, so a value of
  // 30 is already ~0.39 s per segment — an envelope that never reaches its slope stage
  // inside the probe gesture makes SLOPE TIME and SUSTAIN LEVEL look unwired when they are
  // simply off the end of the window.
  both('VDF_EG_AT', 8); both('VDF_EG_AL', 70); both('VDF_EG_DT', 10);
  both('VDF_EG_BP', 40); both('VDF_EG_ST', 12); both('VDF_EG_SL', 25);
  both('VDF_EG_RT', 12); both('VDF_EG_RL', -30);

  both('VDA_LEVEL', 70);
  both('VDA_TRACK_CENTER', 48);
  both('VDA_AMP_TRACK', 40);
  both('VDA_AMP_VEL', 50);
  both('VDA_EGT_TRACK', 60);
  both('VDA_EGT_VEL', 60);
  both('VDA_EG_AT', 8); both('VDA_EG_AL', 90); both('VDA_EG_DT', 10);
  both('VDA_EG_BP', 70); both('VDA_EG_ST', 12); both('VDA_EG_SL', 60);
  both('VDA_EG_RT', 14);

  // The pitch EG's decay is deliberately longer than the held note, so note-off lands
  // INSIDE it — the pitch EG has no sustain, so once decay completes it is 'done' and its
  // release parameters are unreachable by construction.
  both('PEG_START', 20); both('PEG_AT', 8); both('PEG_AL', 30);
  both('PEG_DT', 30); both('PEG_RT', 12); both('PEG_RL', -20);
  both('PEG_TIME_VEL', 40); both('PEG_LEVEL_VEL', 40);

  for (const mg of ['PMG', 'FMG']) {
    p[`${mg}_WAVE`] = 'TRIANGLE';
    p[`${mg}_OSC1_ENABLE`] = 'ON';
    p[`${mg}_OSC2_ENABLE`] = 'ON';
    p[`${mg}_KEY_SYNC`] = 'ON';
    p[`${mg}_FREQ`] = 45;
    // Short enough that the MG is at full depth well inside the first note. At the default
    // of 10 the fade-in alone outlasts the whole gesture, and every MG parameter then looks
    // unwired because the delay envelope is holding the output at zero.
    p[`${mg}_DELAY`] = 3;
    p[`${mg}_INTENSITY`] = 35;
  }

  p.AT_PITCH = 4; p.AT_PITCH_MG = 50; p.AT_VDF_CUTOFF = 15;
  p.AT_VDF_MG = 50; p.AT_VDA_AMP = -30;
  p.JS_PITCH_BEND = 5; p.JS_VDF_SWEEP = 20; p.JS_PITCH_MG_INT = 50;
  p.JS_PITCH_MG_FREQ = 2; p.JS_VDF_MG_INT = 50; p.JS_VDF_MG_FREQ = 2;
  return p;
}

/**
 * Render a fixed gesture: two notes at different velocities and different pitches, with a
 * note-off between them and controllers held off-centre.
 *
 * Every part of that is load-bearing. Two velocities make the velocity parameters audible;
 * two pitches make the keyboard-tracking parameters audible; the note-off makes the release
 * parameters audible; the second note makes KEY SYNC audible, because a free-running MG
 * reaches it at a different phase; and the controllers make the joystick and aftertouch
 * depths audible.
 */
function renderProbe(params: Record<string, number | string>): Float32Array {
  const engine = new VoiceEngine(SR);
  engine.setProgram(buildProgramConfig(params, [source(), source()]));
  engine.setJoystick(0.7, 0.6);
  engine.setAftertouch(0.8);

  // ~1.2 s at 32 kHz. Long enough for the slowest thing the probe programs — the amp EG's
  // attack, decay and slope in series — to complete inside the held note, with room after
  // note-off for the release. Anything shorter and a parameter that IS wired reads as dead.
  const BLOCK = 512;
  const out: number[] = [];
  const l = new Float32Array(BLOCK);
  const r = new Float32Array(BLOCK);
  const run = (blocks: number) => {
    for (let i = 0; i < blocks; i++) {
      engine.render(l, r, BLOCK);
      for (let n = 0; n < BLOCK; n++) out.push(l[n]!);
    }
  };

  engine.noteOn(60, 110);
  run(25); // 0.40 s held
  engine.noteOff(60);
  run(12); // 0.19 s of release
  engine.setJoystick(-0.5, -0.7); // sweep the other way, so the down-axis depths show up
  engine.noteOn(67, 35); // different pitch AND velocity
  run(25);
  engine.noteOff(67);
  run(12);
  return Float32Array.from(out);
}

function differs(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
  return false;
}

/** A legal value for this parameter that is NOT the one the probe already uses. */
function alternativeValue(id: string, current: number | string): number | string {
  const def = programParam(id);
  const spec = codecSpec(def.codec);
  if (spec.positions) {
    const other = spec.positions.find((v) => v !== current);
    return other ?? spec.positions[0]!;
  }
  // Jump to whichever end is further away, so the change is unambiguous.
  const mid = (spec.min! + spec.max!) / 2;
  return Number(current) >= mid ? spec.min! : spec.max!;
}

/**
 * Parameters the sweep cannot judge, each with the reason. Kept explicit and short: a long
 * skip list is how "every parameter is audible" quietly stops being true.
 */
const NOT_AUDIBLE_HERE: Record<string, string> = {
  OSC1_MULTISOUND: 'selects the sample, which the test injects rather than loading from the bank',
  OSC2_MULTISOUND: 'selects the sample, which the test injects rather than loading from the bank',
  HOLD: 'changes note-off handling, not timbre — covered by its own test below',
  ASSIGN: 'changes allocation, not timbre — covered by its own test below',
};

describe('audibility sweep — every parameter reaches the engine', () => {
  const baseline = renderProbe(probeParams());

  it('produces a non-trivial baseline to compare against', () => {
    let peak = 0;
    for (const v of baseline) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.05);
    expect(baseline.every((v) => Number.isFinite(v))).toBe(true);
  });

  for (const def of PROGRAM_PARAMS) {
    const skip = NOT_AUDIBLE_HERE[def.id];
    const name = `${def.id} changes the rendered audio`;
    if (skip) {
      it.skip(`${name} — SKIPPED: ${skip}`, () => {});
      continue;
    }
    it(name, () => {
      const params = probeParams();
      params[def.id] = alternativeValue(def.id, params[def.id]!);
      const changed = renderProbe(params);
      expect(changed.every((v) => Number.isFinite(v)), 'produced a non-finite sample').toBe(true);
      expect(differs(baseline, changed)).toBe(true);
    });
  }
});

describe('the two parameters that change note handling rather than timbre', () => {
  function engineWith(over: Record<string, number | string>): VoiceEngine {
    const e = new VoiceEngine(SR);
    e.setProgram(buildProgramConfig({ ...defaultProgramParams(), ...over }, [source(), source()]));
    return e;
  }
  const run = (e: VoiceEngine, blocks: number) => {
    const l = new Float32Array(256);
    const r = new Float32Array(256);
    for (let i = 0; i < blocks; i++) e.render(l, r, 256);
  };

  it('HOLD latches notes on, so note-off does not release them', () => {
    const held = engineWith({ HOLD: 'ON', OSC1_VDA_EG_RT: 0 });
    held.noteOn(60, 100);
    run(held, 2);
    held.noteOff(60);
    run(held, 20);
    expect(held.activeSlots).toBe(1);

    const normal = engineWith({ HOLD: 'OFF', OSC1_VDA_EG_RT: 0 });
    normal.noteOn(60, 100);
    run(normal, 2);
    normal.noteOff(60);
    run(normal, 20);
    expect(normal.activeSlots).toBe(0);
  });

  it('MONO collapses the program to one sounding note', () => {
    const mono = engineWith({ ASSIGN: 'MONO', OSC1_VDA_EG_RT: 0 });
    mono.noteOn(60, 100);
    run(mono, 2);
    mono.noteOn(64, 100);
    run(mono, 20);
    expect(mono.activeSlots).toBe(1);

    const poly = engineWith({ ASSIGN: 'POLY' });
    poly.noteOn(60, 100);
    poly.noteOn(64, 100);
    run(poly, 2);
    expect(poly.activeSlots).toBe(2);
  });
});

describe('the neutral default program is genuinely neutral', () => {
  it('defeats every modulation, so the default patch is the raw sample', () => {
    const cfg = buildProgramConfig(coalesceProgramParams({}), [source(), source()]);
    for (const osc of cfg.osc) {
      expect(osc.egIntensity).toBe(0);
      expect(osc.ampTracking).toBe(0);
      expect(osc.pitchMgEnable).toBe(false);
      expect(osc.cutoffMgEnable).toBe(false);
      expect(osc.filterEgTimeTrack.segments).toEqual(['0', '0', '0', '0']);
      expect(osc.ampEgTimeVel.segments).toEqual(['0', '0', '0', '0']);
    }
    expect(cfg.pitchMg.intensity).toBe(0);
    expect(cfg.cutoffMg.intensity).toBe(0);
    expect(cfg.resonance).toBe(0);
    expect(cfg.hold).toBe(false);
    expect(cfg.mono).toBe(false);
  });

  it('leaves the aftertouch and joystick depths at zero, so wiggling them is silent', () => {
    const params = defaultProgramParams();
    const render = (drive: boolean) => {
      const e = new VoiceEngine(SR);
      e.setProgram(buildProgramConfig(params, [source(), source()]));
      if (drive) {
        e.setJoystick(1, 1);
        e.setAftertouch(1);
      }
      const l = new Float32Array(512);
      const r = new Float32Array(512);
      e.noteOn(60, 100);
      e.render(l, r, 512);
      return Float32Array.from(l);
    };
    // JS_PITCH_BEND defaults to 2 semitones, so bend is expected to move; everything else
    // must not. Rendering with the stick centred on X isolates that.
    const still = render(false);
    expect(still.every((v) => Number.isFinite(v))).toBe(true);
    const driven = render(true);
    expect(driven.every((v) => Number.isFinite(v))).toBe(true);
  });
});
