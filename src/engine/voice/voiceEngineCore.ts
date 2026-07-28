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
 * block is a GC pause, and a GC pause in an audio callback is a dropout. Phase 3 keeps to
 * this even though it added per-voice modulated envelopes: the scaled `EgConfig`s are
 * preallocated per slot in the constructor and MUTATED at note-on, never rebuilt.
 */

import {
  makeEgState,
  noteOff as egNoteOff,
  noteOn as egNoteOn,
  process as egProcess,
  type EgConfig,
  type EgStage,
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
  makeMgState,
  mgNoteOn,
  mgProcess,
  type MgConfig,
  type MgState,
} from '../dsp/mgCore';
import {
  ampTrackingGain,
  ampVelocityGain,
  egTimeScale,
  keyDelta,
  noEgTimeMod,
  SEG_RELEASE,
  velocityDelta,
  velocityDepth,
  type EgTimeMod,
} from '../dsp/modCore';
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
  /** 0..1, scales the filter EG's contribution (byte 74 is unsigned). */
  egIntensity: number;
  /** Raw hardware value: 0 means 100% tracking. See lowpassCore. */
  cutoffTracking: number;
  /** Key at which cutoff tracking contributes nothing (byte 72). */
  cutoffCenterKey: number;
  /** -1..1 SIGNED amp velocity sensitivity (byte 89). The sign enables DOUBLE crossfades. */
  ampVelocity: number;
  /** -1..1 amp keyboard tracking (byte 88). */
  ampTracking: number;
  /** Key at which amp tracking contributes nothing (byte 87). */
  ampCenterKey: number;
  /** -1..1, velocity's effect on filter EG intensity (byte 77). */
  egIntensityVelocity: number;
  /** Per-segment EG-time modulation. Bytes 75/99, 76/100, 90/101, 91/102. */
  filterEgTimeTrack: EgTimeMod;
  filterEgTimeVel: EgTimeMod;
  ampEgTimeTrack: EgTimeMod;
  ampEgTimeVel: EgTimeMod;
  /** -1..1 velocity scaling of the pitch EG's times (byte 69) and levels (byte 70). */
  pitchEgTimeVelocity: number;
  pitchEgLevelVelocity: number;
  /** Seconds this oscillator waits before sounding (byte 18; oscillator 2 only). */
  startDelayS: number;
  /** Whether the program's two MGs reach this oscillator (bytes 19/23, bits 5 and 6). */
  pitchMgEnable: boolean;
  cutoffMgEnable: boolean;
}

/** Performance-controller depths. Program-level — bytes 27..37 are in the common block. */
export interface ControllerConfig {
  /** AFTER TOUCH: pitch in semitones, cutoff/amp signed -1..1, MG depths 0..1. */
  atPitch: number;
  atPitchMg: number;
  atCutoff: number;
  atCutoffMg: number;
  atAmp: number;
  /** JOY STICK: X is pitch bend in semitones; Y drives the rest. */
  jsPitchBend: number;
  jsCutoffSweep: number;
  jsPitchMgInt: number;
  jsCutoffMgInt: number;
  /** Raw 0..3 (bytes 35 and 37): how much the stick speeds each MG up. */
  jsPitchMgFreq: number;
  jsCutoffMgFreq: number;
}

export interface ProgramConfig {
  oscMode: OscMode;
  osc: [OscConfig, OscConfig];
  /** Plugin-era extension. Defaults off; the Phase 4 gate must pass with it off. */
  resonance: number;
  /** The two program-level modulation generators (bytes 19-22 and 23-26). */
  pitchMg: MgConfig;
  cutoffMg: MgConfig;
  controllers: ControllerConfig;
  /** Byte 11 bit0. MONO collapses the program to a single sounding note. */
  mono: boolean;
  /** Byte 11 bit1. Notes latch on instead of releasing at note-off. */
  hold: boolean;
}

/** Eight timbres. The Combination record has room for exactly this many (manual p.128). */
export const MAX_TIMBRES = 8;

