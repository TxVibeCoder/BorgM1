/**
 * A deterministic program for engine tests. Shared so the golden buffers and the click
 * tests exercise the same configuration — a golden buffer is only meaningful if the thing
 * that produced it is pinned.
 */

import { ampEgConfig, filterEgConfig, pitchEgConfig } from '../../src/engine/dsp/levelTimeEgCore';
import { buildKeymap } from '../../src/engine/voice/keymapCore';
import type { BankSampleRef, OscConfig, ProgramConfig } from '../../src/engine/voice/voiceEngineCore';
import { bakeSample } from '../../src/engine/sample/bakeCore';
import { int16ToFloat } from '../../src/engine/sample/pcmCore';

/** A looped sine, baked through the real pipeline so tests see real guard regions. */
export function testSample(freq = 220, rootKey = 60, sourceRate = 32000): BankSampleRef {
  const src = new Float32Array(4000);
  for (let i = 0; i < src.length; i++) {
    src[i] = 0.8 * Math.sin((2 * Math.PI * freq * i) / sourceRate);
  }
  const period = sourceRate / freq;
  const baked = bakeSample({
    data: src,
    sampleRate: sourceRate,
    dwStart: 0,
    dwStartloop: Math.round(period * 4),
    dwEndloop: Math.round(period * 12 + period / 3), // deliberately off-cycle
    looped: true,
  });
  return {
    data: int16ToFloat(baked.pcm),
    loopStart: baked.loopStart,
    loopEnd: baked.loopEnd,
    rootKey,
    fineCents: 0,
    sampleRate: baked.sampleRate,
  };
}

export function testOsc(over: Partial<OscConfig> = {}): OscConfig {
  const samples = [testSample()];
  return {
    keymap: buildKeymap([{ keyLow: 0, keyHigh: 127, sampleIndex: 0 }]),
    samples,
    level: 1,
    octave: 0,
    interval: 0,
    detune: 0,
    // Flat envelopes by default: instant attack, full sustain, so a test measures the
    // sample and the filter rather than an envelope shape it did not ask for. This is
    // also exactly the shape `I17 Organ 2` uses.
    ampEg: ampEgConfig({
      attackTime: 0, attackLevel: 1, decayTime: 0, breakPoint: 1,
      slopeTime: 0, sustainLevel: 1, releaseTime: 20,
    }),
    filterEg: filterEgConfig({
      attackTime: 0, attackLevel: 0, decayTime: 0, breakPoint: 0,
      slopeTime: 0, sustainLevel: 0, releaseTime: 0, releaseLevel: 0,
    }),
    pitchEg: pitchEgConfig({
      startLevel: 0, attackTime: 0, attackLevel: 0, decayTime: 0,
      releaseTime: 0, releaseLevel: 0,
    }),
    cutoffHz: 12000,
    egIntensity: 0,
    // -99 = NO tracking. Deliberately explicit: 0 would mean 100% tracking and make every
    // test's cutoff depend on the note it happened to play.
    cutoffTracking: -99,
    velocitySensitivity: 0,
    ...over,
  };
}

export function testProgram(over: Partial<ProgramConfig> = {}): ProgramConfig {
  return {
    oscMode: 'SINGLE',
    osc: [testOsc(), testOsc()],
    resonance: 0,
    ...over,
  };
}
