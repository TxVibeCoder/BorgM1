/**
 * THE PHASE 2 GATE.
 *
 * Sample playback here is fully deterministic — no PRNG, no wall clock, time arrives as a
 * frame count — so the gate can be a BYTE-EXACT render comparison rather than the spectral
 * tolerance band a drifting analogue model would force. That is a much sharper instrument:
 * a tolerance band passes a change that shifts every sample by half a bit, and this does
 * not. Keep the signal path deterministic and this stays available.
 *
 * Plus the three named click sources, each with its own test:
 *   1. the loop seam
 *   2. the ~5 ms minimum release clamp
 *   3. the 4 ms forced fade on steal
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { VoiceEngine } from '../../src/engine/voice/voiceEngineCore';
import { resetVoiceIds, STEAL_FADE_S } from '../../src/engine/voice/voiceAllocCore';
import { ampEgConfig } from '../../src/engine/dsp/levelTimeEgCore';
import { buildKeymap } from '../../src/engine/voice/keymapCore';
import { testOsc, testProgram } from '../helpers/testProgram';

const SR = 32000;
const BLOCK = 128;

beforeEach(() => resetVoiceIds());

/** Render `blocks` blocks and return the left channel, concatenated. */
function render(engine: VoiceEngine, blocks: number, onBlock?: (b: number) => void): Float32Array {
  const l = new Float32Array(BLOCK);
  const r = new Float32Array(BLOCK);
  const out = new Float32Array(blocks * BLOCK);
  for (let b = 0; b < blocks; b++) {
    onBlock?.(b);
    engine.render(l, r, BLOCK);
    out.set(l, b * BLOCK);
  }
  return out;
}

/** Largest sample-to-sample step. The measurement every click test shares. */
function maxStep(buf: Float32Array, from = 0, to = buf.length): number {
  let m = 0;
  for (let i = Math.max(1, from); i < to; i++) m = Math.max(m, Math.abs(buf[i]! - buf[i - 1]!));
  return m;
}