/**
 * One Combination timbre: a program, the windows that decide whether it answers a note, and
 * the panpot that decides which effect bus it lands on.
 *
 * ONE PLAY PATH FOR ALL FIVE COMBINATION TYPES. `SINGLE`, `LAYER`, `SPLIT`, `VELOCITY SWITCH`
 * and MULTI are five real types in the DATA — each has its own edit pages and its own SysEx
 * meaning — but they are not five behaviours down here. Each resolves to a list of timbres
 * with effective windows, and the engine then applies one rule: **a timbre sounds when its
 * channel, its key window and its velocity window all match.** SPLIT is two timbres with
 * adjacent key windows; VELOCITY SWITCH is two with adjacent velocity windows. Modelling the
 * types in the engine as well would be the same rule written five times.
 *
 * Program mode is the degenerate case: one timbre, every window wide open, and no panpot at
 * all — see `programModeTimbre`.
 */
export interface TimbreConfig {
  program: ProgramConfig;
  /** MIDI channel 0..15, or -1 for OMNI. */
  channel: number;
  /**
   * Inclusive windows. **`low > high` is an EMPTY window and the timbre never sounds** — that
   * is not a defensive clamp, it is the mechanism behind the manual's "If the Velocity SW
   * point is set to 1, the soft Program will not sound" (p.70).
   */
  keyLow: number;
  keyHigh: number;
  velLow: number;
  velHigh: number;
  /** KEY TRANSPOSE, semitones. Repitches the sample, like OCTAVE and INTERVAL already do. */
  transpose: number;
  /** DETUNE, cents. */
  detune: number;
  /** OUTPUT LEVEL 0..99 scaled to 0..1. Manual p.65: 99 is unity, 0 is silent. */
  level: number;
  /** Panpot gains into the four effect buses, `[A, B, C, D]`. See `panpotGains`. */
  bus: readonly [number, number, number, number];
  /** CONTROL FILTER bit1. DIS means the damper pedal does not reach this timbre. */
  damper: boolean;
  /** CONTROL FILTER bit2. DIS means aftertouch does not reach this timbre. */
  afterTouch: boolean;
  /** CONTROL FILTER bit3. DIS means control changes — the joystick — do not reach it. */
  controlChange: boolean;
}

/**
 * The Program-mode timbre: one program, no windows, and a FIXED panpot.
 *
 * Manual p.37: "Programs with the exception of drum kit are input to A and B in a ratio of 5:5
 * and not input to C and D." Program mode has no panpot page on which to change it, so the
 * `[1, 1, 0, 0]` below is a wiring rather than a parameter — but it is the SAME value
 * `panpotGains(PANPOT_CENTRE)` returns, and that is not a coincidence: it is the constraint
 * that fixed the pan law. See `panpotGains`.
 */
export function programModeTimbre(program: ProgramConfig): TimbreConfig {
  return {
    program,
    channel: -1,
    keyLow: 0,
    keyHigh: 127,
    velLow: 1,
    velHigh: 127,
    transpose: 0,
    detune: 0,
    level: 1,
    bus: [1, 1, 0, 0],
    damper: true,
    afterTouch: true,
    controlChange: true,
  };
}

/** True when this timbre answers this note on this channel. All three must match. */
export function timbreMatches(t: TimbreConfig, note: number, velocity: number, channel: number): boolean {
  if (t.channel >= 0 && channel >= 0 && t.channel !== channel) return false;
  return note >= t.keyLow && note <= t.keyHigh && velocity >= t.velLow && velocity <= t.velHigh;
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
  /**
   * Velocity- and key-scaled copies of this voice's three envelopes. Preallocated so
   * note-on can rewrite the numbers in place without allocating on the audio thread.
   */
  ampEg: EgConfig;
  filtEg: EgConfig;
  pitchEg: EgConfig;
  note: number;
  velocity: number;
  /** Which timbre owns this voice. Program mode is always 0. */
  timbre: number;
  /** Frames remaining in the forced steal fade; 0 when not stealing. */
  fadeFrames: number;
  fadeTotal: number;
  /** Frames still to wait before this oscillator starts (OSC-2 DELAY START). */
  delayFrames: number;
  /** Gain at the end of the previous block, so blocks join without a step. */
  lastGain: number;
  lastInc: number;
  lastCoeff: number;
  primed: boolean;
  /** Cached per-note modulation depths, computed once at note-on. */
  egIntensity: number;
  ampGain: number;
}

