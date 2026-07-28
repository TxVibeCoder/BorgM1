/**
 * The voice engine — PURE, no Web Audio types, Node-testable, FULLY DETERMINISTIC.
 *
 * Owns all 16 oscillator slots and renders them into one stereo buffer. The worklet is a
 * thin shell around this: it marshals buffers and parameter messages and calls `render`.
 * Everything audible happens here, where it can be tested byte-exactly in Node.
 *
 * DETERMINISM IS A FEATURE, NOT AN ACCIDENT. There is no PRNG and no clock in this path —
 * time arrives as a frame count. That is what lets Phase 2's gate be a byte-exact
 * golden-buffer comparison instead of a spectral tolerance band. Adding `Math.random`
 * here, even for a "subtle analogue drift", would cost the sharpest test in the project.
 *
 * NO ALLOCATION IN `render`. Every buffer is built in the constructor. An allocation per
 * block is a GC pause, and a GC pause in an audio callback is a dropout.
 */

import {
  makeEgState,
  noteOff as egNoteOff,
  noteOn as egNoteOn,
  process as egProcess,
  type EgConfig,
  type EgState,
} from '../dsp/levelTimeEgCore';
import {
  cutoffCoefficient,
  keyboardTrackingRatio,
  makeLowpassState,
  processBlock as filterBlock,
  resetLowpass,
  type LowpassState,
} from '../dsp/lowpassCore';
import {
  incrementFor,
  makePlayerState,
  renderInto,
  startPlayer,
  type PlayerState,
  type SampleRef,
} from '../dsp/samplePlayerCore';
import { lookup, NO_SAMPLE } from './keymapCore';
import {
  allocate,
  freeSlot,
  makeSlots,
  noteOff as allocNoteOff,
  STEAL_FADE_S,
  sustainUp as allocSustainUp,
  SLOT_COUNT,
  type Slot,
} from './voiceAllocCore';

/** One playable sample plus the metadata needed to pitch it. */
export interface BankSampleRef extends SampleRef {
  rootKey: number;
  fineCents: number;
  sampleRate: number;
}

export type OscMode = 'SINGLE' | 'DOUBLE' | 'DRUMS';

/** Per-oscillator settings. Both halves of a DOUBLE have one of these each. */
export interface OscConfig {
  /** 128x128 lookup into `samples`. */
  keymap: Uint16Array;
  samples: BankSampleRef[];
  /** 0..1 */
  level: number;
  /** -1 = 16', 0 = 8', +1 = 4'. */
  octave: number;
  /** Semitones relative to oscillator 1 (oscillator 2 only). */
  interval: number;
  /** Cents. */
  detune: number;
  ampEg: EgConfig;
  filterEg: EgConfig;
  pitchEg: EgConfig;
  /** Base cutoff in Hz before tracking and EG. */
  cutoffHz: number;
  /** -1..1, scales the filter EG's contribution. */
  egIntensity: number;
  /** Raw hardware value: 0 means 100% tracking. See lowpassCore. */
  cutoffTracking: number;
  /** 0..1 amp sensitivity to velocity. */
  velocitySensitivity: number;
}

export interface ProgramConfig {
  oscMode: OscMode;
  osc: [OscConfig, OscConfig];
  /** Plugin-era extension. Defaults off; the Phase 4 gate must pass with it off. */
  resonance: number;
}

/** Per-slot render state. Allocated once, reused forever. */
interface SlotVoice {
  player: PlayerState;
  amp: EgState;
  filt: EgState;
  pitch: EgState;
  lp: LowpassState;
  ref: BankSampleRef | null;
  cfg: OscConfig | null;
  note: number;
  velocity: number;
  /** Frames remaining in the forced steal fade; 0 when not stealing. */
  fadeFrames: number;
  fadeTotal: number;
  /** Gain at the end of the previous block, so blocks join without a step. */
  lastGain: number;
  lastInc: number;
  lastCoeff: number;
  primed: boolean;
}

function makeSlotVoice(): SlotVoice {
  return {
    player: makePlayerState(),
    amp: makeEgState(),
    filt: makeEgState(),
    pitch: makeEgState(),
    lp: makeLowpassState(),
    ref: null,
    cfg: null,
    note: -1,
    velocity: 0,
    fadeFrames: 0,
    fadeTotal: 0,
    lastGain: 0,
    lastInc: 1,
    lastCoeff: 0,
    primed: false,
  };
}

/**
 * Envelopes, increments and filter coefficients update every this many frames, regardless
 * of the host's render quantum. 32 frames is 1 ms at 32 kHz — at or below the shortest EG
 * time the parameter range can express, so no envelope stage can be skipped.
 */