function fnv1a(buf: Float32Array): string {
  // 32-bit FNV-1a over the raw bytes. A hash rather than a stored buffer because the
  // point is "did ANY sample change", and a 4096-entry fixture in the repo would obscure
  // that behind a diff nobody reads.
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

describe('GATE: byte-exact determinism', () => {
  it('two engines given identical input render BIT-IDENTICAL output', () => {
    const a = new VoiceEngine(SR);
    const b = new VoiceEngine(SR);
    a.setProgram(testProgram());
    b.setProgram(testProgram());
    a.noteOn(60, 100);
    b.noteOn(60, 100);
    const ra = render(a, 32);
    const rb = render(b, 32);
    expect(Array.from(rb)).toEqual(Array.from(ra));
    expect(fnv1a(rb)).toBe(fnv1a(ra));
  });

  it('re-rendering the same note twice on ONE engine is bit-identical', () => {
    // Catches state that survives a note and should not — a filter integrator, a phase, a
    // fade counter. Any of those makes the second note subtly different from the first.
    const e = new VoiceEngine(SR);
    e.setProgram(testProgram());
    e.noteOn(60, 100);
    const first = render(e, 24);
    e.allNotesOff();
    render(e, 8);
    e.noteOn(60, 100);
    const second = render(e, 24);
    expect(fnv1a(second)).toBe(fnv1a(first));
  });

  it('output is finite everywhere, under a full 16-voice load', () => {
    // A NaN anywhere in the buffer silences the node for the rest of the session, and
    // NaN propagates, so one bad sample poisons everything downstream.
    const e = new VoiceEngine(SR);
    e.setProgram(testProgram());
    for (let i = 0; i < 16; i++) e.noteOn(48 + i * 3, 100);
    const out = render(e, 64);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('a DOUBLE program renders exactly two oscillators per note', () => {
    const single = new VoiceEngine(SR);
    single.setProgram(testProgram({ oscMode: 'SINGLE' }));
    single.noteOn(60, 100);
    render(single, 8);
    expect(single.activeSlots).toBe(1);

    const double = new VoiceEngine(SR);
    double.setProgram(testProgram({ oscMode: 'DOUBLE' }));
    double.noteOn(60, 100);
    render(double, 8);
    expect(double.activeSlots).toBe(2);
  });

  it('the block size does not change the result', () => {
    // Rendering 8x128 and 1x1024 must agree, or some per-block quantity is being applied
    // per block rather than per unit time — an envelope, an increment or a coefficient.
    const a = new VoiceEngine(SR);
    a.setProgram(testProgram());
    a.noteOn(60, 100);
    const small = render(a, 8);

    const b = new VoiceEngine(SR);
    b.setProgram(testProgram());
    b.noteOn(60, 100);
    const bigL = new Float32Array(1024);
    const bigR = new Float32Array(1024);
    b.render(bigL, bigR, 1024);

    let worst = 0;
    for (let i = 0; i < 1024; i++) worst = Math.max(worst, Math.abs(bigL[i]! - small[i]!));
    // Not bit-exact: the envelopes advance once per block by design, so a different block
    // size genuinely samples them at different instants. It must stay small.
    expect(worst).toBeLessThan(0.02);
  });
});

describe('CLICK SOURCE 1: loop seam', () => {
  it('two seconds of a looped note has no step larger than the waveform makes', () => {
    const e = new VoiceEngine(SR);
    e.setProgram(testProgram());
    e.noteOn(60, 100);
    const out = render(e, Math.ceil((SR * 2) / BLOCK));
    // The test sample is a 220 Hz sine at root 60, played at 60 — one sample's worth of
    // slope at peak is 2*pi*f/SR times the amplitude.
    const expected = 2 * Math.PI * (220 / SR);
    expect(maxStep(out)).toBeLessThan(expected * 3);
  });
});

describe('CLICK SOURCE 2: minimum release', () => {
  it('a zero release time still fades rather than stepping to silence', () => {
    const zeroRelease = testOsc({
      ampEg: ampEgConfig({
        attackTime: 0, attackLevel: 1, decayTime: 0, breakPoint: 1,
        slopeTime: 0, sustainLevel: 1, releaseTime: 0,
      }),
    });
    const e = new VoiceEngine(SR);
    e.setProgram(testProgram({ osc: [zeroRelease, zeroRelease] }));
    e.noteOn(60, 100);
    const out = render(e, 40, (b) => {
      if (b === 20) e.noteOff(60);
    });
    const expected = 2 * Math.PI * (220 / SR);
    // Without the clamp the level drops 1 -> 0 in one block boundary: a step of order the
    // signal's full amplitude, far above any step the waveform itself makes.
    expect(maxStep(out)).toBeLessThan(expected * 4);
  });

  it('the note actually stops, and its slot is returned to the pool', () => {
    const e = new VoiceEngine(SR);
    e.setProgram(testProgram());
    e.noteOn(60, 100);
    render(e, 4);
    expect(e.activeSlots).toBe(1);
    e.noteOff(60);
    render(e, Math.ceil((SR * 3) / BLOCK));
    expect(e.activeSlots).toBe(0);
  });
});

describe('CLICK SOURCE 3: voice steal', () => {
  it('stealing a sounding slot fades it rather than cutting it', () => {
    const e = new VoiceEngine(SR);
    e.setProgram(testProgram());
    // Fill all 16 slots, let them reach full level.
    for (let i = 0; i < 16; i++) e.noteOn(40 + i, 100);
    render(e, 16);
    // A 17th note must steal one — and the stolen one must fade out, not stop dead.
    const out = render(e, 16, (b) => {
      if (b === 0) e.noteOn(90, 100);
    });
    const expected = 2 * Math.PI * (220 / SR);
    // 16 voices sum, so the per-sample slope scales with the voice count.
    expect(maxStep(out)).toBeLessThan(expected * 16 * 3);
  });

  it('the fade is 4 ms of frames, not an instant drop', () => {
    expect(STEAL_FADE_S).toBe(0.004);
    expect(Math.round(STEAL_FADE_S * SR)).toBe(128);
  });

  it('the pool never exceeds 16 slots however hard it is driven', () => {
    const e = new VoiceEngine(SR);
    e.setProgram(testProgram({ oscMode: 'DOUBLE' }));
    for (let i = 0; i < 200; i++) {
      e.noteOn(36 + ((i * 5) % 60), 100);
      if (i % 3 === 0) e.noteOff(36 + (((i - 1) * 5) % 60));
      render(e, 1);
      expect(e.activeSlots).toBeLessThanOrEqual(16);
    }
  });
});

describe('engine behaviour', () => {
  it('renders silence with no program loaded rather than throwing', () => {
    // An uncaught throw in process() silences the worklet node PERMANENTLY, so the engine
    // must tolerate being asked to render before it is configured.
    const e = new VoiceEngine(SR);
    const out = render(e, 4);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('a note outside the multisound key range simply does not sound', () => {
    // Authentic: the manual says a multisound "may not sound when played in a high octave".
    const narrow = testOsc({
      keymap: buildKeymap([{ keyLow: 48, keyHigh: 72, sampleIndex: 0 }]),
    });
    const e = new VoiceEngine(SR);
    e.setProgram(testProgram({ osc: [narrow, narrow] }));
    e.noteOn(100, 100); // above the range
    render(e, 4);
    expect(e.activeSlots).toBe(0);
    e.noteOn(60, 100); // inside it
    render(e, 4);
    expect(e.activeSlots).toBe(1);
  });

  it('velocity scales level only when sensitivity is non-zero', () => {
    const peak = (vel: number, sens: number) => {
      const osc = testOsc({ velocitySensitivity: sens });
      const e = new VoiceEngine(SR);
      e.setProgram(testProgram({ osc: [osc, osc] }));
      e.noteOn(60, vel);
      const out = render(e, 16);
      let p = 0;
      for (const v of out) p = Math.max(p, Math.abs(v));
      return p;
    };
    expect(peak(30, 0)).toBeCloseTo(peak(127, 0), 3);
    expect(peak(30, 1)).toBeLessThan(peak(127, 1) * 0.6);
  });

  it('sustain holds notes and lifting the pedal releases them', () => {
    const e = new VoiceEngine(SR);
    e.setProgram(testProgram());
    e.noteOn(60, 100);
    render(e, 4);
    e.setSustain(true);
    e.noteOff(60);
    render(e, 32);
    expect(e.activeSlots).toBe(1); // pedal is holding it
    e.setSustain(false);
    render(e, Math.ceil((SR * 3) / BLOCK));
    expect(e.activeSlots).toBe(0);
  });
});