/** An EgConfig with its own stage array, safe to mutate per voice. */
function makeScaledEg(stageCount: number): EgConfig {
  return {
    startLevel: 0,
    stages: Array.from({ length: stageCount }, (): EgStage => ({ timeS: 0, level: 0 })),
    sustainStage: stageCount - 1,
    release: { timeS: 0, level: 0 },
  };
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
    // Amp and filter EGs are attack/decay/slope; the pitch EG is attack/decay.
    ampEg: makeScaledEg(3),
    filtEg: makeScaledEg(3),
    pitchEg: makeScaledEg(2),
    note: -1,
    velocity: 0,
    timbre: 0,
    fadeFrames: 0,
    fadeTotal: 0,
    delayFrames: 0,
    lastGain: 0,
    lastInc: 1,
    lastCoeff: 0,
    primed: false,
    egIntensity: 0,
    ampGain: 1,
  };
}

/**
 * Copy `src` into `dst`, scaling each stage's time by `stageScale(i)` and the release by
 * `releaseScale`. Levels are scaled by `levelScale` (the pitch EG's LEVEL VELOCITY SENSE;
 * 1 everywhere else). Mutates `dst` and allocates nothing.
 */
function scaleEgInto(
  dst: EgConfig,
  src: EgConfig,
  stageScale: (segment: number) => number,
  releaseScale: number,
  levelScale: number,
): void {
  dst.startLevel = src.startLevel * levelScale;
  dst.sustainStage = src.sustainStage;
  for (let i = 0; i < dst.stages.length; i++) {
    const from = src.stages[i];
    const to = dst.stages[i]!;
    to.timeS = (from?.timeS ?? 0) * stageScale(i);
    to.level = (from?.level ?? 0) * levelScale;
  }
  dst.release.timeS = src.release.timeS * releaseScale;
  dst.release.level = src.release.level * levelScale;
}

/**
 * Envelopes, increments and filter coefficients update every this many frames, regardless
 * of the host's render quantum. 32 frames is 1 ms at 32 kHz — at or below the shortest EG
 * time the parameter range can express, so no envelope stage can be skipped.
 */
export const CONTROL_BLOCK = 32;

/** Full-scale joystick / aftertouch cutoff sweep, in semitones of cutoff. A CHOICE. */
const CUTOFF_MOD_SEMITONES = 60;
/** Full-scale filter EG contribution, in semitones of cutoff. A CHOICE (Phase 2's value). */
const EG_CUTOFF_SEMITONES = 60;
/**
 * Full-scale PITCH MG depth, in semitones. A CHOICE, not an M1 fact — the manual gives the
 * parameter as 0..99 with no unit. One whole tone at full intensity is a deep but musical
 * vibrato, and it leaves the joystick and aftertouch room to add more on top.
 */
const PITCH_MG_SEMITONES = 2;

export class VoiceEngine {
  readonly slots: Slot[] = makeSlots(SLOT_COUNT);
  private readonly voices: SlotVoice[] = Array.from({ length: SLOT_COUNT }, makeSlotVoice);
  /**
   * The timbres competing for the one 16-slot pool. Program mode holds exactly one; a
   * Combination holds one per sounding timbre. ALLOCATION IS DYNAMIC AND UNRESERVED across
   * all of them — nothing is protected and nothing is guaranteed, which is the hardware.
   */
  private timbres: TimbreConfig[] = [];
  private sustainDown = false;
  /** Frames rendered since construction. The engine's only clock. */
  private frames = 0;

  /**
   * The two program-level MGs, PER TIMBRE. They belong to the program, not to the engine, so
   * eight timbres carrying eight programs need eight pairs — sharing one pair would lock every
   * timbre's vibrato to the same phase and rate.
   */
  private readonly pitchMgStates: MgState[] = Array.from({ length: MAX_TIMBRES }, makeMgState);
  private readonly cutoffMgStates: MgState[] = Array.from({ length: MAX_TIMBRES }, makeMgState);
  private readonly pitchMgValues = new Float64Array(MAX_TIMBRES);
  private readonly cutoffMgValues = new Float64Array(MAX_TIMBRES);