export const CONTROL_BLOCK = 32;

export class VoiceEngine {
  readonly slots: Slot[] = makeSlots(SLOT_COUNT);
  private readonly voices: SlotVoice[] = Array.from({ length: SLOT_COUNT }, makeSlotVoice);
  private program: ProgramConfig | null = null;
  private sustainDown = false;
  /** Frames rendered since construction. The engine's only clock. */
  private frames = 0;

  constructor(readonly sampleRate: number) {}

  /** Seconds elapsed, derived from the frame count so `now` is exact and reproducible. */
  private get now(): number {
    return this.frames / this.sampleRate;
  }

  setProgram(p: ProgramConfig): void {
    this.program = p;
  }

  setSustain(down: boolean): void {
    if (this.sustainDown && !down) {
      // Lifting the pedal must release the ENVELOPES too, not just re-label the slots.
      // Marking a slot 'released' without starting its release leaves the amp EG parked at
      // sustain forever, so the note holds and its slot is never returned to the pool.
      for (const i of allocSustainUp(this.slots, 0)) {
        const v = this.voices[i]!;
        if (!v.cfg) continue;
        egNoteOff(v.amp, v.cfg.ampEg);
        egNoteOff(v.filt, v.cfg.filterEg);
        egNoteOff(v.pitch, v.cfg.pitchEg);
      }
    }
    this.sustainDown = down;
  }

  noteOn(note: number, velocity: number): void {
    const p = this.program;
    if (!p || velocity <= 0) return;
    const need: 1 | 2 = p.oscMode === 'DOUBLE' ? 2 : 1;
    const r = allocate(this.slots, { slots: need, note, channel: 0, now: this.now });
    if (r.indices.length === 0) return;

    r.indices.forEach((slotIndex, oscIndex) => {
      const cfg = p.osc[oscIndex] ?? p.osc[0]!;
      const v = this.voices[slotIndex]!;
      const wasStolen = r.stolen.includes(slotIndex) && v.primed;

      const sampleIndex = lookup(cfg.keymap, note, velocity);
      if (sampleIndex === NO_SAMPLE) {
        // Authentic: a multisound has a limited pitch range and simply does not sound
        // outside it. Free the slot rather than leaving it claimed and silent.
        freeSlot(this.slots[slotIndex]!);
        v.primed = false;
        return;
      }
      const ref = cfg.samples[sampleIndex];
      if (!ref) {
        freeSlot(this.slots[slotIndex]!);
        v.primed = false;
        return;
      }

      if (wasStolen) {
        // CLICK SOURCE 3: never hard-cut a sounding oscillator. Run the old voice out over
        // STEAL_FADE_S before the new one starts; the fade counter is consumed in render.
        v.fadeFrames = Math.max(1, Math.round(STEAL_FADE_S * this.sampleRate));
        v.fadeTotal = v.fadeFrames;
      } else {
        v.fadeFrames = 0;
        v.fadeTotal = 0;
      }

      v.ref = ref;
      v.cfg = cfg;
      v.note = note;
      v.velocity = velocity;
      v.primed = true;
      startPlayer(v.player, 0);
      resetLowpass(v.lp);
      egNoteOn(v.amp, cfg.ampEg);
      egNoteOn(v.filt, cfg.filterEg);
      egNoteOn(v.pitch, cfg.pitchEg);
      v.lastGain = 0;
      v.lastInc = this.incrementOf(v);
      v.lastCoeff = this.coefficientOf(v);
    });
  }

  noteOff(note: number): void {
    const released = allocNoteOff(this.slots, note, 0, this.sustainDown);
    for (const i of released) {
      if (this.sustainDown) continue;
      const v = this.voices[i]!;
      if (!v.cfg) continue;
      egNoteOff(v.amp, v.cfg.ampEg);
      egNoteOff(v.filt, v.cfg.filterEg);
      egNoteOff(v.pitch, v.cfg.pitchEg);
    }
  }

  allNotesOff(): void {
    for (let i = 0; i < this.slots.length; i++) {
      freeSlot(this.slots[i]!);
      this.voices[i]!.primed = false;
    }
  }

  private incrementOf(v: SlotVoice): number {
    const cfg = v.cfg!;
    const semis = cfg.octave * 12 + cfg.interval + v.pitch.level;
    return incrementFor(
      v.note,
      v.ref!.rootKey,
      v.ref!.fineCents + cfg.detune,
      v.ref!.sampleRate,
      this.sampleRate,
      semis,
    );
  }