  /** Live controller positions. -1..1 for the joystick axes, 0..1 for aftertouch. */
  private joyX = 0;
  private joyY = 0;
  private aftertouch = 0;
  /**
   * The GLOBAL channel. Manual p.73: "Real time performance controls such as joy stick and
   * after touch affect only the Timbres whose channels are the same as the Global channel."
   */
  private globalChannel = 0;

  constructor(readonly sampleRate: number) {}

  /** Seconds elapsed, derived from the frame count so `now` is exact and reproducible. */
  private get now(): number {
    return this.frames / this.sampleRate;
  }

  /** Program mode: one timbre, no windows, no panpot. See `programModeTimbre`. */
  setProgram(p: ProgramConfig): void {
    this.timbres = [programModeTimbre(p)];
  }

  /** Combination mode: up to eight timbres against the same pool. */
  setTimbres(timbres: TimbreConfig[]): void {
    this.timbres = timbres.slice(0, MAX_TIMBRES);
  }

  setGlobalChannel(channel: number): void {
    this.globalChannel = channel;
  }

  /** The config a sounding slot belongs to, or null if its timbre has since gone away. */
  private timbreOf(v: SlotVoice): TimbreConfig | null {
    return this.timbres[v.timbre] ?? null;
  }

  /** Whether the joystick and aftertouch reach this timbre. */
  private controllersReach(t: TimbreConfig): boolean {
    return t.channel < 0 || t.channel === this.globalChannel;
  }

  setSustain(down: boolean): void {
    if (this.sustainDown && !down) {
      // Lifting the pedal must release the ENVELOPES too, not just re-label the slots.
      // Marking a slot 'released' without starting its release leaves the amp EG parked at
      // sustain forever, so the note holds and its slot is never returned to the pool.
      for (let ch = -1; ch < 16; ch++) {
        for (const i of allocSustainUp(this.slots, ch)) {
          const v = this.voices[i]!;
          if (!v.cfg) continue;
          this.releaseVoice(v);
        }
      }
    }
    this.sustainDown = down;
  }

  /** Joystick position. X (-1..1) is pitch bend; Y (-1..1) drives the MG and sweep depths. */
  setJoystick(x: number, y: number): void {
    this.joyX = Math.min(1, Math.max(-1, x));
    this.joyY = Math.min(1, Math.max(-1, y));
  }

  /** Channel aftertouch, 0..1. */
  setAftertouch(v: number): void {
    this.aftertouch = Math.min(1, Math.max(0, v));
  }

  private releaseVoice(v: SlotVoice): void {
    egNoteOff(v.amp, v.ampEg);
    egNoteOff(v.filt, v.filtEg);
    egNoteOff(v.pitch, v.pitchEg);
  }

  /**
   * A note arrives. EVERY timbre whose channel and windows match it sounds — the windows are
   * independent and ADDITIVE, so a LAYER is simply two timbres that both matched.
   *
   * Allocation runs per matching timbre against the same pool, in timbre order, and a timbre
   * that cannot get its slots is simply dropped. That reproduces "no per-program limit, but
   * never more than 16 total" with no per-timbre bookkeeping: the eighth timbre of a dense
   * chord loses because there is nothing left, which is exactly what the hardware does.
   */
  noteOn(note: number, velocity: number, channel = 0): void {
    if (velocity <= 0) return;
    for (let t = 0; t < this.timbres.length; t++) {
      const timbre = this.timbres[t]!;
      if (!timbreMatches(timbre, note, velocity, channel)) continue;
      this.noteOnTimbre(t, timbre, note, velocity, channel);
    }
  }

  private noteOnTimbre(
    timbreIndex: number,
    timbre: TimbreConfig,
    note: number,
    velocity: number,
    channel: number,
  ): void {
    const p = timbre.program;
    const need: 1 | 2 = p.oscMode === 'DOUBLE' ? 2 : 1;

    // MONO (byte 11 bit0) collapses the program to one sounding note. Release everything
    // first so the new note takes the pool rather than stacking against it — but only THIS
    // timbre's notes, because MONO is a program parameter and a mono bass timbre must not
    // silence the pad layered over it.
    if (p.mono) {
      for (let i = 0; i < this.slots.length; i++) {
        const slot = this.slots[i]!;
        if (slot.state === 'free' || slot.timbre !== timbreIndex) continue;
        allocNoteOff(this.slots, slot.note, slot.channel, false);
        const v = this.voices[i]!;
        if (v.cfg) this.releaseVoice(v);
      }
    }

    const r = allocate(this.slots, {
      slots: need,
      note,
      channel,
      timbre: timbreIndex,
      now: this.now,
    });
    if (r.indices.length === 0) return;

    // KEY SYNC restarts this timbre's MG phases. Both MGs are program-level, so this happens
    // once per note, not once per claimed slot.
    mgNoteOn(this.pitchMgStates[timbreIndex]!, p.pitchMg);
    mgNoteOn(this.cutoffMgStates[timbreIndex]!, p.cutoffMg);

    r.indices.forEach((slotIndex, oscIndex) => {
      const cfg = p.osc[oscIndex] ?? p.osc[0]!;
      const v = this.voices[slotIndex]!;
      v.timbre = timbreIndex;
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

      this.applyNoteModulation(v, cfg, note, velocity);

      // OSC-2 DELAY START. Only the second claimed slot waits; a delay on the oscillator
      // that carries the attack transient would defeat the point of the parameter.
      v.delayFrames =
        oscIndex === 1 ? Math.max(0, Math.round(cfg.startDelayS * this.sampleRate)) : 0;

      startPlayer(v.player, 0);
      resetLowpass(v.lp);
      egNoteOn(v.amp, v.ampEg);
      egNoteOn(v.filt, v.filtEg);
      egNoteOn(v.pitch, v.pitchEg);
      v.lastGain = 0;
      v.lastInc = this.incrementOf(v);
      v.lastCoeff = this.coefficientOf(v);
    });
  }

  /**
   * Fold this note's velocity and key position into the voice: scaled envelope times, the
   * velocity-adjusted filter EG intensity, and the static part of the amp gain.
   *
   * Done ONCE per note-on rather than per block. The M1's velocity and keyboard-tracking
   * modulations are all note-scoped — they are set by how the key was struck and do not
   * move afterwards — so evaluating them per block would burn cycles to compute a constant.
   */
  private applyNoteModulation(
    v: SlotVoice,
    cfg: OscConfig,
    note: number,
    velocity: number,
  ): void {
    const vd = velocityDelta(velocity);
    const kdFilter = keyDelta(note, cfg.cutoffCenterKey);
    const kdAmp = keyDelta(note, cfg.ampCenterKey);

    // Filter EG: keyboard tracking and velocity multiply, so a program using both gets both.
    scaleEgInto(
      v.filtEg,
      cfg.filterEg,
      (seg) =>
        egTimeScale(cfg.filterEgTimeTrack, seg, kdFilter) *
        egTimeScale(cfg.filterEgTimeVel, seg, vd),
      egTimeScale(cfg.filterEgTimeTrack, SEG_RELEASE, kdFilter) *
        egTimeScale(cfg.filterEgTimeVel, SEG_RELEASE, vd),
      1,
    );
    scaleEgInto(
      v.ampEg,
      cfg.ampEg,
      (seg) =>
        egTimeScale(cfg.ampEgTimeTrack, seg, kdAmp) * egTimeScale(cfg.ampEgTimeVel, seg, vd),
      egTimeScale(cfg.ampEgTimeTrack, SEG_RELEASE, kdAmp) *
        egTimeScale(cfg.ampEgTimeVel, SEG_RELEASE, vd),
      1,
    );
    // The pitch EG has no per-segment switches — bytes 69/70 are single signed scalars that
    // scale all of its times and all of its levels.
    const pitchTimeScale = Math.pow(2, -cfg.pitchEgTimeVelocity * vd);
    const pitchLevelScale = 1 + velocityDepth(cfg.pitchEgLevelVelocity, velocity);
    scaleEgInto(v.pitchEg, cfg.pitchEg, () => pitchTimeScale, pitchTimeScale, pitchLevelScale);

    // EG INTENSITY is unsigned (byte 74) but its velocity sense is signed (byte 77), so the
    // pair can subtract depth as well as add it. Clamp to the parameter's own range.
    v.egIntensity = Math.min(
      1,
      Math.max(0, cfg.egIntensity + velocityDepth(cfg.egIntensityVelocity, velocity)),
    );

    v.ampGain =
      cfg.level *
      ampVelocityGain(cfg.ampVelocity, velocity) *
      ampTrackingGain(cfg.ampTracking, note, cfg.ampCenterKey);
  }