  private coefficientOf(v: SlotVoice): number {
    const cfg = v.cfg!;
    const track = keyboardTrackingRatio(cfg.cutoffTracking, v.note);
    // The filter EG is SIGNED and scaled by EG Intensity — it swings both ways around the
    // base cutoff, which is why the EG level is applied as an exponent rather than a gain.
    const egSemis = v.filt.level * cfg.egIntensity * 60;
    const hz = cfg.cutoffHz * track * Math.pow(2, egSemis / 12);
    return cutoffCoefficient(hz, this.sampleRate);
  }

  /**
   * Render `count` frames into `outL`/`outR`, overwriting them.
   *
   * Per-block, per-slot: advance the three envelopes, recompute increment and cutoff,
   * then render the sample with BOTH the increment and the gain interpolated from their
   * previous block values. Joining blocks at their endpoints is what stops the parameter
   * updates themselves becoming a per-block click.
   */
  render(outL: Float32Array, outR: Float32Array, count: number): void {
    outL.fill(0, 0, count);
    outR.fill(0, 0, count);
    const p = this.program;
    if (!p) {
      this.frames += count;
      return;
    }
    // Subdivide into fixed control-rate chunks so envelope resolution is the ENGINE's,
    // not the host's. Advancing envelopes once per host block ties attack time to the
    // render quantum: the same 1 ms attack becomes a 4 ms ramp at 128 frames and a 32 ms
    // ramp at 1024, which is both wrong and untestable. CLAUDE.md already forbids reading
    // the quantum as 128; this is the same rule applied to the control path.
    let done = 0;
    while (done < count) {
      const chunk = Math.min(CONTROL_BLOCK, count - done);
      this.renderChunk(outL, outR, done, chunk, p);
      done += chunk;
    }
    this.frames += count;
  }

  private renderChunk(
    outL: Float32Array,
    outR: Float32Array,
    outOffset: number,
    count: number,
    p: ProgramConfig,
  ): void {
    const dt = count / this.sampleRate;

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      const v = this.voices[i]!;
      if (slot.state === 'free' || !v.primed || !v.ref || !v.cfg) continue;

      // Envelopes advance once per block. The amp EG's output is the slot's level, which
      // the allocator reads as the loudness term in its steal score.
      egProcess(v.pitch, v.cfg.pitchEg, dt);
      const filtLevel = egProcess(v.filt, v.cfg.filterEg, dt);
      const ampLevel = egProcess(v.amp, v.cfg.ampEg, dt);
      void filtLevel;
      slot.level = ampLevel;

      const velGain = 1 - v.cfg.velocitySensitivity * (1 - v.velocity / 127);
      let gainEnd = ampLevel * v.cfg.level * velGain;

      // Forced steal fade, applied on top of the envelope.
      if (v.fadeFrames > 0) {
        const remaining = Math.max(0, v.fadeFrames - count);
        gainEnd *= remaining / v.fadeTotal;
        v.fadeFrames = remaining;
      }

      const incEnd = this.incrementOf(v);
      const coeffEnd = this.coefficientOf(v);

      const scratch = this.scratch;
      scratch.fill(0, 0, count);
      renderInto(scratch, 0, count, v.ref, v.player, v.lastInc, incEnd, v.lastGain, gainEnd);
      filterBlock(v.lp, scratch, 0, count, v.lastCoeff, coeffEnd, p.resonance);

      // Mono for now: the M1's stereo image comes from the effects section (Phase 4), and
      // the reverbs are mono-sum in / stereo out anyway.
      for (let n = 0; n < count; n++) {
        const s = scratch[n]!;
        outL[outOffset + n] = outL[outOffset + n]! + s;
        outR[outOffset + n] = outR[outOffset + n]! + s;
      }

      v.lastInc = incEnd;
      v.lastGain = gainEnd;
      v.lastCoeff = coeffEnd;

      // Retire the slot once it is genuinely silent, not merely released — a slot freed
      // while still sounding is a click, which is the same bug as a hard steal.
      const finished =
        (v.amp.phase === 'done' && v.fadeFrames === 0) ||
        (v.fadeFrames === 0 && v.fadeTotal > 0 && gainEnd === 0) ||
        !v.player.active;
      if (finished) {
        freeSlot(slot);
        v.primed = false;
      }
    }

    this.frames += count;
  }

  /** Per-slot mixing scratch. Allocated once — see the no-allocation rule in the header. */
  private readonly scratch = new Float32Array(4096);

  /** Slots currently sounding. */
  get activeSlots(): number {
    let n = 0;
    for (const s of this.slots) if (s.state !== 'free') n++;
    return n;
  }
}