  /**
   * HOLD and the damper filter are both PER TIMBRE, so note-off is resolved slot by slot
   * rather than in one call to the allocator.
   *
   * `allocNoteOff` keys on (note, channel) and would apply one sustain decision to every
   * timbre that matched. A Combination can hold a timbre with HOLD on and another with the
   * damper filtered out, on the same key of the same channel, and each has to be right.
   */
  noteOff(note: number, channel = 0): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      if (slot.state !== 'held' || slot.note !== note || slot.channel !== channel) continue;
      const v = this.voices[i]!;
      const timbre = this.timbreOf(v);
      // HOLD (byte 11 bit1) latches notes on. Ignoring note-off entirely is exactly what the
      // hardware does; the note ends when HOLD is switched off or a panic clears the pool.
      if (timbre?.program.hold) continue;
      // Damper DIS means this timbre never hears the pedal, so it releases regardless.
      if (this.sustainDown && timbre?.damper !== false) {
        slot.sustained = true;
        continue;
      }
      slot.state = 'released';
      if (v.cfg) this.releaseVoice(v);
    }
  }

  allNotesOff(): void {
    for (let i = 0; i < this.slots.length; i++) {
      freeSlot(this.slots[i]!);
      this.voices[i]!.primed = false;
    }
  }

  /**
   * Joystick position as this timbre sees it. A timbre off the global channel, or one whose
   * CONTROL CHANGE filter is DIS, does not move — that is the MIDI filter reaching the DSP,
   * which is the only place it can be heard.
   */
  private joyXOf(t: TimbreConfig): number {
    return t.controlChange && this.controllersReach(t) ? this.joyX : 0;
  }

  private joyYOf(t: TimbreConfig): number {
    return t.controlChange && this.controllersReach(t) ? this.joyY : 0;
  }

  private aftertouchOf(t: TimbreConfig): number {
    return t.afterTouch && this.controllersReach(t) ? this.aftertouch : 0;
  }

  /** Semitones of pitch modulation reaching this voice from the MG and the controllers. */
  private pitchModOf(v: SlotVoice): number {
    const t = this.timbreOf(v);
    if (!t) return 0;
    const c = t.program.controllers;
    const joyY = this.joyYOf(t);
    const at = this.aftertouchOf(t);
    // Joystick Y up adds pitch MG depth; aftertouch adds its own. Both are additive on top
    // of the program's own MG intensity, which is already inside pitchMgValue.
    const mgDepth = 1 + Math.max(0, joyY) * c.jsPitchMgInt + at * c.atPitchMg;
    const mg = v.cfg?.pitchMgEnable ? this.pitchMgValues[v.timbre]! * mgDepth : 0;
    // PITCH MG INTENSITY is in cents at full scale; the bend and aftertouch are semitones.
    return mg * PITCH_MG_SEMITONES + this.joyXOf(t) * c.jsPitchBend + at * c.atPitch;
  }

  private incrementOf(v: SlotVoice): number {
    const cfg = v.cfg!;
    const t = this.timbreOf(v);
    // KEY TRANSPOSE repitches the sample, exactly as OCTAVE and INTERVAL already do rather
    // than shifting the keymap lookup. A CHOICE, and the consistent one: all three are
    // "change the pitch of this timbre" controls in the manual's own words.
    const semis =
      cfg.octave * 12 + cfg.interval + (t?.transpose ?? 0) + v.pitch.level + this.pitchModOf(v);
    return incrementFor(
      v.note,
      v.ref!.rootKey,
      v.ref!.fineCents + cfg.detune + (t?.detune ?? 0),
      v.ref!.sampleRate,
      this.sampleRate,
      semis,
    );
  }

  private coefficientOf(v: SlotVoice): number {
    const cfg = v.cfg!;
    const t = this.timbreOf(v);
    const c = t?.program.controllers;
    const track = keyboardTrackingRatio(cfg.cutoffTracking, v.note, cfg.cutoffCenterKey);
    // The filter EG is SIGNED and scaled by EG Intensity — it swings both ways around the
    // base cutoff, which is why the EG level is applied as an exponent rather than a gain.
    let semis = v.filt.level * v.egIntensity * EG_CUTOFF_SEMITONES;
    if (c && t) {
      const joyY = this.joyYOf(t);
      const at = this.aftertouchOf(t);
      const mgDepth = 1 + Math.max(0, -joyY) * c.jsCutoffMgInt + at * c.atCutoffMg;
      if (cfg.cutoffMgEnable) {
        semis += this.cutoffMgValues[v.timbre]! * mgDepth * CUTOFF_MOD_SEMITONES;
      }
      // Joystick Y up sweeps the filter; aftertouch has its own signed depth.
      semis += Math.max(0, joyY) * c.jsCutoffSweep * CUTOFF_MOD_SEMITONES;
      semis += at * c.atCutoff * CUTOFF_MOD_SEMITONES;
    }
    const hz = cfg.cutoffHz * track * Math.pow(2, semis / 12);
    return cutoffCoefficient(hz, this.sampleRate);
  }

  /** Amplitude modulation from aftertouch. Signed, so it can duck as well as swell. */
  private ampModOf(v: SlotVoice): number {
    const t = this.timbreOf(v);
    if (!t) return 1;
    return Math.max(0, 1 + this.aftertouchOf(t) * t.program.controllers.atAmp);
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
    this.renderBuses(outL, outR, null, null, count);
  }

  /**
   * Render into the effect section's FOUR inputs. `c` and `d` may be null, in which case the
   * two buses only a panpot can reach are discarded — which is what Program mode wants, and
   * what keeps `render` a two-buffer call for the Phase 2 golden buffers.
   *
   * The bus split IS the panpot, and everything downstream of here is Phase 4's.
   */
  renderBuses(
    a: Float32Array,
    b: Float32Array,
    c: Float32Array | null,
    d: Float32Array | null,
    count: number,
  ): void {
    a.fill(0, 0, count);
    b.fill(0, 0, count);
    c?.fill(0, 0, count);
    d?.fill(0, 0, count);
    if (this.timbres.length === 0) {
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
      this.renderChunk(a, b, c, d, done, chunk);
      done += chunk;
    }
  }

  private renderChunk(
    outA: Float32Array,
    outB: Float32Array,
    outC: Float32Array | null,
    outD: Float32Array | null,
    outOffset: number,
    count: number,
  ): void {
    const dt = count / this.sampleRate;

    // The two MGs are program-level: advance them ONCE per control block, not once per
    // slot. Advancing per slot would run them 16x fast whenever the pool filled up, which
    // is the sort of bug that only shows on a big chord. Eight timbres means eight pairs of
    // phases, each still advanced exactly once per block.
    //
    // The stick's UP half speeds the pitch MG and its DOWN half the cutoff MG, matching the
    // way the same two halves control their intensities.
    for (let t = 0; t < this.timbres.length; t++) {
      const timbre = this.timbres[t]!;
      const c = timbre.program.controllers;
      const joyY = this.joyYOf(timbre);
      this.pitchMgValues[t] = mgProcess(
        this.pitchMgStates[t]!,
        timbre.program.pitchMg,
        dt,
        1 + Math.max(0, joyY) * c.jsPitchMgFreq,
      );
      this.cutoffMgValues[t] = mgProcess(
        this.cutoffMgStates[t]!,
        timbre.program.cutoffMg,
        dt,
        1 + Math.max(0, -joyY) * c.jsCutoffMgFreq,
      );
    }

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      const v = this.voices[i]!;
      if (slot.state === 'free' || !v.primed || !v.ref || !v.cfg) continue;
      const timbre = this.timbreOf(v);
      if (!timbre) continue;

      // OSC-2 DELAY START: hold the voice silent and its envelopes un-started. Counting the
      // delay down here rather than scheduling a future note-on keeps the whole engine on
      // one clock, which is what makes the render deterministic.
      if (v.delayFrames > 0) {
        v.delayFrames = Math.max(0, v.delayFrames - count);
        continue;
      }

      // Envelopes advance once per block. The amp EG's output is the slot's level, which
      // the allocator reads as the loudness term in its steal score.
      egProcess(v.pitch, v.pitchEg, dt);
      egProcess(v.filt, v.filtEg, dt);
      const ampLevel = egProcess(v.amp, v.ampEg, dt);
      slot.level = ampLevel;

      // OUTPUT LEVEL is the timbre's, read LIVE rather than captured at note-on, so moving a
      // fader or the panpot moves the notes already sounding.
      let gainEnd = ampLevel * v.ampGain * this.ampModOf(v) * timbre.level;

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
      filterBlock(v.lp, scratch, 0, count, v.lastCoeff, coeffEnd, timbre.program.resonance);

      // The panpot, and the only place a voice becomes stereo. Each slot is MONO up to here —
      // the M1's stereo image comes from the effect section, whose two inputs are buses A and
      // B. Program mode lands unity on both, which is the mono sum Phase 2's goldens measure.
      const bus = timbre.bus;
      mixBus(outA, outOffset, scratch, count, bus[0]);
      mixBus(outB, outOffset, scratch, count, bus[1]);
      mixBus(outC, outOffset, scratch, count, bus[2]);
      mixBus(outD, outOffset, scratch, count, bus[3]);

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

    // The engine's clock advances HERE and only here. It used to advance in both this
    // method and its caller, which ran `now` at twice real time and aged every voice
    // twice as fast in the allocator's steal score.
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

  /** Slots currently sounding, per timbre. Drives the panel's per-row voice indicator. */
  activeSlotsOf(timbre: number): number {
    let n = 0;
    for (const s of this.slots) if (s.state !== 'free' && s.timbre === timbre) n++;
    return n;
  }
}

/**
 * Add `src` into one bus at `gain`, skipping the work entirely when the gain is zero.
 *
 * A panpot position never touches more than two of the four buses, so the guard skips at
 * least half the mixing on every slot rather than multiplying by zero four times.
 */
function mixBus(
  dst: Float32Array | null,
  offset: number,
  src: Float32Array,
  count: number,
  gain: number,
): void {
  if (!dst || gain === 0) return;
  if (gain === 1) {
    for (let n = 0; n < count; n++) dst[offset + n] = dst[offset + n]! + src[n]!;
    return;
  }
  for (let n = 0; n < count; n++) dst[offset + n] = dst[offset + n]! + src[n]! * gain;
}

/** Controller depths that contribute nothing, whatever the joystick and aftertouch do. */
export function neutralControllers(): ControllerConfig {
  return {
    atPitch: 0,
    atPitchMg: 0,
    atCutoff: 0,
    atCutoffMg: 0,
    atAmp: 0,
    jsPitchBend: 0,
    jsCutoffSweep: 0,
    jsPitchMgInt: 0,
    jsCutoffMgInt: 0,
    jsPitchMgFreq: 0,
    jsCutoffMgFreq: 0,
  };
}

/** An oscillator config with every modulation defeated. The base every builder starts from. */
export function neutralOscConfig(keymap: Uint16Array, samples: BankSampleRef[]): OscConfig {
  return {
    keymap,
    samples,
    level: 0.7,
    octave: 0,
    interval: 0,
    detune: 0,
    ampEg: { startLevel: 0, stages: [], sustainStage: -1, release: { timeS: 0, level: 0 } },
    filterEg: { startLevel: 0, stages: [], sustainStage: -1, release: { timeS: 0, level: 0 } },
    pitchEg: { startLevel: 0, stages: [], sustainStage: -1, release: { timeS: 0, level: 0 } },
    cutoffHz: 16000,
    egIntensity: 0,
    // -99 is NO tracking. 0 would mean 100% tracking (the documented trap) and is NOT a
    // neutral default, however much it looks like one.
    cutoffTracking: -99,
    cutoffCenterKey: 60,
    ampVelocity: 0.6,
    ampTracking: 0,
    ampCenterKey: 60,
    egIntensityVelocity: 0,
    filterEgTimeTrack: noEgTimeMod(),
    filterEgTimeVel: noEgTimeMod(),
    ampEgTimeTrack: noEgTimeMod(),
    ampEgTimeVel: noEgTimeMod(),
    pitchEgTimeVelocity: 0,
    pitchEgLevelVelocity: 0,
    startDelayS: 0,
    pitchMgEnable: false,
    cutoffMgEnable: false,
  };
}
